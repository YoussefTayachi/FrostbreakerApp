import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";

// NeverBounce-Ergebnis -> unsere bestehenden Felder (gleiche Skala wie Hunter, damit
// die vorhandene VerificationShield-Logik im Frontend unveraendert weiterfunktioniert).
const CONFIDENCE_BY_RESULT: Record<string, number> = {
  valid: 97,
  catchall: 60,
  unknown: 40,
  disposable: 20,
  invalid: 0,
};

const MAX_BATCH = 200;

// Listenpreis, Stand 2026-08-02. Muss mit NEVERBOUNCE_USD_PER_CHECK in
// apps/worker/worker/usage.py uebereinstimmen.
const NEVERBOUNCE_USD_PER_CHECK = 0.008;

async function checkOne(apiKey: string, email: string): Promise<string> {
  const url =
    "https://api.neverbounce.com/v4/single/check?" +
    new URLSearchParams({ key: apiKey, email, timeout: "8" }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = await res.json();
  if (body.status !== "success") throw new Error(body.message ?? "NeverBounce-Fehler");
  return body.result as string; // valid | invalid | disposable | catchall | unknown
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { contact_ids } = await req.json();
  if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
    return NextResponse.json({ error: "contact_ids fehlt" }, { status: 400 });
  }

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const apiKey = await getApiKey(supabase, ws.workspace.id, "neverbounce");
  if (!apiKey) {
    return NextResponse.json({ error: "Kein NeverBounce-Key in den Einstellungen hinterlegt." }, { status: 400 });
  }

  // Nur eigene, noch unverifizierte Kontakte mit E-Mail — verhindert doppelte
  // Kosten fuer bereits von Hunter verifizierte Kontakte.
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email")
    .eq("workspace_id", ws.workspace.id)
    .in("id", contact_ids.slice(0, MAX_BATCH))
    .not("email", "is", null)
    .is("email_verification_status", null);

  const summary = { checked: 0, valid: 0, invalid: 0, catchall: 0, unknown: 0, disposable: 0, errors: 0 };
  for (const c of contacts ?? []) {
    try {
      const result = await checkOne(apiKey, c.email as string);
      await supabase
        .from("contacts")
        .update({
          email_verification_status: result,
          email_confidence: CONFIDENCE_BY_RESULT[result] ?? 40,
          email_verified_by: "neverbounce",
        })
        .eq("id", c.id);
      summary.checked += 1;
      if (result in summary) (summary as Record<string, number>)[result] += 1;
    } catch {
      summary.errors += 1;
    }
  }

  // Gezaehlt wird, was NeverBounce tatsaechlich geprueft hat — fehlgeschlagene
  // Aufrufe berechnet der Anbieter nicht. Vorher tauchte NeverBounce in der
  // Kostenrechnung ueberhaupt nicht auf.
  if (summary.checked > 0) {
    await supabase.from("api_usage").insert({
      workspace_id: ws.workspace.id,
      provider: "neverbounce",
      operation: "verify",
      units: summary.checked,
      unit_kind: "checks",
      cost_usd: summary.checked * NEVERBOUNCE_USD_PER_CHECK,
    });
  }

  return NextResponse.json(summary);
}
