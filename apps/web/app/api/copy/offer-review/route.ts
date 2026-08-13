import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { OFFER_COLUMNS, type Offer } from "@/lib/offers";
import { buildCoachPrompt, parseCoachFindings } from "@/lib/copy/coach-prompt";

/**
 * THAW liest das Angebot gegen.
 *
 * Genau EIN Aufruf, keine Korrekturrunde. Anders als beim Sequenzgenerator
 * gibt es hier nichts nachzubessern: das Ergebnis ist eine Liste von Befunden,
 * und ein Befund, den das Modell im zweiten Anlauf anders formuliert, ist kein
 * besserer Befund -- er ist nur ein anderer.
 *
 * Prompt und Auswertung stehen in lib/copy/coach-prompt.ts (mit Tests). Hier
 * steht nur, woher das Angebot kommt.
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

  // Workspace-Filter zusaetzlich zur RLS -- siehe CLAUDE.md.
  const { data } = await supabase
    .from("offers")
    .select(OFFER_COLUMNS)
    .eq("id", offerId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!data) return NextResponse.json({ error: "Angebot nicht gefunden." }, { status: 404 });
  const offer = data as unknown as Offer;

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  const res = await callOpenAi(openaiKey, [{ role: "user", content: buildCoachPrompt(offer) }]);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "offer_review", res.json);

  // Eine leere Liste ist ein gueltiges Ergebnis und kommt oft vor -- deshalb
  // hier KEINE Fehlermeldung wie beim Sequenzgenerator, wo eine leere Antwort
  // bedeutet, dass etwas schiefging.
  return NextResponse.json({ findings: parseCoachFindings(res.text, offer) });
}
