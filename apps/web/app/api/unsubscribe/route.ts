import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

// Oeffentlicher Opt-out-Endpunkt, per Link direkt in der Kampagnen-Mail
// aufgerufen (siehe "Abmelde-Link" in campaign-step-card.tsx). Der Empfaenger
// hat keine Session; deshalb Service-Role-Client statt der RLS-gebundenen
// Clients, und die Route ist in middleware.ts von der Login-Pflicht
// ausgenommen (wie api/billing/webhook und api/cron/*).
//
// Bewusst ein einfacher GET ohne Zwischenschritt oder Bestaetigungsklick:
// CAN-SPAM verlangt einen Opt-out-Weg ohne zusaetzliche Huerden (kein Login,
// keine Gebuehr, keine weiteren Pflichtangaben ausser der E-Mail-Adresse).
export const dynamic = "force-dynamic";

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ws = url.searchParams.get("ws")?.trim() ?? "";
  const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
  const redirectTo = new URL("/unsubscribe", url.origin);

  if (!ws || !email || !isValidEmail(email)) {
    redirectTo.searchParams.set("status", "invalid");
    return NextResponse.redirect(redirectTo);
  }

  try {
    const supabase = createServiceClient();
    // ignoreDuplicates: bereits blockierte Adressen (z.B. schon manuell
    // geblockt) sollen keinen Fehler auf einen erneuten Klick auf denselben
    // Link ausloesen: das Ziel (nie wieder kontaktiert werden) ist so oder
    // so schon erreicht.
    const { error } = await supabase
      .from("suppression_list")
      .upsert({ workspace_id: ws, email, reason: "unsubscribed" }, { onConflict: "workspace_id,email", ignoreDuplicates: true });
    redirectTo.searchParams.set("status", error ? "error" : "ok");
  } catch {
    // z.B. fehlende SUPABASE_SERVICE_ROLE_KEY; der Empfaenger soll eine
    // ordentliche Meldung sehen statt einer rohen 500-Seite.
    redirectTo.searchParams.set("status", "error");
  }
  return NextResponse.redirect(redirectTo);
}
