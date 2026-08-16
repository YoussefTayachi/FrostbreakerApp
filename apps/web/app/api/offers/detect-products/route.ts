import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { buildProductDetectPrompt, parseProductDetection } from "@/lib/copy/offer-products";

/**
 * Beschreibt dieses Angebot EINE Sache oder mehrere?
 *
 * WARUM EINE EIGENE ROUTE
 *
 * Die Oberflaeche muss auf "mehrere gefunden" reagieren, BEVOR der teure
 * Zuschnitt laeuft (api/offers/from-search): erst danach zu fragen hiesse,
 * einen bereits bezahlten Vorschlag wegzuwerfen. Als Vorstufe IN der anderen
 * Route haette diese eine zweite Antwortform gebraucht ("hier sind Produkte,
 * aber keine Vorschlaege") -- eine Route, die zwei verschiedene Dinge
 * zurueckgeben kann, ist die naechste, die jemand falsch behandelt.
 *
 * WAS SIE KOSTET
 *
 * Einen Aufruf mit rund 200 Tokens Eingabe und einer Handvoll Ausgabe. Die
 * Oberflaeche fragt hoechstens einmal je Angebotsstand (siehe
 * offers-editor.tsx) -- der Wechsel zwischen zwei Listen loest keinen zweiten
 * Aufruf aus.
 *
 * Ein leeres `products` heisst "eindeutig". Das ist auch die Antwort, wenn im
 * Feld gar nichts steht: dann gibt es nichts zu unterscheiden, und der Aufruf
 * unterbleibt ganz.
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
  const offerId = (body?.offerId as string | undefined)?.trim();
  if (!offerId) return NextResponse.json({ error: "offerId fehlt" }, { status: 400 });

  // Workspace-Filter zusaetzlich zur RLS: RLS regelt, auf welche Accounts
  // jemand zugreifen darf -- nicht, welcher der eigenen Workspaces gemeint ist
  // (siehe CLAUDE.md).
  const { data: offer } = await supabase
    .from("offers")
    .select("offering, icp, language")
    .eq("id", offerId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!offer) return NextResponse.json({ error: "Angebot nicht gefunden." }, { status: 404 });

  const offering = (offer.offering ?? "").trim();
  // Kein Text, keine Frage -- und vor allem kein bezahlter Aufruf dafuer.
  if (!offering) return NextResponse.json({ products: [] });

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  const prompt = buildProductDetectPrompt(
    offering,
    (offer.icp ?? "").trim(),
    offer.language === "en" ? "en" : "de"
  );
  const result = await callOpenAi(openaiKey, [{ role: "user", content: prompt }]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "offer_detect_products", result.json);

  // Kein 422 bei leerer Liste: "eindeutig" ist hier das haeufigste und ein
  // vollkommen richtiges Ergebnis, kein Fehlschlag.
  return NextResponse.json({ products: parseProductDetection(result.text) });
}
