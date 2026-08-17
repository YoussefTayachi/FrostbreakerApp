import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";

type InstantlyEmail = { id: string; eaccount?: string; lead?: string };

/**
 * Beantwortet eine eingehende Instantly-Antwort direkt aus der App heraus,
 * statt nur die KI-Klassifizierung anzuzeigen (siehe leads-table.tsx Drawer).
 *
 * Instantly braucht fuer POST /api/v2/emails/reply das sendende Postfach
 * (eaccount) -- das steht nicht lokal in public.messages, deshalb erst ein
 * Live-GET auf die einzelne E-Mail, dann der eigentliche Reply-Call.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;
  const workspaceId = ctx.workspace.id;

  const body = await req.json().catch(() => ({}));
  const messageId = body?.messageId as string | undefined;
  const subject = (body?.subject as string | undefined)?.trim();
  const replyBody = (body?.body as string | undefined)?.trim();

  if (!messageId || !subject || !replyBody) {
    return NextResponse.json({ error: "Pflichtfelder fehlen." }, { status: 400 });
  }

  const { data: original } = await supabase
    .from("messages")
    .select("id, contact_id, direction, instantly_email_id")
    .eq("id", messageId)
    .eq("workspace_id", workspaceId)
    .single();

  if (!original || original.direction !== "inbound" || !original.instantly_email_id) {
    return NextResponse.json(
      { error: "Ursprungsnachricht nicht gefunden oder nicht antwortbar." },
      { status: 400 }
    );
  }

  try {
    const original_email = await instantlyRequest<InstantlyEmail>(
      ctx.apiKey,
      `/api/v2/emails/${original.instantly_email_id}`
    );
    if (!original_email.eaccount) {
      return NextResponse.json(
        { error: "Kein Absender-Postfach fuer diese Nachricht ermittelbar." },
        { status: 502 }
      );
    }

    const sent = await instantlyRequest<{ id?: string }>(ctx.apiKey, "/api/v2/emails/reply", {
      method: "POST",
      body: JSON.stringify({
        reply_to_uuid: original.instantly_email_id,
        eaccount: original_email.eaccount,
        subject,
        body: { text: replyBody },
      }),
    });

    const { data: inserted, error: insertError } = await supabase
      .from("messages")
      .insert({
        workspace_id: workspaceId,
        contact_id: original.contact_id,
        direction: "outbound",
        status: "sent",
        subject,
        body: replyBody,
        sent_at: new Date().toISOString(),
        instantly_email_id: sent.id ?? null,
      })
      .select("id, contact_id, subject, body, ai_interest, sent_at, direction, instantly_email_id")
      .single();

    if (insertError) {
      // Bei Instantly ist die Antwort raus, nur der lokale Spiegel fehlt --
      // kein harter Fehler, aber der Client sollte es wissen (Thread wird
      // beim naechsten Laden trotzdem nicht vollstaendig sein, bis der
      // naechste poll_instantly-Lauf sie zurueckholt).
      return NextResponse.json({ warning: "Gesendet, aber lokal nicht gespeichert: " + insertError.message });
    }

    return NextResponse.json(inserted);
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
