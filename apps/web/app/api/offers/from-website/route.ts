import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { callOpenAi } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { extractWebsiteContent, hasEnoughContent, normalizeWebsiteUrl } from "@/lib/website-text";
import { buildOfferPrompt, parseOfferSuggestion } from "@/lib/copy/offer-from-website";

/**
 * Die eigene Website lesen und daraus Feldvorschlaege machen.
 *
 * Was zurueckkommt, wird NICHT gespeichert. Der Nutzer uebernimmt jedes Feld
 * einzeln -- eine falsch gelesene Website vergiftet sonst unsichtbar jede
 * spaeter erzeugte Mail (siehe lib/copy/offer-from-website.ts).
 *
 * Der Abruf laeuft hier und nicht im Worker: er ist ein einzelner,
 * interaktiver Handgriff mit sofortiger Antwort. Ein Job in der Queue haette
 * fuenf Sekunden Wartezeit und eine Zustandsanzeige noetig -- fuer einen
 * Knopf, der einmal je Angebot gedrueckt wird.
 */
export const maxDuration = 45;

/** Wie lange auf die fremde Seite gewartet wird. Grosszuegiger als noetig,
 *  aber weit unter maxDuration -- der Modellaufruf braucht danach auch noch
 *  Zeit. */
const SEITEN_TIMEOUT_MS = 12_000;

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

  const openaiKey = await getApiKey(supabase, workspaceId, "openai");
  if (!openaiKey) {
    return NextResponse.json(
      { error: "Kein OpenAI-Schluessel hinterlegt. Unter Einstellungen eintragen." },
      { status: 400 }
    );
  }

  let html: string;
  try {
    const res = await fetch(url, {
      // Gleicher Kennzeichner wie im Worker (personalize.py): wer den
      // Zugriff in seinen Logs sieht, soll erkennen koennen, wer da liest.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ThawBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(SEITEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Website antwortet mit ${res.status}.` }, { status: 502 });
    }
    html = await res.text();
  } catch {
    return NextResponse.json({ error: "Website nicht erreichbar." }, { status: 502 });
  }

  const content = extractWebsiteContent(html);
  if (!hasEnoughContent(content)) {
    // Ehrlich melden statt das Modell auf 40 Zeichen raten zu lassen. Der
    // haeufigste Fall dahinter: eine Seite, die ihren Inhalt erst im Browser
    // per JavaScript aufbaut.
    return NextResponse.json(
      { error: "Auf der Seite steht zu wenig Text. Bitte die Felder von Hand ausfüllen." },
      { status: 422 }
    );
  }

  const result = await callOpenAi(openaiKey, [
    { role: "user", content: buildOfferPrompt(content, language) },
  ]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  await recordOpenAiUsage(supabase, workspaceId, "offer_from_website", result.json);

  const suggestion = parseOfferSuggestion(result.text);
  if (Object.keys(suggestion).length === 0) {
    return NextResponse.json(
      { error: "Aus der Seite liess sich nichts ableiten. Bitte von Hand ausfüllen." },
      { status: 422 }
    );
  }
  return NextResponse.json({ suggestion });
}
