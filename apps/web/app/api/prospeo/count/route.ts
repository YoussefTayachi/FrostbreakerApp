import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import {
  buildProspeoFilters,
  hasAnyProspeoFilter,
  requiredProspeoPlan,
  type ProspeoFilters,
} from "@/lib/prospeo-query";

/**
 * Wie viele Leads gibt es fuer diese Filter, BEVOR die Suche startet?
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DER ENTSCHEIDENDE UNTERSCHIED ZU /api/apollo/count
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Apollos Zaehler ist gratis und laeuft dort bei jeder Filteraenderung.
 * Prospeos Suche kostet 1 Credit je Seite, auch die erste, auch wenn nur
 * die Gesamtzahl interessiert. Ein Zaehler, der bei jedem Tastendruck laeuft,
 * haette auf dem Starter-Tarif (1000 Credits) nach ein paar Minuten
 * Formularbedienung das Monatskontingent aufgebraucht.
 *
 * Deshalb: diese Route wird AUSDRUECKLICH ausgeloest, nicht automatisch. Das
 * Formular hat dafuer einen Knopf, der den Preis danebenschreibt. Wer das
 * aendert, macht aus einer Komfortfunktion eine Kostenfalle.
 *
 * Die Zahl kommt aus pagination.total_count. Prospeo deckelt die
 * ABRUFBAREN Treffer bei 25.000 (1000 Seiten x 25), total_count kann aber
 * darueber liegen; die Antwort gibt deshalb beides mit, damit die
 * Oberflaeche "50.000 gefunden, 25.000 abrufbar" sagen kann statt eine Zahl
 * zu versprechen, die die Suche nicht einloest.
 */

/** Prospeos harte Grenze: 1000 Seiten a 25 Treffer. */
const MAX_RETRIEVABLE = 25000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  let filters: ProspeoFilters;
  try {
    filters = (await request.json()) as ProspeoFilters;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Ohne Filter liefe die Suche quer durch 200 Millionen Kontakte. Das ist
  // kein Zaehlerergebnis, das ist ein Bedienfehler, und er kostet sonst
  // einen Credit, um das zu erfahren.
  if (!hasAnyProspeoFilter(filters)) {
    return NextResponse.json({ error: "no_filters" }, { status: 400 });
  }

  const apiKey = await getApiKey(supabase, ws.workspace.id, "prospeo");
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const res = await fetch("https://api.prospeo.io/search-person", {
      method: "POST",
      headers: {
        "X-KEY": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ filters: buildProspeoFilters(filters), page: 1 }),
      signal: AbortSignal.timeout(30000),
    });

    if (res.status === 401) {
      return NextResponse.json({ error: "rejected" }, { status: 400 });
    }
    if (res.status === 429) {
      return NextResponse.json({ error: "rate_limited" }, { status: 400 });
    }

    /**
     * Der Rumpf zuerst, dann der Statuscode.
     *
     * Am 2026-08-05 im Testlauf gelernt: eine Tarifsperre kommt bei Prospeo
     * als **HTTP 400** mit einem Fehlercode im Rumpf, nicht als 403:
     *
     *   {"error": true, "error_code": "PLAN_REQUIRED",
     *    "filter_error": "Filters not available on your plan: company_technology (STARTER+)"}
     *
     * Hier stand zuerst nur eine 403-Pruefung. Der 400 fiel dadurch in den
     * allgemeinen Zweig, und im Formular stand "Prospeo ist gerade nicht
     * erreichbar", obwohl Prospeo praezise geantwortet hatte.
     *
     * filter_error geht woertlich an die Oberflaeche: Prospeo nennt darin den
     * Filternamen und die noetige Stufe, das ist besser als jede Umschreibung.
     */
    let body: Record<string, unknown> | null = null;
    try {
      body = await res.json();
    } catch {
      return NextResponse.json({ error: "http_" + res.status }, { status: 400 });
    }

    const code = String(body?.error_code ?? "");
    const detail = String(body?.filter_error ?? "");
    if (code === "PLAN_REQUIRED") {
      const { plan, fields } = requiredProspeoPlan(filters);
      return NextResponse.json({ error: "plan", plan, fields, detail }, { status: 400 });
    }
    if (code === "INVALID_FILTERS") {
      return NextResponse.json({ error: "invalid_filters", detail }, { status: 400 });
    }
    if (res.status === 403) {
      const { plan, fields } = requiredProspeoPlan(filters);
      return NextResponse.json({ error: "plan", plan, fields, detail }, { status: 400 });
    }
    if (!res.ok || body?.error) {
      return NextResponse.json(
        { error: detail ? "invalid_filters" : "http_" + res.status, detail },
        { status: 400 }
      );
    }

    const pagination = (body?.pagination ?? {}) as { total_count?: number };
    const total = Number(pagination.total_count ?? 0);
    return NextResponse.json({
      total: Number.isFinite(total) ? total : 0,
      retrievable: Math.min(Number.isFinite(total) ? total : 0, MAX_RETRIEVABLE),
      // Was dieser Aufruf gekostet hat. Steht in der Antwort, damit die
      // Oberflaeche es benennen kann statt es zu verschweigen.
      creditsUsed: 1,
      dailyLeft: numOrNull(res.headers.get("x-daily-request-left")),
    });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 400 });
  }
}

function numOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
