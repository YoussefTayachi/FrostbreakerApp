import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";

/**
 * Vorschlagswerte fuer die wertgebundenen Prospeo-Filter.
 *
 * WARUM ES DIESE ROUTE GIBT UND NICHT EINE LISTE IM CODE
 *
 * Prospeo akzeptiert fuer Ort, Branche, Technologie und einige weitere Felder
 * NUR Werte aus seiner eigenen Suggestions-API ("Location values must be
 * obtained from the Search Suggestions API"). Eine hier hinterlegte Liste
 * waere im Moment des Schreibens eine Vermutung und beim naechsten
 * Prospeo-Update falsch, und der Fehler waere nicht laut, sondern ein
 * leeres Suchergebnis.
 *
 * Genau das ist bei Apollo schon einmal passiert: am 2026-08-02 lief eine
 * 300-Lead-Suche komplett leer, weil drei Technologie-Slugs bei Apollo gar
 * nicht existierten. Apollo meldete keinen Fehler, es lieferte still null.
 * Diese Route ist die Lehre daraus.
 *
 * Der Endpunkt ist laut Doku KOSTENLOS und verbraucht keine Credits; er
 * darf deshalb bei jedem Tastendruck laufen, anders als der Trefferzaehler.
 *
 * Der Schluessel bleibt serverseitig. Das Formular schickt nur Typ und
 * Suchbegriff.
 */

/**
 * Die Typen, die das Formular anbietet. Bewusst eine Positivliste statt den
 * Typ durchzureichen: sonst waere diese Route ein offener Proxy auf Prospeos
 * gesamte API, bezahlt vom Kontingent des Kunden.
 */
const ALLOWED_TYPES = [
  "location_search",
  "job_title_search",
  "technology_search",
  "industry_search",
  "company_funding_investors_search",
  "company_website_traffic_countries_search",
] as const;

type SuggestionType = (typeof ALLOWED_TYPES)[number];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  let type: SuggestionType;
  let query: string;
  try {
    const body = (await request.json()) as { type?: string; query?: string };
    if (!ALLOWED_TYPES.includes(body.type as SuggestionType)) {
      return NextResponse.json({ error: "bad_type" }, { status: 400 });
    }
    type = body.type as SuggestionType;
    query = String(body.query ?? "").trim();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Ein leerer Suchbegriff wuerde die ganze Werteliste anfordern. Das ist
  // weder fuer die Anzeige brauchbar noch fuer Prospeo hoeflich.
  if (query.length < 2) return NextResponse.json({ suggestions: [] });

  const apiKey = await getApiKey(supabase, ws.workspace.id, "prospeo");
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const res = await fetch("https://api.prospeo.io/search-suggestions", {
      method: "POST",
      headers: {
        "X-KEY": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ [type]: query }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "rejected" }, { status: 400 });
    }
    if (!res.ok) return NextResponse.json({ suggestions: [] });

    const body = await res.json();
    // Prospeo antwortet mit einem Feld, das nach dem angefragten Typ heisst:
    // technology_search -> technology_suggestions.
    const field = type.replace(/_search$/, "_suggestions");
    const raw = body?.[field];
    if (!Array.isArray(raw)) return NextResponse.json({ suggestions: [] });

    /**
     * Orte kommen als {name, type}, alles andere als flache Zeichenketten.
     * Beides auf eine Form bringen, damit das Formular nur einen Fall kennt:
     * `label` ist, was der Nutzer sieht, `value` ist, was an Prospeo
     * zurueckgeht. Bei Orten sind beide gleich; der Typ ("City", "Country")
     * wandert in `hint`, weil "Berlin" als Stadt und als Bundesland zweimal
     * auftauchen kann.
     */
    const suggestions = raw.slice(0, 25).map((item: unknown) => {
      if (item && typeof item === "object") {
        const o = item as { name?: string; type?: string; label?: string; code?: string };
        const value = o.name ?? o.label ?? o.code ?? "";
        return { value, label: value, hint: o.type ?? null };
      }
      const value = String(item);
      return { value, label: value, hint: null };
    });

    return NextResponse.json({ suggestions: suggestions.filter((s) => s.value) });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
