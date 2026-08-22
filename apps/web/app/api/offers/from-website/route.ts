import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { fetchWebsiteContent, normalizeWebsiteUrl } from "@/lib/website-text";
import { buildOfferPrompt, parseOfferSuggestion } from "@/lib/copy/offer-from-website";
import { cleanProduct } from "@/lib/copy/offer-products";
import { defsFor, parseCustomFields } from "@/lib/copy/offer-custom-fields";
import { loadFieldDefs } from "@/lib/offer-field-defs";

/**
 * Die eigene Website lesen und daraus Feldvorschlaege machen.
 *
 * Was zurueckkommt, wird NICHT gespeichert. Der Nutzer uebernimmt jedes Feld
 * einzeln: eine falsch gelesene Website vergiftet sonst unsichtbar jede
 * spaeter erzeugte Mail (siehe lib/copy/offer-from-website.ts).
 *
 * Der Abruf laeuft hier und nicht im Worker: er ist ein einzelner,
 * interaktiver Handgriff mit sofortiger Antwort. Ein Job in der Queue haette
 * fuenf Sekunden Wartezeit und eine Zustandsanzeige noetig, fuer einen
 * Knopf, der einmal je Angebot gedrueckt wird.
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
  const url = normalizeWebsiteUrl(String(body?.website ?? ""));
  if (!url) return NextResponse.json({ error: "Keine gültige Adresse." }, { status: 400 });
  const language = body?.language === "en" ? "en" : "de";
  /**
   * Auf welche der beschriebenen Sachen dieses Angebot zielt, optional.
   *
   * Gesetzt nur, wenn api/offers/detect-products auf derselben Seite mehrere
   * gefunden HAT und der Nutzer danach eine gewaehlt hat (auch von Hand
   * eingetippt). Fehlt der Wert, ist der Prompt Wort fuer Wort der von vorher.
   * Wie in api/offers/from-search wird der Wert bewusst nicht gegen die
   * Erkennung geprueft: das Freitextfeld existiert genau fuer den Fall, dass
   * die Erkennung danebenlag.
   */
  const product = cleanProduct(body?.product);

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  // Abruf und Entkernung stehen in lib/website-text.ts, weil
  // api/offers/detect-products dieselbe Seite liest (siehe dort).
  const seite = await fetchWebsiteContent(url);
  if (!seite.ok) return NextResponse.json({ error: seite.error }, { status: seite.status });

  // Die eigenen Felder des Workspaces, gefiltert auf die, die CORE fuellen
  // darf (Migration 0098). Ein Workspace ohne eigene Felder bekommt eine leere
  // Liste, und dann ist der Prompt Wort fuer Wort der von vorher.
  const eigene = defsFor(await loadFieldDefs(supabase, workspaceId), "core");

  const result = await callOpenAi(openaiKey, [
    { role: "user", content: buildOfferPrompt(seite.content, language, product, eigene) },
  ]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "offer_from_website", result.json);

  const suggestion = parseOfferSuggestion(result.text);
  // Getrennt von `suggestion`, damit das Formular beides einzeln uebernehmen
  // kann: die zwoelf festen Felder sind typisiert, die eigenen stehen unter
  // ihrem Schluessel. Gespeichert wird auch hier nichts.
  const custom = parseCustomFields(result.text, eigene);
  if (Object.keys(suggestion).length === 0 && Object.keys(custom).length === 0) {
    return NextResponse.json(
      { error: "Aus der Seite liess sich nichts ableiten. Bitte von Hand ausfüllen." },
      { status: 422 }
    );
  }
  return NextResponse.json({ suggestion, custom });
}
