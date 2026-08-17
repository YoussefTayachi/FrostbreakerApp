import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";

/**
 * "Verbindung testen" fuer den Prospeo-Key.
 *
 * Geprueft wird ueber search-suggestions, nicht ueber die Suche: dieser
 * Endpunkt ist laut Doku ausdruecklich kostenlos ("This endpoint is FREE and
 * does not consume any credits") und braucht trotzdem einen gueltigen
 * Schluessel. Damit laesst sich beantworten, ob ein hinterlegter Key lebt,
 * ohne Kontingent zu verbrennen.
 *
 * Bei Apollo uebernimmt diese Rolle /auth/health. Prospeo hat keinen eigenen
 * Health-Endpunkt, deshalb der Umweg — der Effekt ist derselbe.
 *
 * Beantwortet ausdruecklich NICHT, ob der Tarif die benutzten Filter
 * freigibt. Der Technologie-Filter braucht Starter, der Website-Traffic Pro;
 * ein gueltiger Key kann hier also "ok" melden und die Suche trotzdem mit
 * einem Tarif-Fehler abbrechen. Die Antwort sagt "Key gueltig", nicht
 * "alles bereit" — genau wie bei Apollo.
 *
 * Die Kontingent-Zaehler nimmt die Antwort gleich mit: Prospeo schickt bei
 * jeder Anfrage mit, wie viel heute und in dieser Minute noch frei ist. Das
 * ist die einzige Stelle, an der das ohne Kosten sichtbar wird.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

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
      // Irgendein billiger Suchbegriff — es geht nur darum, ob der Schluessel
      // angenommen wird.
      body: JSON.stringify({ technology_search: "sh" }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, reason: "rejected" });
    }
    if (res.status === 429) {
      // Der Schluessel ist gueltig, nur gerade gedrosselt. Das als "abgelehnt"
      // zu melden waere die falsche Auskunft — der Nutzer wuerde einen
      // funktionierenden Key austauschen.
      return NextResponse.json({ ok: true, reason: "rate_limited" });
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, reason: "http_" + res.status });
    }

    const body = await res.json();
    if (body?.error) return NextResponse.json({ ok: false, reason: "rejected" });

    return NextResponse.json({
      ok: true,
      reason: null,
      quota: {
        dailyLeft: numOrNull(res.headers.get("x-daily-request-left")),
        dailyLimit: numOrNull(res.headers.get("x-daily-rate-limit")),
        minuteLeft: numOrNull(res.headers.get("x-minute-request-left")),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "unreachable" });
  }
}

function numOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
