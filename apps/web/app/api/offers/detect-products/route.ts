import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { fetchWebsiteContent, normalizeWebsiteUrl } from "@/lib/website-text";
import {
  buildProductDetectPrompt,
  hasProductMaterial,
  parseProductDetection,
  type ProductSource,
} from "@/lib/copy/offer-products";

/**
 * Beschreibt das EINE Sache oder mehrere?
 *
 * ZWEI EINGAENGE, EINE FRAGE
 *
 *  - `{ offerId }`            das Feld "was verkaufst du" eines Angebots (Aim,
 *                             vor dem Zuschnitt auf eine Lead-Liste)
 *  - `{ website, language }`  die eigene Website (Core, vor dem ersten
 *                             Angebotsentwurf -- dann gibt es das Feld noch
 *                             nicht)
 *
 * Beurteilt wird beides mit demselben Prompt (lib/copy/offer-products.ts).
 * Zwei Routen waeren zwei Stellen, an denen dieselbe Frage anders beantwortet
 * wird.
 *
 * WARUM EINE EIGENE ROUTE
 *
 * Die Oberflaeche muss auf "mehrere gefunden" reagieren, BEVOR der teure
 * Aufruf laeuft (api/offers/from-search bzw. api/offers/from-website): erst
 * danach zu fragen hiesse, einen bereits bezahlten Vorschlag wegzuwerfen. Als
 * Vorstufe IN der anderen Route haette diese eine zweite Antwortform gebraucht
 * ("hier sind Produkte, aber keine Vorschlaege") -- eine Route, die zwei
 * verschiedene Dinge zurueckgeben kann, ist die naechste, die jemand falsch
 * behandelt.
 *
 * WAS SIE KOSTET
 *
 * Einen Aufruf mit rund 200 Tokens Eingabe (Website: bis rund 3.000) und einer
 * Handvoll Ausgabe. Die Oberflaeche merkt sich die Antwort je Angebotsstand
 * bzw. je Adresse (siehe offers-editor.tsx) -- ein zweiter Klick auf denselben
 * Stand loest keinen zweiten Aufruf aus.
 *
 * Auf dem Website-Weg wird die Seite zweimal geholt: einmal hier, einmal
 * gleich danach in api/offers/from-website. Das kostet keine fremden Credits,
 * nur einen zweiten GET auf die eigene Seite. Die Alternativen waeren die
 * oben verworfene Doppel-Antwortform oder 12.000 Zeichen Seitentext durch den
 * Browser zu reichen -- den der Client dann veraendert zurueckschicken
 * koennte, in einen bezahlten Prompt hinein.
 *
 * Ein leeres `products` heisst "eindeutig". Das ist auch die Antwort, wenn es
 * nichts zu lesen gibt (leeres Feld, unerreichbare Seite): dann gibt es nichts
 * zu unterscheiden, und der bezahlte Aufruf unterbleibt ganz.
 */
// 45 wie api/offers/from-website: seit dem Website-Weg steckt in dieser Route
// ein fremder Seitenabruf (bis 12 s) vor dem Modellaufruf.
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
  const website = String(body?.website ?? "").trim();
  const offerId = (body?.offerId as string | undefined)?.trim();

  let source: ProductSource;
  let language: "de" | "en";

  if (website) {
    const url = normalizeWebsiteUrl(website);
    if (!url) return NextResponse.json({ error: "Keine gültige Adresse." }, { status: 400 });
    // Die Sprache kommt vom Formular, weil es das Angebot noch nicht geben
    // muss -- Core legt es ja erst an.
    language = body?.language === "en" ? "en" : "de";
    const seite = await fetchWebsiteContent(url);
    // Eine Seite, die sich nicht lesen laesst, ist hier keine Fehlermeldung
    // wert: der Hauptaufruf laeuft gleich danach auf dieselbe Seite und meldet
    // es mit dem Satz, der dem Nutzer sagt, was zu tun ist. Zweimal derselbe
    // Fehler waere einmal zu viel -- und eine Zwischenfrage, die nicht
    // gestellt werden kann, darf den Entwurf nicht verhindern.
    if (!seite.ok) return NextResponse.json({ products: [] });
    source = { kind: "website", content: seite.content };
  } else {
    if (!offerId) return NextResponse.json({ error: "offerId oder website fehlt" }, { status: 400 });
    // Workspace-Filter zusaetzlich zur RLS: RLS regelt, auf welche Accounts
    // jemand zugreifen darf -- nicht, welcher der eigenen Workspaces gemeint
    // ist (siehe CLAUDE.md).
    const { data: offer } = await supabase
      .from("offers")
      .select("offering, icp, language")
      .eq("id", offerId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!offer) return NextResponse.json({ error: "Angebot nicht gefunden." }, { status: 404 });
    language = offer.language === "en" ? "en" : "de";
    source = {
      kind: "offering",
      offering: (offer.offering ?? "").trim(),
      icp: (offer.icp ?? "").trim(),
    };
  }

  // Kein Material, keine Frage -- und vor allem kein bezahlter Aufruf dafuer.
  if (!hasProductMaterial(source)) return NextResponse.json({ products: [] });

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  const prompt = buildProductDetectPrompt(source, language);
  const result = await callOpenAi(openaiKey, [{ role: "user", content: prompt }]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "offer_detect_products", result.json);

  // Kein 422 bei leerer Liste: "eindeutig" ist hier das haeufigste und ein
  // vollkommen richtiges Ergebnis, kein Fehlschlag.
  return NextResponse.json({ products: parseProductDetection(result.text) });
}
