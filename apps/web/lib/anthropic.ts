// Kleine, geteilte Helfer fuer Aufrufe gegen die Anthropic Messages API
// (https://api.anthropic.com/v1/messages). Gegenstueck zu lib/openai.ts und
// aus demselben Grund ohne SDK: ein Header reicht, und ein Rohaufruf laesst
// sich aus Server-Komponenten UND aus Cron-Routen verwenden, ohne die
// Bundle-Groesse zu beeinflussen. Siehe den Kopf von lib/openai.ts.

/** Das Claude-Modell fuer die Personalisierung im Web. Muss mit CLAUDE_MODEL
 *  in apps/worker/worker/pipelines/personalize.py uebereinstimmen; sonst
 *  prueft der Live-Test etwas anderes, als der Worker spaeter tut. Genau
 *  dieselbe Kopplung besteht bei OPENAI_MODEL in lib/openai.ts. */
export const CLAUDE_MODEL = "claude-opus-5";

/** Wie im Worker: die Antwort ist ein Satz, aber Claude denkt standardmaessig
 *  mit, und diese Denk-Tokens zaehlen gegen max_tokens. Muss mit
 *  CLAUDE_MAX_TOKENS in personalize.py uebereinstimmen. */
export const CLAUDE_MAX_TOKENS = 8000;

/** Version des API-Vertrags, laut Anthropic-Doku bei jedem Rohaufruf
 *  mitzuschicken (Stand 2026-08-22). */
const ANTHROPIC_VERSION = "2023-06-01";

export type ClaudeExample = { input_context: string; icebreaker: string };

type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
export type ClaudeMessage = { role: "user" | "assistant"; content: string | TextBlock[] };

/**
 * Der Nachrichtenaufbau fuer die Personalisierung.
 *
 * MUSS mit generate_claude() in
 * apps/worker/worker/pipelines/personalize.py uebereinstimmen. Dort steht die
 * ausfuehrliche Begruendung; hier die Kurzfassung, damit beim Aendern klar
 * ist, was daran haengt:
 *
 *  - Die Beispiele sind abwechselnde user/assistant-Turns VOR der echten
 *    Anfrage, nicht eine Aufzaehlung im System-Prompt.
 *  - Der Beispiel-User-Turn ist der hinterlegte Kontext, unveraendert. Ein
 *    erfundener Platzhalter-Firmenname waere in jedem Beispiel derselbe und
 *    damit selbst Teil des gelernten Musters.
 *  - Der Beispiel-Assistant-Turn ist die blanke Zeile, ohne
 *    Anfuehrungszeichen und ohne Label.
 *  - Der Korrektur-Hinweis haengt am LETZTEN user-Turn, nie an einem
 *    Beispiel.
 *  - Genau ein cache_control-Punkt, am Ende des geteilten Vorspanns.
 */
export function buildClaudeMessages(
  companyName: string,
  context: string,
  examples: ClaudeExample[],
  correction?: string | null
): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];
  examples.forEach((ex, i) => {
    messages.push({ role: "user", content: ex.input_context });
    const answer: TextBlock = { type: "text", text: ex.icebreaker };
    if (i === examples.length - 1) answer.cache_control = { type: "ephemeral" };
    messages.push({ role: "assistant", content: [answer] });
  });

  let userContent = `Unternehmen: ${companyName}\n\n${context}`;
  if (correction) userContent += `\n\n${correction}`;
  messages.push({ role: "user", content: userContent });
  return messages;
}

/** Der System-Block. Traegt den cache_control-Punkt nur, wenn es keine
 *  Beispiele gibt, weil er dann selbst das Ende des geteilten Vorspanns ist. */
export function buildClaudeSystem(systemPrompt: string, exampleCount: number): TextBlock[] {
  const block: TextBlock = { type: "text", text: systemPrompt };
  if (exampleCount === 0) block.cache_control = { type: "ephemeral" };
  return [block];
}

export type ClaudeResult = { ok: true; json: unknown; text: string } | { ok: false; error: string };

/**
 * Ein Aufruf gegen die Messages-API.
 *
 * Gibt wie callOpenAi die ROHE Antwort mit zurueck und nicht nur den Text: der
 * Tokenverbrauch steht im json-Teil, und ohne ihn kann lib/usage.ts keine
 * Kostenzeile schreiben.
 */
export async function callClaude(
  apiKey: string,
  system: TextBlock[],
  messages: ClaudeMessage[],
  timeoutMs = 60_000
): Promise<ClaudeResult> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        // Wie im Worker: geringer Aufwand statt abgeschaltetem Denken.
        output_config: { effort: "low" },
        system,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Anthropic: ${res.status} ${body.slice(0, 300)}` };
    }
    const json = await res.json();
    // Eine Ablehnung kommt als HTTP 200 mit stop_reason 'refusal' und leerem
    // Text zurueck. Ohne diese Pruefung saehe sie aus wie ein geglueckter Lauf
    // mit leerem Ergebnis.
    if ((json as { stop_reason?: string })?.stop_reason === "refusal") {
      return { ok: false, error: "Claude hat die Anfrage abgelehnt." };
    }
    return { ok: true, json, text: extractClaudeText(json) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Extrahiert den reinen Text aus einer Messages-API-Antwort.
 *
 *  content ist eine LISTE von Bloecken. Neben text-Bloecken koennen dort
 *  thinking-Bloecke stehen, und die gehoeren nicht in den Icebreaker. */
export function extractClaudeText(json: unknown): string {
  const j = json as { content?: { type?: string; text?: string }[] };
  const chunks: string[] = [];
  for (const block of j?.content ?? []) {
    if (block.type === "text" && block.text) chunks.push(block.text);
  }
  return chunks.join("").trim().replace(/^"|"$/g, "");
}
