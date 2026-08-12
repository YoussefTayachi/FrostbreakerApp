// Kleine, geteilte Helfer fuer Aufrufe gegen die OpenAI Responses API
// (https://api.openai.com/v1/responses). Kein SDK -- ein Bearer-Header reicht,
// und ein Rohaufruf laesst sich problemlos aus Server-Komponenten UND aus
// Vercel-Cron-Routen verwenden, ohne Client-Bundle-Groesse zu beeinflussen.

/** Das Modell fuer alle Texterzeugung im Web. Muss mit MODEL in
 *  apps/worker/worker/pipelines/personalize.py uebereinstimmen -- sonst
 *  klingen erzeugte Sequenz und erzeugter Aufhaenger unterschiedlich, und der
 *  Live-Test prueft etwas anderes als der Worker spaeter tut. */
export const OPENAI_MODEL = "gpt-4.1-mini";

export type OpenAiResult = { ok: true; json: unknown; text: string } | { ok: false; error: string };

/**
 * Ein Aufruf gegen die Responses-API.
 *
 * Gibt die ROHE Antwort mit zurueck und nicht nur den Text: der Tokenverbrauch
 * steht im json-Teil, und ohne ihn kann lib/usage.ts keine Kostenzeile
 * schreiben. Genau daran ist die Kostenerfassung im Web bisher vorbeigelaufen
 * -- die Aufrufer haben sich nur den Text geholt und den Rest weggeworfen.
 */
export async function callOpenAi(
  apiKey: string,
  input: { role: "system" | "user"; content: string }[],
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
