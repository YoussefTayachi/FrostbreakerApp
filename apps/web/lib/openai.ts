// Kleine, geteilte Helfer fuer Aufrufe gegen die OpenAI Responses API
// (https://api.openai.com/v1/responses). Kein SDK: ein Bearer-Header reicht,
// und ein Rohaufruf laesst sich problemlos aus Server-Komponenten UND aus
// Vercel-Cron-Routen verwenden, ohne Client-Bundle-Groesse zu beeinflussen.

/** Das Modell fuer alle Texterzeugung im Web. Muss mit MODEL in
 *  apps/worker/worker/pipelines/personalize.py uebereinstimmen; sonst
 *  klingen erzeugte Sequenz und erzeugter Aufhaenger unterschiedlich, und der
 *  Live-Test prueft etwas anderes als der Worker spaeter tut. */
export const OPENAI_MODEL = "gpt-4.1-mini";

/** Ein Eintrag der input-Liste der Responses-API.
 *
 *  Erlaubt sind genau vier Rollen: user, assistant, system, developer
 *  (nachgesehen am 2026-08-22 auf
 *  https://developers.openai.com/api/reference/resources/responses/methods/create).
 *  "developer" brauchen wir nirgends, deshalb steht es hier nicht. */
export type OpenAiInputMessage = { role: "system" | "user" | "assistant"; content: string };

/** Ein hinterlegtes Few-Shot-Paar (personalization_examples). */
export type PersonalizationExample = { input_context: string; icebreaker: string };

/**
 * Die input-Liste fuer die Icebreaker-Personalisierung.
 *
 * MUSS mit build_input() in apps/worker/worker/pipelines/personalize.py
 * uebereinstimmen. Dort steht die ausfuehrliche Begruendung; hier die
 * Kurzfassung, damit beim Aendern klar ist, was daran haengt:
 *
 *  - Die Beispiele sind abwechselnde user/assistant-Turns VOR der echten
 *    Anfrage, nicht eine Aufzaehlung im System-Prompt. Das Modell sieht damit
 *    die Abbildung, die es nachmachen soll, an der Stelle, an der es sie
 *    anwenden muss.
 *  - Der Beispiel-User-Turn ist der hinterlegte Kontext, unveraendert. Ein
 *    erfundener Platzhalter-Firmenname waere in jedem Beispiel derselbe und
 *    damit selbst Teil des gelernten Musters.
 *  - Der Beispiel-Assistant-Turn ist die blanke Zeile, ohne
 *    Anfuehrungszeichen und ohne Label.
 *  - Der Korrektur-Hinweis haengt am LETZTEN user-Turn, nie an einem
 *    Beispiel.
 *  - Die Reihenfolge system, Beispiele, echte Anfrage ist zugleich die, die
 *    OpenAI fuers Prompt-Caching verlangt: statischer Teil nach vorn,
 *    veraenderlicher ans Ende. Ein eigener Marker existiert dort nicht, das
 *    Caching laeuft ueber das Praefix.
 *
 * Weicht diese Funktion vom Worker ab, prueft der Live-Test im AI-Agent-Tab
 * etwas anderes als der Worker spaeter tut. Genau das ist bei der Sprachwahl
 * schon einmal passiert (siehe constraintBlock in lib/personalization-defaults.ts).
 */
export function buildPersonalizationInput(
  systemPrompt: string,
  companyName: string,
  context: string,
  examples: PersonalizationExample[] = [],
  correction?: string | null
): OpenAiInputMessage[] {
  const input: OpenAiInputMessage[] = [{ role: "system", content: systemPrompt }];
  for (const ex of examples) {
    input.push({ role: "user", content: ex.input_context });
    input.push({ role: "assistant", content: ex.icebreaker });
  }
  let userContent = `Unternehmen: ${companyName}\n\n${context}`;
  if (correction) userContent += `\n\n${correction}`;
  input.push({ role: "user", content: userContent });
  return input;
}

export type OpenAiResult = { ok: true; json: unknown; text: string } | { ok: false; error: string };

/**
 * Ein Aufruf gegen die Responses-API.
 *
 * Gibt die ROHE Antwort mit zurueck und nicht nur den Text: der Tokenverbrauch
 * steht im json-Teil, und ohne ihn kann lib/usage.ts keine Kostenzeile
 * schreiben. Genau daran ist die Kostenerfassung im Web bisher vorbeigelaufen:
 * die Aufrufer haben sich nur den Text geholt und den Rest weggeworfen.
 */
export async function callOpenAi(
  apiKey: string,
  input: OpenAiInputMessage[],
  timeoutMs = 45_000
): Promise<OpenAiResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: OPENAI_MODEL, input }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `OpenAI: ${res.status}` };
    const json = await res.json();
    return { ok: true, json, text: extractOutputText(json) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Extrahiert den reinen Text aus einer Responses-API-Antwort. */
export function extractOutputText(json: unknown): string {
  const j = json as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  const chunks: string[] = [];
  for (const item of j.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && c.text) chunks.push(c.text);
    }
  }
  return chunks.join("").trim().replace(/^"|"$/g, "");
}
