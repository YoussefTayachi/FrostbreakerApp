import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { OFFER_COLUMNS, type Offer } from "@/lib/offers";
import { DEFAULT_MAX_WORDS } from "@/lib/personalization-defaults";
import { unknownPlaceholders } from "@/lib/crm/linkedin-message";
import { signatureFor } from "@/lib/copy/sequence-prompt";
import {
  LINKEDIN_MAX_CHARS,
  appendSignature,
  buildLinkedInPrompt,
  cleanLinkedInMessage,
  estimateLinkedInLength,
  freeStandingPersonalization,
  messageCorrection,
  messageProblems,
} from "@/lib/copy/linkedin-prompt";

/**
 * Eine LinkedIn-Vorlage aus demselben Angebot wie die Mail-Sequenz.
 *
 * Der billigste zusaetzliche Kanal, den es gibt: die Kontakte sind schon
 * gekauft, ein zweiter Anlauf ueber LinkedIn kostet keinen Credit. Gefehlt
 * hat nur der Text.
 *
 * Zu lange Antworten werden NICHT abgeschnitten, sondern gemeldet: eine
 * mitten im Satz abgebrochene Nachricht saehe nach einem Fehler der App aus,
 * und der Nutzer kann selbst kuerzen oder neu erzeugen.
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
  const offerId = (body?.offerId as string | undefined)?.trim();
  if (!offerId) return NextResponse.json({ error: "offerId fehlt" }, { status: 400 });

  const [offerRes, workspaceRes] = await Promise.all([
    supabase
      .from("offers")
      .select(OFFER_COLUMNS)
      .eq("id", offerId)
      .eq("workspace_id", workspaceId)
      .single(),
    // reply_sender_name ist der Rueckfall fuer die Signatur, genau wie bei der
    // Mailsequenz: die Signatur am Angebot geht vor, sonst der Name am
    // Workspace, sonst gar keine (Migration 0091).
    supabase
      .from("workspaces")
      .select("personalization_max_words, reply_sender_name")
      .eq("id", workspaceId)
      .single(),
  ]);
  if (!offerRes.data) return NextResponse.json({ error: "Angebot nicht gefunden." }, { status: 404 });

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  const offer = offerRes.data as unknown as Offer;
  const signature = signatureFor(offer, workspaceRes.data?.reply_sender_name ?? null);
  const personalizationWords = workspaceRes.data?.personalization_max_words || DEFAULT_MAX_WORDS;
  // Die Aufhaengerlaenge gehoert in den Prompt, nicht nur in die Nachpruefung:
  // ohne sie kennt das Modell seinen eigenen Spielraum nicht und schreibt
  // gegen die vollen 300 an (live gemessen 2026-08-13, siehe linkedin-prompt).
  const prompt = buildLinkedInPrompt(offer, signature, personalizationWords);

  const result = await callOpenAi(openaiKey, [{ role: "user", content: prompt }]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "copy_linkedin", result.json);

  // Erst mechanisch freistellen, dann pruefen: die Umbrueche um den
  // Aufhaenger sind eine Formsache und werden repariert, nicht erbeten.
  let message = freeStandingPersonalization(cleanLinkedInMessage(result.text));
  if (!message) return NextResponse.json({ error: "Keine brauchbare Vorlage entstanden." }, { status: 502 });

  // Die Signatur zaehlt in der Zeichengrenze mit, obwohl sie erst ganz unten
  // angehaengt wird — sonst gilt eine Nachricht als kurz genug, die LinkedIn
  // danach abschneidet.
  let problems = messageProblems(message, personalizationWords, signature);
  if (problems.length > 0) {
    // Eine Korrekturrunde, wie beim Sequenzgenerator. Was danach uebrig
    // bleibt, wird trotzdem geliefert — eine Vorlage mit zwanzig Zeichen zu
    // viel ist mehr wert als eine Fehlermeldung.
    const zweiter = await callOpenAi(openaiKey, [
      { role: "user", content: prompt },
      { role: "system", content: messageCorrection(problems) },
    ]);
    if (zweiter.ok) {
      await recordOpenAiUsage(supabase, workspaceId, "copy_linkedin", zweiter.json);
      const nachgebessert = freeStandingPersonalization(cleanLinkedInMessage(zweiter.text));
      if (nachgebessert) {
        message = nachgebessert;
        problems = messageProblems(message, personalizationWords, signature);
      }
    }
  }

  // Zuletzt und genau einmal: die Signatur daruntersetzen. Mechanisch, wie das
  // Freistellen des Aufhaengers — was eine reine Formsache ist, wird repariert
  // und nicht erbeten. Hat das Modell trotz Verbot selbst unterschrieben,
  // bleibt es bei seiner Fassung statt bei zwei Signaturen.
  message = appendSignature(message, signature);

  return NextResponse.json({
    message,
    // Zur Anzeige, nicht zur Ablehnung: der Nutzer sieht die geschaetzte
    // Endlaenge und die Platzhalter, die niemand ersetzt.
    estimatedLength: estimateLinkedInLength(message, personalizationWords),
    maxLength: LINKEDIN_MAX_CHARS,
    unknownPlaceholders: unknownPlaceholders(message),
  });
}
