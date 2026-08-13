/**
 * Eine LinkedIn-Vorlage aus demselben Angebot.
 *
 * WARUM DAS HIER UEBERHAUPT AUFTAUCHT
 *
 * Dieselben Leads ueber LinkedIn anzuschreiben kostet keinen einzigen
 * zusaetzlichen Credit -- die Kontakte sind schon gekauft. Die Verkettung
 * dahin gibt es seit Migration 0074/0082. Was fehlte, war auch hier der Text:
 * die LinkedIn-Arbeitsliste startet mit einer leeren Vorlage, genau wie die
 * Mail-Kampagne.
 *
 * WAS ANDERS IST ALS BEI DER MAIL
 *
 * Kein Betreff, kein Link, und vor allem: viel kuerzer. Eine Kontaktanfrage
 * bei LinkedIn hat 300 Zeichen -- nicht 300 Woerter. Eine Mail-Eroeffnung
 * dort hineinzukopieren ergibt einen abgeschnittenen Satz.
 *
 * DIE SIGNATUR (gemeldet 2026-08-13)
 *
 * "Wenn ich bei LinkedIn aus Angebot erzeugen druecke, wird die Signatur nie
 * ergaenzt." Stimmte: hier stand ausdruecklich "No signature", weil 300
 * Zeichen knapp sind. Das war unsere Entscheidung, nicht seine -- und sie
 * gehoert ihm. Wer eine Signatur am Angebot hinterlegt (Migration 0091), will
 * sie auch unter der LinkedIn-Nachricht sehen.
 *
 * Angehaengt wird MECHANISCH, nicht vom Modell geschrieben: dieselbe
 * Entscheidung wie bei freeStandingPersonalization -- was eine reine Formsache
 * ist, wird repariert und nicht erbeten. Ein Modell, das die Signatur selbst
 * tippt, kuerzt sie ("Best, Y."), uebersetzt sie oder vergisst sie unter der
 * Zeichengrenze. Der Prompt sagt ihm nur, wie viele Zeichen sie ihm wegnimmt.
 *
 * Ist keine hinterlegt (auch nicht ueber workspaces.reply_sender_name), wird
 * NICHTS angehaengt und kein Name erfunden -- genau wie in der Mailsequenz.
 */
import { LINKEDIN_PLACEHOLDERS } from "@/lib/crm/linkedin-message";
import type { Offer } from "@/lib/offers";
import { leadInBefore } from "./sequence-prompt";
import { BANNED_PHRASES, bannedPhrasesIn } from "./playbook";

/** LinkedIns Grenze fuer die Nachricht an einer Kontaktanfrage. Gemessen am
 *  Feld selbst, nicht geschaetzt: laengere Texte nimmt das Formular nicht an. */
export const LINKEDIN_MAX_CHARS = 300;

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

/**
 * Wie viele Zeichen die Signatur der Nachricht wegnimmt: sie selbst plus die
 * Leerzeile davor, die appendSignature setzt.
 */
export function signatureCost(signature: string): number {
  const sig = signature.trim();
  return sig ? sig.length + 2 : 0;
}

/**
 * @param signature Gruss und Unterschrift, fertig ermittelt mit
 *   signatureFor() aus sequence-prompt.ts (Angebot vor Workspace). Leerer
 *   String heisst: es gibt keine, und es wird auch keine erfunden.
 */
export function buildLinkedInPrompt(offer: Offer, signature: string): string {
  const sprache = LANGUAGE_NAMES[offer.language] ?? "German";
  const sig = signature.trim();
  // Was dem Modell fuer den eigenen Text bleibt. Ihm die vollen 300 zu nennen
  // hiesse, es um die Laenge der Signatur zu betruegen -- dieselbe Rechnung
  // wie ownWordBudget() bei der Mailsequenz.
  const budget = LINKEDIN_MAX_CHARS - signatureCost(sig);
  const lines: string[] = [
    "You write ONE short LinkedIn connection message for cold outreach.",
    "",
    "THE OFFER:",
    `What they sell: ${offer.offering.trim() || "(not specified)"}`,
    `Who they sell to: ${offer.icp.trim() || "(not specified)"}`,
    `Problem before: ${offer.problem.trim() || "(not specified, do not assert one)"}`,
    // Dieselbe Friction und derselbe Micro-Yes wie in der Mailsequenz. Wer
    // ueber beide Kanaele angeschrieben wird, soll zweimal dieselbe Sache
    // hoeren -- zwei verschiedene Aufhaenger derselben Firma lesen sich wie
    // zwei verschiedene Absender.
    `The ONE friction: ${offer.friction.trim() || "(not specified, do not invent one)"}`,
    `Why buyers hesitate at it: ${offer.friction_reason.trim() || "(not specified, do not explain why)"}`,
    `Outcome after: ${offer.outcome.trim() || "(not specified, do not promise one)"}`,
    `THE MICRO YES (ask exactly this): ${
      offer.cta.trim() || "(not specified, ask one small yes/no question, never a meeting)"
    }`,
    offer.proof.trim()
      ? `Proof they may cite: ${offer.proof.trim()}`
      : "They have NO proof. Never mention clients, numbers, results or years of experience.",
    offer.tone.trim() ? `Tone notes: ${offer.tone.trim()}` : "Tone: direct, plain, business-like.",
    "",
    "HARD RULES:",
    `- Write in ${sprache}.`,
  ];

  if (offer.language === "de") {
    lines.push(
      offer.address_form === "sie"
        ? '- Address the reader formally ("Sie").'
        : '- Address the reader informally ("du").'
    );
  }

  lines.push(
    // Die Zeichengrenze ist der ganze Unterschied zur Mail. Wird sie
    // ueberschritten, schneidet LinkedIn ab -- mitten im Satz.
    `- HARD LIMIT: ${budget} characters INCLUDING the placeholders. Count them. This is a connection request, not an email.`,
    sig
      ? // Die Signatur wird nach der Erzeugung angehaengt. Schriebe das Modell
        // sie zusaetzlich, staende sie zweimal da -- appendSignature erkennt
        // das zwar, aber die Zeichen waeren trotzdem verplant.
        `- No subject line. Do NOT write a sign-off or a name of your own: the sender's own signature (${signatureCost(
          sig
        )} characters) is added under your text automatically. That is why your limit is ${budget} and not ${LINKEDIN_MAX_CHARS}.`
      : "- No subject line. No signature. No sender name is known, never invent one.",
    "- No link, no URL, no phone number.",
    `- Placeholders: only ${LINKEDIN_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. Any other {{...}} reaches the recipient unfilled.`,
    "- Never use the characters — – or --.",
    // Dieselbe Regel wie in der Mailsequenz, und aus demselben Grund: eine
    // Terminbitte ist die groesste Bitte, die ein Erstkontakt stellen kann.
    "- End with the micro yes above, or a question just as small. NEVER ask for a call, a meeting or a slot.",
    "- Never invent numbers, percentages or client counts.",
    `- Never write any of these: ${BANNED_PHRASES.join(", ")}.`,
    "",
    // ═══════════════════════════════════════════════════════════════════
    // DIE STELLE, AN DER DIE ERSTE FASSUNG SCHIEFGING (2026-08-12)
    // ═══════════════════════════════════════════════════════════════════
    //
    // Das Modell schrieb "Hi {{firstName}}, {{personalization}}." in EINE
    // Zeile. Beim Versand kam heraus: "Hi Brian, Helping over 30,000 people
    // lose 115,000lbs in 2022 ... that's why I'm reaching out.. Managing
    // multi-client outreach..." -- Grossbuchstabe nach Komma, zwei Punkte
    // hintereinander, und alles als eine graue Wand.
    //
    // Der Grund: der Aufhaenger IST bereits ein vollstaendiger Satz. Er
    // beginnt gross, endet mit einem Punkt und braucht keine Einleitung
    // ("noticed that", "I saw"). Wer ihn wie ein Satzglied behandelt,
    // zerlegt ihn.
    "THE OPENING LINE -- read this twice:",
    "{{personalization}} is replaced with a COMPLETE SENTENCE. It already starts with a capital letter and already ends with a full stop.",
    "- Put it alone on its own line, with a blank line before and after it.",
    "- Write NOTHING before it on that line and NOTHING after it on that line.",
    '- Never lead into it ("I noticed", "I saw that", "Quick thought:"). Never add a comma, full stop or dash after it.',
    "",
    "LAYOUT -- exactly this shape, with real blank lines:",
    `  ${offer.language === "en" ? "Hi {{firstName}}," : offer.address_form === "sie" ? "Guten Tag {{firstName}}," : "Hi {{firstName}},"}`,
    "  (blank line)",
    "  {{personalization}}",
    "  (blank line)",
    "  one short sentence about what you do, then your question",
    // Die Signatur steht als Platz in der Schablone, damit das Modell sieht,
    // dass die Nachricht danach noch weitergeht -- und nicht selbst einen
    // Gruss darunter setzt.
    ...(sig ? ["  (blank line)", "  [the signature is put here for you, do not type it]"] : []),
    "",
    "Answer with the message text only. No JSON, no quotes, no explanation."
  );

  return lines.join("\n");
}

/**
 * Die Antwort auf eine benutzbare Vorlage zurechtstutzen.
 *
 * Anfuehrungszeichen und ein vorangestelltes "Nachricht:" liefert das Modell
 * regelmaessig mit -- beides wuerde woertlich in der Vorlage landen. Gekuerzt
 * wird NICHT: eine mitten im Satz abgeschnittene Nachricht sieht aus wie ein
 * Fehler der App. Zu lange Antworten meldet stattdessen die Route.
 */
export function cleanLinkedInMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^(nachricht|message|text)\s*:\s*/i, "")
    .replace(/^["'„“](.*)["'“”]$/s, "$1")
    .trim();
}

const TOKEN = "{{personalization}}";

/**
 * Den Aufhaenger mechanisch freistellen.
 *
 * Deterministisch und nicht per zweitem Modellaufruf -- dieselbe Entscheidung
 * wie bei sanitize_banned_punctuation in personalize.py: was eine reine
 * Formsache ist, wird repariert und nicht erbeten. Das Modell schrieb
 * "Hi {{firstName}}, {{personalization}}." und erzeugte damit beim Versand
 * "Hi Brian, Helping over 30,000 people ... reaching out.." -- Grossbuchstabe
 * nach Komma und zwei Punkte hintereinander.
 *
 * Repariert werden nur die Zeilenumbrueche und die Satzzeichen DIREKT nach
 * dem Platzhalter. Eine Einleitung davor ("I noticed") wird NICHT geraten
 * weggeschnitten -- daraus wuerde ein zerrissener Satz. Die meldet
 * messageProblems(), und dann formuliert das Modell neu.
 */
export function freeStandingPersonalization(text: string): string {
  const at = text.indexOf(TOKEN);
  if (at === -1) return text;
  const before = text.slice(0, at).replace(/[ \t]+$/, "");
  // Punkt, Komma, Semikolon und Striche direkt dahinter: der Aufhaenger
  // bringt seinen eigenen Schlusspunkt mit.
  const after = text.slice(at + TOKEN.length).replace(/^[ \t]*[.,;:!?—–-]+/, "");
  return [before.trimEnd(), TOKEN, after.trimStart()].filter((p) => p.length > 0).join("\n\n");
}

/** Zwei Zeilen vergleichbar machen: Kleinschreibung, alles ausser Buchstaben
 *  und Ziffern zu einem Leerzeichen. "Best," und "Best" sind dieselbe Zeile. */
function normZeile(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Wie viele Zeilen am Ende darauf angesehen werden, ob dort schon
 *  unterschrieben wurde. Drei deckt "Gruss / Name / Firma" ab. */
const SIGNATUR_ZEILEN = 3;

/**
 * Die Signatur mechanisch daruntersetzen.
 *
 * Deterministisch statt per Modell, dieselbe Begruendung wie bei
 * freeStandingPersonalization: was eine reine Formsache ist, wird repariert
 * und nicht erbeten.
 *
 * Zwei Faelle, die dabei nicht passieren duerfen:
 *
 *  1. Keine Signatur hinterlegt -> es wird NICHTS angehaengt und kein Name
 *     erfunden. Das ist der ganze Sinn von Migration 0091.
 *  2. Das Modell hat trotz Verbot selbst unterschrieben -> dann stuende sie
 *     zweimal da. Erkannt wird das an den letzten Zeilen: taucht dort eine
 *     Zeile der Signatur auf (fast immer der Name), bleibt es beim Text.
 */
export function appendSignature(text: string, signature: string): string {
  const body = text.trim();
  const sig = signature.trim();
  if (!sig || !body) return body;
  const sigZeilen = sig
    .split("\n")
    .map(normZeile)
    .filter((z) => z.length > 0);
  const endZeilen = body
    .split("\n")
    .map(normZeile)
    .filter((z) => z.length > 0)
    .slice(-SIGNATUR_ZEILEN);
  if (sigZeilen.some((z) => endZeilen.includes(z))) return body;
  return body + "\n\n" + sig;
}

export type MessageProblem =
  | { kind: "noParagraphs" }
  | { kind: "personalizationLeadIn"; text: string }
  /** `withSignature`: die Laenge enthaelt die angehaengte Signatur -- dann darf
   *  das Modell nur den eigenen Satz kuerzen, nicht sie. */
  | { kind: "tooLong"; length: number; max: number; withSignature: boolean }
  /** Eine Wendung, an der man Massenpost erkennt (lib/copy/playbook.ts). */
  | { kind: "bannedPhrase"; phrase: string };

/**
 * Was an einer LinkedIn-Vorlage noch nicht stimmt.
 *
 * Grundlage fuer genau eine Korrekturrunde, wie beim Sequenzgenerator.
 */
export function messageProblems(
  text: string,
  personalizationWords: number,
  /** Die Signatur, die unter die Nachricht kommt. Sie zaehlt in der
   *  Zeichengrenze mit -- sonst gilt eine Nachricht als kurz genug, die
   *  LinkedIn nach dem Anhaengen abschneidet. */
  signature = ""
): MessageProblem[] {
  const problems: MessageProblem[] = [];

  // Aufbau und Wortwahl werden am Text des Modells geprueft, nicht am Text mit
  // Signatur: die braechte eine Leerzeile mit und liesse einen einzigen Block
  // als "hat Absaetze" durchgehen.
  if (!/\n\s*\n/.test(text.trim())) problems.push({ kind: "noParagraphs" });

  const einleitung = leadInBefore(text);
  if (einleitung) problems.push({ kind: "personalizationLeadIn", text: einleitung });

  const fertig = appendSignature(text, signature);
  const laenge = estimateLinkedInLength(fertig, personalizationWords);
  if (laenge > LINKEDIN_MAX_CHARS) {
    problems.push({
      kind: "tooLong",
      length: laenge,
      max: LINKEDIN_MAX_CHARS,
      withSignature: fertig !== text.trim(),
    });
  }

  // Auf 300 Zeichen faellt eine Floskel doppelt auf: sie kostet Platz UND
  // verraet die Massenaussendung.
  const treffer = bannedPhrasesIn(text);
  if (treffer.length > 0) problems.push({ kind: "bannedPhrase", phrase: treffer[0] });

  return problems;
}

export function messageCorrection(problems: MessageProblem[]): string {
  const zeilen = problems.map((p) => {
    switch (p.kind) {
      case "noParagraphs":
        return "- The message is one block. Separate greeting, opening line and your sentence with blank lines.";
      case "personalizationLeadIn":
        return `- Remove "${p.text}" in front of {{personalization}}. That token is already a full sentence; nothing may introduce it.`;
      case "tooLong":
        return (
          `- Once the opening line is inserted the message runs to about ${p.length} characters, LinkedIn allows ${p.max}. ` +
          (p.withSignature
            ? "Cut your own sentence. The placeholders and the signature added under your text are fixed."
            : "Cut your own sentence, not the placeholders.")
        );
      case "bannedPhrase":
        return `- Remove "${p.phrase}". It marks the message as bulk outreach on sight.`;
    }
  });
  return [
    "Your previous message broke these rules:",
    ...zeilen,
    "Fix exactly these points and answer again with the message text only.",
  ].join("\n");
}

/** Laenge, wie LinkedIn sie zaehlt: der Aufhaenger wird beim Versand ersetzt
 *  und ist dann rund zwanzig Woerter lang -- deshalb zaehlt er hier mit
 *  seiner geschaetzten Endlaenge, nicht mit den 19 Zeichen des Platzhalters. */
export function estimateLinkedInLength(text: string, personalizationWords: number): number {
  const AVG_WORT_ZEICHEN = 6;
  return text.replace(/\{\{personalization\}\}/g, "x".repeat(personalizationWords * AVG_WORT_ZEICHEN))
    .replace(/\{\{\s*[^}]+\s*\}\}/g, "xxxxxxxx")
    .length;
}
