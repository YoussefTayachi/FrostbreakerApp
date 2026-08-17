import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { sendEmail } from "@/lib/email";

/**
 * "Testmail senden" fuer die Antwort-Benachrichtigung.
 *
 * Ob der Versand wirklich funktioniert, zeigt sich sonst erst, wenn zum ersten
 * Mal ein Lead antwortet, also genau in dem Moment, in dem die Meldung
 * gebraucht wird und ein Fehler am teuersten ist. Zwei Dinge gehen dabei
 * typischerweise schief und lassen sich von aussen nicht unterscheiden: ein
 * fehlender oder falscher API-Schluessel und eine nicht verifizierte
 * Absenderdomain. Deshalb wird Resends Fehlertext hier woertlich
 * durchgereicht statt zu einem generischen "hat nicht geklappt" zusammen-
 * gefasst.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const { data } = await supabase
    .from("workspaces")
    .select("reply_notify_email")
    .eq("id", ws.workspace.id)
    .single();
  const to = (data?.reply_notify_email ?? "").trim();
  if (!to) return NextResponse.json({ ok: false, reason: "no_address" });

  const result = await sendEmail(
    to,
    "Testmail von Frostbreaker",
    [
      "Das ist eine Testmail.",
      "",
      "Wenn sie ankommt, meldet sich Frostbreaker künftig hier, sobald ein Lead",
      "zum ersten Mal auf eine Kampagne antwortet.",
    ].join("\n")
  );
  return NextResponse.json(result.ok ? { ok: true, to } : { ok: false, reason: result.reason });
}
