import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { extractOutputText } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import {
  buildReplyPrompt,
  parseSuggestions,
  type ThreadMessage,
} from "@/lib/crm/reply-suggestions";

/**
 * Drei Antwortentwuerfe zu einer eingegangenen Mail.
 *
 * Am 2026-08-04 lagen 8 eingegangene Mails im Posteingang und 0 vereinbarte
 * Termine. Zwischen "hat geantwortet" und "hat gekauft" liegt genau diese
 * Stelle, und dort passierte bisher nichts.
 *
 * Auf Klick, nicht automatisch: jeder Aufruf kostet Geld, und die meisten
 * Antworten beantwortet man in zehn Sekunden selbst. Der Vorschlag ist fuer
 * die, bei denen man ins Grübeln kommt — und genau die bleiben sonst liegen.
 *
 * Prompt-Bau und Auswertung stehen in lib/crm/reply-suggestions.ts (mit
 * Tests). Hier steht nur, woher das Gespraech kommt.
 */
export const maxDuration = 30;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const current = await getCurrentWorkspace(supabase);
  if (!current) return NextResponse.json({ error: "kein Workspace" }, { status: 400 });
  const workspaceId = current.workspace.id;

  const body = await req.json().catch(() => ({}));
  const messageId = (body?.messageId as string | undefined)?.trim();
  if (!messageId) return NextResponse.json({ error: "messageId fehlt" }, { status: 400 });

  const { data: message } = await supabase
    .from("messages")
    .select("id, contact_id, from_email, direction, ai_interest")
    .eq("id", messageId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!message || message.direction !== "inbound") {
    return NextResponse.json({ error: "Nachricht nicht gefunden oder nicht eingehend." }, { status: 400 });
  }

  /**
   * Das Gespraech, nicht nur die eine Mail.
   *
   * Ein "ja, gerne" ist ohne die Frage davor nicht zu beantworten. Gruppiert
   * wird ueber den Kontakt, falls es einen gibt, sonst ueber die
   * Absenderadresse — dieselbe Regel wie im Posteingang selbst, sonst
   * bekaeme man hier einen anderen Verlauf zu sehen als dort.
   */
  const threadQuery = supabase
    .from("messages")
    .select("direction, subject, body, sent_at")
    .eq("workspace_id", workspaceId)
    .order("sent_at", { ascending: true })
    .limit(20);
  const { data: thread } = message.contact_id
    ? await threadQuery.eq("contact_id", message.contact_id)
    : await threadQuery.eq("from_email", message.from_email);

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("calendar_link, reply_sender_name")
    .eq("id", workspaceId)
    .single();

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  const prompt = buildReplyPrompt((thread ?? []) as ThreadMessage[], {
    interest: message.ai_interest,
    calendarLink: workspace?.calendar_link ?? null,
    senderName: workspace?.reply_sender_name ?? null,
  });

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `OpenAI: ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    // Kostenzeile, wie sie der Worker fuer jeden seiner Aufrufe schreibt.
    // Diese Route tat es bis zum 2026-08-12 nicht — die Entwuerfe kosteten
    // Geld und tauchten unter "API-Kosten" nicht auf.
    await recordOpenAiUsage(supabase, workspaceId, "suggest_reply", json);
    const suggestions = parseSuggestions(extractOutputText(json));
    if (suggestions.length === 0) {
      // Ehrlich melden statt eine leere Liste als Ergebnis auszugeben: eine
      // Oberflaeche mit null Vorschlaegen sieht aus wie ein Fehler in der
      // Bedienung, und der Nutzer klickt dann noch dreimal.
      return NextResponse.json({ error: "Kein brauchbarer Entwurf entstanden. Bitte erneut versuchen." }, { status: 502 });
    }
    return NextResponse.json({ suggestions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
