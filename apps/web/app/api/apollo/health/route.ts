import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";

/**
 * "Verbindung testen" fuer den Apollo-Key.
 *
 * /auth/health kostet keine Credits und ist in jedem Apollo-Plan erlaubt --
 * damit laesst sich beantworten, ob ein hinterlegter Key ueberhaupt lebt, ohne
 * eine Suche zu starten und Kontingent zu verbrennen. Bisher merkte man einen
 * falschen Key erst daran, dass eine echte Leadsuche fehlschlug.
 *
 * Beantwortet ausdruecklich NICHT, ob der Plan die Personensuche freigibt: der
 * Free-Plan sperrt mixed_people/api_search und people/bulk_match, laesst
 * /auth/health aber zu. Ein gueltiger Key kann hier also "ok" melden und die
 * Leadsuche trotzdem mit einem Plan-Fehler abbrechen — deshalb sagt die
 * Antwort nur "Key gueltig", nicht "alles bereit".
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const apiKey = await getApiKey(supabase, ws.workspace.id, "apollo");
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const res = await fetch("https://api.apollo.io/api/v1/auth/health", {
      // Key im Header, nicht als URL-Parameter: Apollo hat letzteres als
      // "deprecated soon" angekuendigt.
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, reason: "rejected" });
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, reason: "http_" + res.status });
    }
    const body = await res.json();
    return NextResponse.json({ ok: Boolean(body?.is_logged_in), reason: null });
  } catch {
    return NextResponse.json({ ok: false, reason: "unreachable" });
  }
}
