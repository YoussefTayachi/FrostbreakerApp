import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import {
  buildApolloSearchBody,
  hasAnyApolloFilter,
  type ApolloFilters,
} from "@/lib/apollo-query";

/**
 * Wie viele Leads gibt es fuer diese Filter -- BEVOR die Suche startet?
 *
 * Der Aufruf kostet nichts: mixed_people/api_search wird mit per_page=1
 * angefragt, Apollo berechnet die Suche selbst nicht (nur das Anreichern per
 * bulk_match kostet Credits, und das passiert hier nicht). Der Zaehler darf
 * deshalb bei jeder Filteraenderung laufen.
 *
 * Warum das ueberhaupt gebraucht wird: enge Kombinationen aus Keywords und
 * Technologie brechen den Pool unerwartet ein -- eine Suche auf 300 Leads kann
 * auf 40 verfuegbare treffen, und das merkte man bisher erst hinterher. Am
 * 2026-08-02 lief eine 300-Lead-Suche komplett leer, weil ein
 * Technologie-Slug bei Apollo gar nicht existierte; Apollo meldet so etwas
 * nicht als Fehler, sondern liefert stillschweigend null.
 *
 * Die Zahl kommt aus total_entries. Achtung, das steht auf OBERSTER Ebene der
 * Antwort -- pagination ist bei diesem Endpunkt durchgaengig null, anders als
 * bei Apollos uebrigen Such-Endpunkten.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  let filters: ApolloFilters;
  try {
    filters = (await request.json()) as ApolloFilters;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // Ohne Filter waere die Anfrage "alle Menschen mit verifizierter Adresse".
  // Der Worker weist das ab, also fragen wir gar nicht erst.
  if (!hasAnyApolloFilter(filters)) {
    return NextResponse.json({ ok: false, reason: "no_filter" });
  }

  const apiKey = await getApiKey(supabase, ws.workspace.id, "apollo");
  if (!apiKey) return NextResponse.json({ ok: false, reason: "no_key" });

  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      // Key im Header, nicht als URL-Parameter: Apollo hat letzteres als
      // "deprecated soon" angekuendigt.
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildApolloSearchBody(filters, 1, 1)),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 403) {
      // Der Free-Plan sperrt diesen Endpunkt komplett. Eigener Grund, damit die
      // Oberflaeche nicht "0 Treffer" anzeigt, wo in Wahrheit der Plan fehlt.
      return NextResponse.json({ ok: false, reason: "plan" });
    }
    if (res.status === 429) return NextResponse.json({ ok: false, reason: "rate_limit" });
    if (!res.ok) return NextResponse.json({ ok: false, reason: "http_" + res.status });
    const body = await res.json();
    const total = body?.total_entries;
    if (typeof total !== "number") {
      // Lieber gar keine Zahl als eine geratene: eine falsche Zusage hier
      // fuehrt zu einer Suche, die der Nutzer anders geplant haette.
      return NextResponse.json({ ok: false, reason: "no_total" });
    }
    return NextResponse.json({ ok: true, total });
  } catch {
    return NextResponse.json({ ok: false, reason: "unreachable" });
  }
}
