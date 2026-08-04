/**
 * Antwortvorschlaege auf eine eingegangene Antwort.
 *
 * WOFUER
 *
 * Am 2026-08-04 lagen 8 eingegangene Mails im Posteingang und 0 vereinbarte
 * Termine. Zwischen "hat geantwortet" und "hat gekauft" liegt genau eine
 * Stelle, und dort passierte bisher nichts: die Antwort kam an, wurde
 * eingestuft -- und dann musste der Nutzer selbst formulieren, meist Stunden
 * spaeter. Bei Kaltakquise ist das genau das Zeitfenster, in dem eine
 * Antwort noch warm ist.
 *
 * Hier steht das, was man testen kann: wie aus dem Gespraech ein Auftrag ans
 * Modell wird, und wie aus dessen Antwort drei benutzbare Entwuerfe werden.
 * Der Aufruf selbst sitzt in api/inbox/suggest-reply.
 */

export type ThreadMessage = {
  direction: "inbound" | "outbound";
  subject: string | null;
  body: string | null;
  sent_at: string | null;
};

export type SuggestionContext = {
  /** Was die KI-Einstufung des Sync ergeben hat, falls vorhanden. */
  interest: string | null;
  /** Terminlink aus den Einstellungen. Ohne ihn darf kein Vorschlag einen erfinden. */
  calendarLink: string | null;
  /** Wie der Absender unterschreibt. */
  senderName: string | null;
};

export type ReplySuggestion = { label: string; text: string };

/** Wie viel Gespraech ins Modell geht. Aeltere Mails tragen zur Antwort nichts bei. */
const MAX_MESSAGES = 6;
/** Je Nachricht. Reicht fuer den Inhalt, deckelt einen zitierten Verlauf. */
const MAX_CHARS = 1200;

/**
 * Was das Modell tun soll.
 *
 * Die harten Regeln sind hier wichtiger als die Formulierungskunst:
 *
 * - Genau drei Vorschlaege, klar unterschieden. Drei Varianten desselben
 *   Satzes waeren ein Vorschlag mit zwei Kopien.
 * - KEIN Terminlink, wenn keiner hinterlegt ist. Ein Modell, das eine
 *   plausible Calendly-Adresse erfindet, produziert einen toten Link in einer
 *   echten Geschaeftsmail -- der Fehler faellt erst dem Empfaenger auf.
 * - Kurz. Eine lange Antwort auf eine kurze Antwort wirkt wie ein Automat.
 * - Die Sprache des Gespraechs, nicht die der Oberflaeche. Wer auf Englisch
 *   schreibt, bekommt Englisch zurueck.
 */
export function buildReplyPrompt(thread: ThreadMessage[], ctx: SuggestionContext): string {
  const lines = [
    "Du hilfst beim Beantworten einer Antwort auf eine Akquise-Mail.",
    "Liefere GENAU DREI Antwortentwuerfe, die sich in der Absicht klar unterscheiden",
    "(zum Beispiel: Termin vorschlagen, Rueckfrage beantworten, hoeflich zurueckziehen).",
    "",
    "Regeln:",
    "- Jeder Entwurf ist eine vollstaendige, sofort absendbare Mail ohne Betreff.",
    "- Hoechstens 80 Woerter. Auf eine kurze Antwort lang zu antworten wirkt wie ein Automat.",
    "- Schreibe in der Sprache, in der der Empfaenger geschrieben hat.",
    "- Keine Platzhalter in eckigen oder geschweiften Klammern. Was du nicht weisst, laesst du weg.",
  ];

  if (ctx.calendarLink) {
    lines.push(`- Wo ein Termin passt, nutze genau diesen Link: ${ctx.calendarLink}`);
  } else {
    // Der wichtigste Satz im ganzen Prompt: ein erfundener Terminlink faellt
    // erst dem Empfaenger auf, und dann ist die Antwort verbrannt.
    lines.push(
      "- Es ist KEIN Terminlink hinterlegt. Erfinde keinen. Schlage stattdessen konkrete Zeitfenster vor."
    );
  }
  if (ctx.senderName) lines.push(`- Unterschreibe mit: ${ctx.senderName}`);
  if (ctx.interest) lines.push(`- Die Antwort wurde eingestuft als: ${ctx.interest}`);

  lines.push(
    "",
    'Antworte ausschliesslich mit JSON: [{"label":"kurze Bezeichnung","text":"die Mail"}, ...]',
    "",
    "Das bisherige Gespraech (aelteste zuerst):",
    formatThread(thread)
  );

  return lines.join("\n");
}

/** Nur die letzten Nachrichten, jede gekuerzt -- ein zitierter Verlauf blaeht sonst alles auf. */
export function formatThread(thread: ThreadMessage[]): string {
  return thread
    .slice(-MAX_MESSAGES)
    .map((m) => {
      const who = m.direction === "inbound" ? "EMPFAENGER" : "WIR";
      const text = (m.body ?? "").trim().slice(0, MAX_CHARS);
      return `[${who}] ${m.subject ?? ""}\n${text}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Die Antwort des Modells in benutzbare Entwuerfe verwandeln.
 *
 * Bewusst nachsichtig: GPT liefert das angeforderte JSON meistens, aber nicht
 * immer -- mal in einem ```json-Block, mal mit einem Satz davor. Daran zu
 * scheitern hiesse, dem Nutzer eine Fehlermeldung zu zeigen, obwohl die
 * Antwort direkt davor steht.
 *
 * Was NICHT nachsichtig ist: leere Entwuerfe und uebrig gebliebene
 * Platzhalter fliegen raus. Ein Vorschlag mit "[Dein Name]" darin ist keine
 * Zeitersparnis, sondern eine Falle -- genau so etwas geht versehentlich raus.
 */
export function parseSuggestions(raw: string): ReplySuggestion[] {
  const json = extractJsonArray(raw);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item, i) => {
      const obj = item as Record<string, unknown>;
      const text = typeof obj?.text === "string" ? obj.text.trim() : "";
      const label = typeof obj?.label === "string" && obj.label.trim() ? obj.label.trim() : `Entwurf ${i + 1}`;
      return { label, text };
    })
    .filter((s) => s.text.length > 0 && !hasPlaceholder(s.text))
    .slice(0, 3);
}

/** [Dein Name], {{firstName}}, <Firma> -- alles, was noch ausgefuellt werden muesste. */
export function hasPlaceholder(text: string): boolean {
  return /\[[^\]]{2,40}\]|\{\{[^}]{1,40}\}\}|<[A-Za-zÄÖÜäöü][^>]{1,40}>/.test(text);
}

/** Das erste JSON-Array im Text -- auch wenn ein Satz oder ein Codeblock drumherum steht. */
function extractJsonArray(raw: string): string | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}
