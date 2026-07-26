// Kleine, geteilte Helfer fuer Aufrufe gegen die OpenAI Responses API
// (https://api.openai.com/v1/responses). Kein SDK -- ein Bearer-Header reicht,
// und ein Rohaufruf laesst sich problemlos aus Server-Komponenten UND aus
// Vercel-Cron-Routen verwenden, ohne Client-Bundle-Groesse zu beeinflussen.

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
