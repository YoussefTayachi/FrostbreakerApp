/**
 * Eine einzelne Fassung nachschaerfen: "kuerzer", "direkter", "mach daraus
 * eine Abschiedsmail".
 *
 * WARUM AM TEXT UND NICHT IM CHATFENSTER
 *
 * Ein leeres Chatfeld ist dasselbe leere Blatt wie ein leeres Textfeld, nur
 * mit blinkendem Cursor. Wer nicht weiss, was eine gute Mail ausmacht, tippt
 * dort "mach mir gute Mails". Am Text angedockt hat die Anweisung einen
 * Gegenstand: das Modell bekommt die aktuelle Fassung, das Angebot und genau
 * einen Auftrag, und der Nutzer sieht danach eine Fassung und nicht einen
 * Gespraechsverlauf, den er auch noch lesen muss.
 *
 * Das Modell darf hier NICHT frei umschreiben: es aendert das Angeforderte
 * und laesst den Rest stehen. Sonst kommt bei "kuerzer" eine voellig andere
 * Mail zurueck, und die Arbeit, die vorher in den Text geflossen ist, ist weg.
 */
import { FIRST_MAIL_MAX_WORDS } from "@/lib/campaign-readiness";
import type { Offer } from "@/lib/offers";
import { EMAIL_MERGE_TAGS, ownWordBudget, type DraftVariant } from "./sequence-prompt";

/** Deckel fuer die freie Anweisung. Alles darueber ist keine Anweisung mehr,
 *  sondern ein zweiter Prompt, und der gehoert nicht in dieses Feld. */
export const MAX_INSTRUCTION_CHARS = 300;

export type RefineOptions = {
  /** Ab 1 gezaehlt. Fuer Stufe 1 gelten die harten Grenzen des Torwarts. */
  stepNumber: number;
  personalizationWords: number;
  calendarLink: string | null;
  senderName: string | null;
};

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

export function buildRefinePrompt(
  offer: Offer,
  current: DraftVariant,
  instruction: string,
  opts: RefineOptions
): string {
  const sprache = LANGUAGE_NAMES[offer.language] ?? "German";
  const lines: string[] = [
    "You revise ONE cold outreach email. Change only what the instruction asks for.",
    "Everything the instruction does not mention stays as it is: same facts, same voice, same intent.",
    "",
    "THE INSTRUCTION:",
    instruction.trim().slice(0, MAX_INSTRUCTION_CHARS),
    "",
    `THIS IS STEP ${opts.stepNumber} OF THE SEQUENCE.`,
    "",
    "CURRENT VERSION:",
    `Subject: ${current.subject}`,
    current.body,
    "",
    "WHAT THE SENDER OFFERS (for context, do not pitch more than the current version does):",
    offer.offering.trim() || "(not specified)",
  ];

  if (offer.proof.trim()) lines.push(`Proof they may cite: ${offer.proof.trim()}`);
  // Gleiche Regel wie im Sequenzgenerator und in Migration 0073: was nicht da
  // ist, wird nicht erfunden. Beim Nachschaerfen ist die Gefahr sogar
  // groesser: "mach es ueberzeugender" liest ein Modell als Einladung,
  // Zahlen zu ergaenzen.
  else lines.push("They have NO proof. Never add clients, numbers, results or years of experience.");

  lines.push(
    "",
    "HARD RULES:",
    `- Write in ${sprache}.`,
    `- Placeholders: only ${EMAIL_MERGE_TAGS.map((t) => `{{${t}}}`).join(", ")}. No others, no [brackets].`,
    "- Never use the characters — – or --.",
    "- No exclamation marks, no ALL CAPS.",
    // Auch beim Nachschaerfen: "kuerzer" darf die Absaetze nicht
    // zusammenschieben und die Anrede nicht wegkuerzen. Beides hatte die
    // erste Fassung des Generators verloren.
    "- Keep the greeting line, the blank lines between paragraphs and the signature. Shortening is not flattening.",
    "- Paragraphs stay one to three sentences, separated by blank lines."
  );

  if (opts.stepNumber === 1) {
    lines.push(
      "- Keep {{personalization}} as the first line. It is replaced per recipient.",
      `- At most ${ownWordBudget(opts.personalizationWords)} words of your own (the token counts for roughly ${opts.personalizationWords} more, the hard limit is ${FIRST_MAIL_MAX_WORDS}).`,
      "- No link and no URL of any kind."
    );
  } else if (opts.calendarLink) {
    lines.push(`- If a meeting fits, use exactly this link: ${opts.calendarLink}`);
  } else {
    lines.push("- There is NO booking link. Never invent one.");
  }

  if (opts.senderName) lines.push(`- Sign with: ${opts.senderName}`);

  lines.push("", 'Answer with JSON only: {"subject":"...","body":"..."}');
  return lines.join("\n");
}

/** Das erste JSON-Objekt im Text. Gleiche Nachsicht wie ueberall in diesem
 *  Bereich: das Modell packt gern einen Satz oder einen Codeblock drumherum. */
export function parseVariant(raw: string, fallback: DraftVariant): DraftVariant | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const obj = parsed as { subject?: unknown; body?: unknown };
  const body = typeof obj?.body === "string" ? obj.body.trim() : "";
  if (!body) return null;
  const subject = typeof obj?.subject === "string" ? obj.subject.trim() : "";
  // Betreff darf fehlen: bei "mach den Text kuerzer" liefert das Modell
  // manchmal nur den Text. Den alten Betreff dann zu behalten ist richtiger,
  // als die Antwort zu verwerfen.
  return { subject: subject || fallback.subject, body };
}
