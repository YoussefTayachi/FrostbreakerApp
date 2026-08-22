import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import {
  MAX_PERSONALIZATION_EXAMPLES,
  constraintBlock,
  sanitizeBannedPunctuation,
  validateIcebreaker,
  wordCount,
} from "@/lib/personalization-defaults";
import { OPENAI_MODEL, extractOutputText } from "@/lib/openai";
import {
  buildClaudeMessages,
  buildClaudeSystem,
  callClaude,
  type ClaudeExample,
} from "@/lib/anthropic";
import { recordClaudeUsage, recordOpenAiUsage } from "@/lib/usage";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_SITE_CHARS = 6000;

function stripHtml(html: string): string {
  // Leichtgewichtige Vorschau-Extraktion (kein Aequivalent zu trafilatura im Worker);
  // ausreichend fuer den Live-Test, nicht fuer die Produktions-Pipeline.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ein Modellaufruf des Live-Tests.
 *
 * supabase und workspaceId stehen hier fuer die Kostenzeile: der Live-Test
 * kostet echtes Geld, und bei einem Regelverstoss kostet er es zweimal (der
 * Korrektur-Versuch weiter unten). Bis zum 2026-08-12 schrieb diese Route
 * nichts nach api_usage; der Verbrauch war unsichtbar, obwohl er derselbe
 * ist wie beim Worker.
 */
async function callModel(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string,
  systemPrompt: string,
  userContent: string
): Promise<{ text?: string; error?: string }> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    return { error: "OpenAI-Fehler: " + errBody.slice(0, 300) };
  }
  const json = await res.json();
  await recordOpenAiUsage(supabase, workspaceId, "personalize_test", json);
  return { text: extractOutputText(json) };
}

/**
 * Ein Modellaufruf des Live-Tests ueber Claude.
 *
 * WARUM ES DAS GEBEN MUSS
 *
 * Diese Route rief bis dahin fest OpenAI auf. Sobald der AI-Agent-Tab
 * "Claude" anzeigt, wuerde die Seite damit luegen: der Test prueft dann ein
 * anderes Modell, einen anderen Nachrichtenaufbau und ohne die hinterlegten
 * Beispiele, waehrend der Worker spaeter genau die benutzt. Der Live-Test ist
 * aber die einzige Stelle, an der jemand VOR einer teuren Suche sieht, was
 * seine Einstellungen bewirken.
 *
 * Der Nachrichtenaufbau kommt deshalb aus lib/anthropic.ts, das ausdruecklich
 * an generate_claude() in personalize.py gebunden ist.
 */
async function callClaudeModel(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string,
  systemPrompt: string,
  companyName: string,
  context: string,
  examples: ClaudeExample[],
  correction?: string | null
): Promise<{ text?: string; error?: string }> {
  const result = await callClaude(
    apiKey,
    buildClaudeSystem(systemPrompt, examples.length),
    buildClaudeMessages(companyName, context, examples, correction)
  );
  if (!result.ok) return { error: result.error };
  await recordClaudeUsage(supabase, workspaceId, "personalize_test", result.json);
  return { text: result.text };
}

async function fetchWebsiteText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FrostbreakerBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html);
    return text.length > 100 ? text.slice(0, MAX_SITE_CHARS) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const businessId: string = body.business_id;
  const systemPrompt: string = (body.system_prompt ?? "").trim();
  const source: string = body.source ?? "company_summary";
  const maxWords: number = Number(body.max_words) || 22;
  const bannedWords: string[] = Array.isArray(body.banned_words) ? body.banned_words : [];
  // lang = Sprache der Oberflaeche, steuert nur die Beschriftung der
  // Regelverstoesse. outputLang = Sprache des Icebreakers. Die beiden zu
  // vermengen war der gemeldete Fehler (siehe Migration 0083).
  const lang: "de" | "en" = body.lang === "en" ? "en" : "de";
  const outputLang: "de" | "en" = body.output_lang === "en" ? "en" : "de";
  // Wie output_lang ungespeichert mitgeschickt: der Test soll zeigen, was die
  // aktuelle Auswahl bewirkt. Alles ausser "claude" ist OpenAI, also der
  // Standard; ein unbekannter Wert faellt genauso zurueck wie im Worker.
  const useClaude: boolean = body.model === "claude";

  if (!businessId || !systemPrompt) {
    return NextResponse.json({ error: "business_id und system_prompt sind Pflicht" }, { status: 400 });
  }

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const { data: biz } = await supabase
    .from("businesses")
    .select("id, name, company_summary, website")
    .eq("id", businessId)
    .eq("workspace_id", ws.workspace.id)
    .single();
  if (!biz) return NextResponse.json({ error: "Firma nicht gefunden" }, { status: 404 });

  let context = "";
  if (source === "company_summary" || source === "both") {
    if (biz.company_summary) context += "Firmenbeschreibung:\n" + biz.company_summary;
  }
  if (source === "website_text" || source === "both") {
    const siteText = biz.website ? await fetchWebsiteText(biz.website) : null;
    if (siteText) context += (context ? "\n\n" : "") + "Website-Text:\n" + siteText;
  }
  if (!context) {
    return NextResponse.json(
      { error: "Für diese Firma sind keine Daten für die gewählte Quelle verfügbar." },
      { status: 400 }
    );
  }

  const provider = useClaude ? "anthropic" : "openai";
  const apiKey = await getApiKey(supabase, ws.workspace.id, provider);
  if (!apiKey) {
    return NextResponse.json(
      {
        error: useClaude
          ? "Kein Anthropic-Key in den Einstellungen hinterlegt."
          : "Kein OpenAI-Key in den Einstellungen hinterlegt.",
      },
      { status: 400 }
    );
  }

  // Die Beispiele kommen aus der Datenbank und nicht aus dem Request: sie
  // werden im AI-Agent-Tab sofort gespeichert, und der Worker liest sie
  // genauso. .eq("workspace_id", ...) ist Pflicht, RLS entscheidet nur, auf
  // welche Accounts jemand zugreifen darf, nicht welcher der eigenen
  // Workspaces gemeint ist.
  let examples: ClaudeExample[] = [];
  if (useClaude) {
    const { data: rows } = await supabase
      .from("personalization_examples")
      .select("input_context, icebreaker")
      .eq("workspace_id", ws.workspace.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(MAX_PERSONALIZATION_EXAMPLES);
    // Dieselbe Aussortierung wie load_examples() im Worker: ein halbes Paar
    // bringt dem Modell die falsche Abbildung bei.
    examples = (rows ?? [])
      .map((r) => ({
        input_context: (r.input_context ?? "").trim(),
        icebreaker: (r.icebreaker ?? "").trim(),
      }))
      .filter((r) => r.input_context && r.icebreaker);
  }

  const userContent = `Unternehmen: ${biz.name}\n\n${context}`;
  // Derselbe Anhang, den auch der Worker an JEDEN Prompt haengt. Fehlte er
  // hier, pruefte der Live-Test einen anderen Prompt als den, der spaeter
  // laeuft, und genau daran war der Sprachfehler so schwer zu sehen: der
  // Test bekam den angezeigten englischen Prompt und lieferte Englisch,
  // waehrend der Worker aus der Datenbank Deutsch nahm.
  const effectivePrompt = systemPrompt + constraintBlock(maxWords, bannedWords, outputLang);

  // Feste Bindungen fuer die Closure darunter: TypeScript traegt die
  // Null-Pruefungen von oben nicht in eine verschachtelte Funktion hinein.
  const workspaceId = ws.workspace.id;
  const companyName: string = biz.name;
  const key: string = apiKey;

  /** Ein Aufruf, egal welches Modell. Eine Stelle, damit die Nachbehandlung
   *  darunter fuer beide Wege gleich bleibt, genau wie in personalize.py. */
  async function runModel(correction?: string | null) {
    if (useClaude) {
      return callClaudeModel(
        supabase,
        workspaceId,
        key,
        effectivePrompt,
        companyName,
        context,
        examples,
        correction
      );
    }
    return callModel(
      supabase,
      workspaceId,
      key,
      effectivePrompt,
      correction ? userContent + "\n\n" + correction : userContent
    );
  }

  const first = await runModel();
  if (first.error) return NextResponse.json({ error: first.error }, { status: 502 });

  let text = first.text ?? "";
  let problems = validateIcebreaker(text, maxWords, bannedWords, lang);
  let corrected = false;

  // Spiegelt exakt den Korrektur-Versuch aus worker/pipelines/personalize.py
  // (generate()/generate_claude() mit correction-Parameter): sonst zeigt der
  // Live-Test nur den unkorrigierten Rohentwurf und suggeriert, ein erkannter
  // Regelverstoss (z.B. verbotenes Wort) wuerde bei echten Leads einfach so
  // gespeichert; dabei greift dort immer dieser zweite Versuch.
  if (problems.length > 0) {
    const correctionNote =
      lang === "en"
        ? `Your last attempt violated the following rule(s): ${problems.join("; ")}. Please correct it and answer again with only the text itself.`
        : `Dein letzter Versuch hat folgende Regel(n) verletzt: ${problems.join("; ")}. Bitte korrigiere und antworte erneut nur mit dem Text selbst.`;
    const retry = await runModel(correctionNote);
    if (retry.text) {
      text = sanitizeBannedPunctuation(retry.text, bannedWords);
      problems = validateIcebreaker(text, maxWords, bannedWords, lang);
      corrected = true;
    }
  }

  return NextResponse.json({
    text,
    problems,
    source,
    wordCount: wordCount(text),
    corrected,
    // Damit die Oberflaeche sagen kann, WAS da geprueft wurde. Ein Testlauf,
    // der nicht dazusagt, welches Modell und wie viele Beispiele er benutzt
    // hat, ist bei zwei Modellen nur halb so viel wert.
    model: useClaude ? "claude" : "openai",
    exampleCount: examples.length,
  });
}
