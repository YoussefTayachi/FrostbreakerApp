import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { OFFER_COLUMNS, type Offer } from "@/lib/offers";
import { DEFAULT_MAX_WORDS } from "@/lib/personalization-defaults";
import {
  buildSequencePrompt,
  correctionInstruction,
  parseSequence,
  sequenceProblems,
  type DraftStep,
  type SequenceOptions,
} from "@/lib/copy/sequence-prompt";

/**
 * Eine vollstaendige Mail-Sequenz aus dem hinterlegten Angebot.
 *
 * Der Weg zur Kampagne fuehrte bisher durch acht leere Textfelder. Hier
 * entstehen sie in einem Aufruf -- als Entwurf, den der Nutzer im
 * Kampagnenformular weiter bearbeitet. Nichts davon geht ungesehen raus: der
 * Torwart (campaign-readiness) bleibt davor stehen wie bisher.
 *
 * Prompt-Bau, Auswertung und Befunde stehen in lib/copy/sequence-prompt.ts
 * (mit Tests). Hier steht nur, woher das Angebot kommt und wie die eine
 * Korrekturrunde ablaeuft.
 *
 * Die Korrekturrunde ist dieselbe Bauart wie in personalize.py: erzeugen,
 * deterministisch pruefen, bei Verstoss EIN zweiter Versuch mit dem Befund im
 * Auftrag. Danach wird das Ergebnis trotzdem geliefert -- mit den
 * verbliebenen Befunden im Feld `problems`, damit die Oberflaeche sie
 * anzeigen kann. Ein Text, an dem noch zwei Woerter zu viel haengen, ist mehr
 * wert als eine Fehlermeldung.
 */
export const maxDuration = 60;

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

  // Workspace-Filter zusaetzlich zur RLS: RLS regelt, auf welche Accounts
  // jemand zugreifen darf -- nicht, welcher der eigenen Workspaces gemeint
  // ist (siehe CLAUDE.md).
  const { data: offer } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("id", offerId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!offer) return NextResponse.json({ error: "Angebot nicht gefunden." }, { status: 404 });

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("calendar_link, reply_sender_name, personalization_max_words")
    .eq("id", workspaceId)
    .single();

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  const opts: SequenceOptions = {
    calendarLink: workspace?.calendar_link ?? null,
    senderName: workspace?.reply_sender_name ?? null,
    // Dieselbe Wortgrenze, mit der der Worker den Aufhaenger erzeugt: sie
    // entscheidet, wie viel Platz in der ersten Mail uebrig bleibt.
    personalizationWords: workspace?.personalization_max_words || DEFAULT_MAX_WORDS,
    bestExample: null,
  };

  const prompt = buildSequencePrompt(offer as unknown as Offer, opts);

  const erster = await callOpenAi(openaiKey, [{ role: "user", content: prompt }]);
  if (!erster.ok) return NextResponse.json({ error: erster.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "copy_sequence", erster.json);

  let steps: DraftStep[] = parseSequence(erster.text);
  if (steps.length === 0) {
    // Ehrlich melden statt eine leere Sequenz zurueckzugeben: acht leere
    // Felder sehen aus wie ein Bedienfehler, und der Nutzer klickt dann
    // dreimal nach -- jedes Mal kostenpflichtig.
    return NextResponse.json(
      { error: "Kein brauchbarer Entwurf entstanden. Bitte erneut versuchen." },
      { status: 502 }
    );
  }

  let problems = sequenceProblems(steps, opts);
  let corrected = false;
  if (problems.length > 0) {
    const zweiter = await callOpenAi(openaiKey, [
      { role: "user", content: prompt },
      { role: "system", content: correctionInstruction(problems) },
    ]);
    if (zweiter.ok) {
      await recordOpenAiUsage(supabase, workspaceId, "copy_sequence", zweiter.json);
      const nachgebessert = parseSequence(zweiter.text);
      // Nur uebernehmen, wenn die Korrektur ueberhaupt etwas geliefert hat --
      // ein leerer zweiter Versuch darf einen brauchbaren ersten nicht
      // wegwerfen.
      if (nachgebessert.length > 0) {
        steps = nachgebessert;
        problems = sequenceProblems(steps, opts);
        corrected = true;
      }
    }
  }

  return NextResponse.json({ steps, problems, corrected });
}
