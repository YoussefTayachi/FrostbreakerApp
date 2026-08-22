import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";

/**
 * "Verbindung testen" fuer den Anthropic-Key.
 *
 * Geprueft wird ueber die Modell-Liste (GET /v1/models), nicht ueber einen
 * Modellaufruf: der Endpunkt braucht einen gueltigen Schluessel, erzeugt aber
 * keine Tokens und kostet damit nichts. Ein Testaufruf gegen /v1/messages
 * waere zwar nur ein paar Cent-Bruchteile, aber es ist das Geld des Kunden,
 * und ein Knopf, der bei jedem Druck abrechnet, ist der falsche Knopf.
 *
 * Bei Apollo uebernimmt diese Rolle /auth/health, bei Prospeo die kostenlose
 * Suggestions-API. Der Effekt ist derselbe.
 *
 * Beantwortet ausdruecklich NUR "Key gueltig". Ob auf dem Konto noch Guthaben
 * ist, sagt der Endpunkt nicht: ein leeres Konto meldet sich erst beim echten
 * Aufruf, dann als 402 billing_error bzw. als 429 mit
 * enforced_spend_limit_reached (siehe worker/provider_errors.py). Genau
 * dieselbe Einschraenkung wie bei Apollo und Prospeo.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const apiKey = await getApiKey(supabase, ws.workspace.id, "anthropic");
  if (!apiKey) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, reason: "rejected" });
    }
    if (res.status === 429) {
      // Der Schluessel ist gueltig, nur gerade gedrosselt. Das als
      // "abgelehnt" zu melden waere die falsche Auskunft, der Nutzer wuerde
      // einen funktionierenden Key austauschen. Gleiche Entscheidung wie in
      // der Prospeo-Route.
      return NextResponse.json({ ok: true, reason: "rate_limited" });
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, reason: "http_" + res.status });
    }
    return NextResponse.json({ ok: true, reason: null });
  } catch {
    return NextResponse.json({ ok: false, reason: "unreachable" });
  }
}
