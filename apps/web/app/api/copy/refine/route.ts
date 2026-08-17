import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { OFFER_COLUMNS, emptyOffer, type Offer } from "@/lib/offers";
import { DEFAULT_MAX_WORDS } from "@/lib/personalization-defaults";
import { MAX_INSTRUCTION_CHARS, buildRefinePrompt, parseVariant } from "@/lib/copy/refine-prompt";
import { unknownTags } from "@/lib/copy/sequence-prompt";

/**
 * Eine einzelne Fassung nachschaerfen.
 *
 * Ein Aufruf, eine Fassung zurueck — kein Gespraechsverlauf. Die
 * Begruendung dafuer steht in lib/copy/refine-prompt.ts.
 *
 * Das Angebot ist optional: wer nur "kuerzer" will, soll das auch ohne
 * hinterlegtes Angebot koennen. Ohne Angebot faellt lediglich der
 * Zusammenhang weg, den das Modell fuer inhaltliche Aenderungen braeuchte.
 */
export const maxDuration = 45;

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
  const instruction = String(body?.instruction ?? "").trim();
  const subject = String(body?.subject ?? "");
  const text = String(body?.body ?? "").trim();
  const stepNumber = Number(body?.stepNumber) || 1;
  const offerId = (body?.offerId as string | undefined)?.trim() || null;

  if (!instruction) return NextResponse.json({ error: "Keine Anweisung angegeben." }, { status: 400 });
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return NextResponse.json({ error: "Anweisung zu lang." }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "Kein Text zum Überarbeiten." }, { status: 400 });

  const [offerRes, workspaceRes] = await Promise.all([
    offerId
      ? supabase
          .from("offers")
          .select(OFFER_COLUMNS)
          .eq("id", offerId)
          .eq("workspace_id", workspaceId)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("workspaces")
      .select("calendar_link, reply_sender_name, personalization_max_words")
      .eq("id", workspaceId)
      .single(),
  ]);

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  // Ohne hinterlegtes Angebot ein leeres: der Prompt macht daraus von selbst
  // die Anweisungen "nichts behaupten, nichts erfinden".
  // emptyOffer() statt eines eigenen Literals: sonst muss diese Stelle bei
  // jedem neuen Angebotsfeld nachgezogen werden, und beim Playbook-Umbau
  // (Migration 0093) hat sie das prompt auch gebraucht.
  const offer: Offer =
    (offerRes.data as unknown as Offer | null) ?? { ...emptyOffer(""), id: "", is_default: false };

  const fallback = { subject, body: text };
  const prompt = buildRefinePrompt(offer, fallback, instruction, {
    stepNumber,
    personalizationWords: workspaceRes.data?.personalization_max_words || DEFAULT_MAX_WORDS,
    calendarLink: workspaceRes.data?.calendar_link ?? null,
    senderName: workspaceRes.data?.reply_sender_name ?? null,
  });

  const result = await callOpenAi(openaiKey, [{ role: "user", content: prompt }]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "copy_refine", result.json);

  const variant = parseVariant(result.text, fallback);
  if (!variant) {
    return NextResponse.json({ error: "Keine brauchbare Fassung entstanden." }, { status: 502 });
  }

  // Ungefuellte Platzhalter meldet die Oberflaeche neben dem Text. Sie hier
  // stillschweigend zu entfernen wuerde den Satz zerreissen — der Nutzer
  // soll sehen, was das Modell gebaut hat, und entscheiden.
  return NextResponse.json({
    variant,
    unknownTags: unknownTags(variant.subject + "\n" + variant.body),
  });
}
