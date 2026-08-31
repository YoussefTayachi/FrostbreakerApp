/**
 * Aus einem Angebot eine vollstaendige Mail-Sequenz machen.
 *
 * WOFUER
 *
 * Der Weg von der fertigen Lead-Liste zur laufenden Kampagne fuehrte bisher
 * durch acht leere Textfelder (vier Stufen mal Betreff und Text). Genau dort
 * endet Akquise fuer die meisten Nutzer, nicht an den Leads, nicht an der
 * Zustellbarkeit, sondern an der Frage "was schreibe ich denn?".
 *
 * Hier steht das, was man testen kann: wie aus einem Angebot (Migration 0090)
 * ein Auftrag ans Modell wird, wie aus dessen Antwort benutzbare Stufen
 * werden, und woran ein Entwurf scheitert. Der Aufruf selbst sitzt in
 * api/copy/sequence, nach demselben Schnitt wie lib/crm/reply-suggestions.ts.
 *
 * DIE REGEL, DIE DIESE DATEI TRAEGT
 *
 * Der Generator darf nichts erzeugen, was der eigene Torwart
 * (lib/campaign-readiness.ts) danach blockiert. Deshalb kommen die Grenzen
 * fuer die erste Mail (Wortzahl, kein Link) aus genau denselben
 * Konstanten und werden mit genau denselben Funktionen nachgemessen. Ein
 * Vorschlag, der beim Absenden rot wird, waere schlimmer als kein Vorschlag:
 * er saehe fertig aus.
 *
 * WAS SICH MIT DEM PLAYBOOK GEAENDERT HAT (2026-08-13)
 *
 * Die erste Fassung dieses Prompts war selbst ausgedacht und lag an vier
 * Stellen quer zu dem Verkaufs-Wissen, das jetzt in lib/copy/playbook.ts
 * steht. Sie sind ERSETZT, nicht ergaenzt; zwei widerspruechliche Anweisungen
 * im selben Prompt sind schlimmer als eine falsche:
 *
 *  1. "jede Stufe macht etwas NEUES" -> dieselbe Friction, derselbe Micro-Yes,
 *     ueber alle vier Stufen. Wer im Follow-up ein neues Thema braucht, hatte
 *     in Mail 1 die falsche Friction.
 *  2. Stufen 2 bis 4 pauschal "40 bis 70 Woerter" -> jede Stufe kuerzer als
 *     die vorherige (90/70/50/35).
 *  3. Terminlink in den Stufen 2 bis 4 -> gar kein Terminlink. Ein Termin ist
 *     die groesste Bitte, die eine Erstmail stellen kann; der Link gehoert in
 *     die Antwort NACH einem Ja (lib/crm/reply-suggestions.ts).
 *  4. Betreff "2 bis 5 Woerter, lowercase-ish" -> 3 bis 4 Woerter, ueber alle
 *     Stufen derselbe, und er spiegelt den Micro-Yes.
 */
import { FIRST_MAIL_MAX_WORDS, estimateWords, hasLink } from "@/lib/campaign-readiness";
import { DEFAULT_MAX_WORDS } from "@/lib/personalization-defaults";
import { OFFER_TEXT_FIELDS, type Offer, type OfferTextField } from "@/lib/offers";
import { customFieldNotesBlock, type OfferFieldDef } from "./offer-custom-fields";
import {
  BANNED_PHRASES,
  MEETING_WORDS,
  PLAYBOOK_DELAYS,
  STEP_MAX_WORDS,
  SUBJECT_IDEAL_WORDS,
  SUBJECT_MAX_WORDS,
  bannedPhrasesIn,
  copiedFrom,
  mirrorsMicroYes,
  subjectAsks,
  subjectCopiesMicroYes,
  wordCount,
} from "./playbook";

/**
 * Die Platzhalter, die Instantly beim Versand tatsaechlich ersetzt.
 *
 * Muss mit VARIABLES in app/instantly/campaigns/campaign-step-card.tsx
 * uebereinstimmen (Quelle: https://help.instantly.ai/en/articles/6135930).
 * Ein erfundener Platzhalter wird NICHT ersetzt: er geht als
 * "{{painPoint}}" an den Empfaenger raus, und das faellt erst dort auf.
 */
export const EMAIL_MERGE_TAGS = [
  "firstName",
  "lastName",
  "companyName",
  "email",
  "personalization",
  // Kein vordefiniertes Instantly-Tag, sondern ein Feld, das mit dem Lead
  // hochgeladen wird (WEBSITE_FINDING_FIELD in lib/instantly/campaigns.ts).
  // Es steht hier, damit unknownTags() es nicht als erfundenen Platzhalter
  // meldet: eine handgeschriebene Sequenz, die es benutzt, waere sonst
  // dauerhaft rot.
  "websiteFinding",
] as const;
export type EmailMergeTag = (typeof EMAIL_MERGE_TAGS)[number];

/** Vier Stufen: Erstkontakt, anderer Blickwinkel, kurze Nachfrage, Abschied. */
export const DEFAULT_STEP_COUNT = 4;
/** Zwei Fassungen je Stufe, siehe Begruendung in buildSequencePrompt. */
export const DEFAULT_VARIANTS_PER_STEP = 2;

/**
 * Abstaende in Tagen, von uns gesetzt und nicht vom Modell.
 *
 * Ein Sprachmodell hat zu Sendeabstaenden keine Meinung, die besser waere als
 * eine feste Vorgabe; es hat nur eine, die von Lauf zu Lauf schwankt. Jedes
 * Feld, das das Modell nicht ausfuellen muss, ist ein Feld, das nicht
 * schiefgehen kann.
 *
 * Die Werte kommen aus dem Playbook (Tag 0, 3, 5, 7 mit schrumpfenden
 * Abstaenden) und nicht mehr aus der ersten Fassung dieser Datei
 * ([0, 2, 3, 5], zehn Tage mit wachsenden Abstaenden).
 */
export const DEFAULT_DELAYS = PLAYBOOK_DELAYS;

export type DraftVariant = { subject: string; body: string };
export type DraftStep = { variants: DraftVariant[]; delayDays: number };

export type SequenceOptions = {
  /**
   * Name unter der Mail (workspaces.reply_sender_name).
   *
   * Der Terminlink stand hier frueher auch und ist mit dem Playbook
   * verschwunden: eine Kaltsequenz bittet nie um einen Termin, also gibt es in
   * ihr auch nichts zu verlinken. workspaces.calendar_link wird weiter
   * benutzt, in der Antwort nach einem Ja (lib/crm/reply-suggestions.ts) und
   * beim Nachschaerfen einzelner Stufen (lib/copy/refine-prompt.ts).
   */
  senderName: string | null;
  /** Wortgrenze der Aufhaengerzeile; sie zaehlt in der ersten Mail mit. */
  personalizationWords: number;
  /**
   * Die beste eigene Fassung als Vorbild. NUR uebergeben, wenn die Menge dafuer
   * reicht (lib/report/copy-outcomes.ts, MIN_SAMPLE); sonst zementiert der
   * Generator einen Zufallstreffer aus vierzig Mails.
   */
  bestExample?: DraftVariant | null;
};

export function defaultSequenceOptions(): SequenceOptions {
  return {
    senderName: null,
    personalizationWords: DEFAULT_MAX_WORDS,
    bestExample: null,
  };
}

/**
 * Wie viele EIGENE Woerter die erste Mail haben darf.
 *
 * Die Wortgrenze des Torwarts gilt fuer die Mail, wie sie ankommt, also
 * inklusive des eingesetzten Aufhaengers. Dem Modell die 90 zu nennen hiesse,
 * es um die Laenge des Aufhaengers zu betruegen; es schriebe 90 und die Mail
 * kaeme mit 112 an. Der kleine Abzug am Ende ist Luft fuer Anrede und Gruss.
 */
export function ownWordBudget(personalizationWords: number): number {
  // Der Abzug deckt Anrede, Gruss und Unterschrift ab: die drei Zeilen, die
  // seit dem 2026-08-12 verlangt werden und in der Wortzahl des Torwarts
  // mitzaehlen.
  return Math.max(25, FIRST_MAIL_MAX_WORDS - personalizationWords - 8);
}

/**
 * Die Signatur, wie sie unter der Mail stehen soll.
 *
 * Reihenfolge: Angebot vor Workspace. Die Signatur am Angebot gibt es, damit
 * eine Agentur je Nische verschieden unterschreiben kann (Migration 0091);
 * workspaces.reply_sender_name (0073) ist der Rueckfall, damit nicht zwei
 * Wahrheiten fuer dieselbe Sache entstehen.
 *
 * Ist beides leer, gibt es KEINE Unterschrift, und der Prompt sagt das
 * ausdruecklich. Ein erfundener Name unter einer Geschaeftsmail ist schlimmer
 * als gar keiner.
 */
export function signatureFor(offer: Pick<Offer, "signature" | "language">, senderName: string | null): string {
  const eigene = offer.signature.trim();
  if (eigene) return eigene;
  const name = (senderName ?? "").trim();
  if (!name) return "";
  return offer.language === "en" ? `Best,\n${name}` : `Beste Grüße\n${name}`;
}

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

/** Ein Angebotsfeld als Prompt-Zeile, oder als ausdrueckliches Verbot. */
function fieldLine(label: string, value: string, emptyInstruction: string): string {
  const v = value.trim();
  return v ? `${label}: ${v}` : `${label}: (nicht angegeben) -> ${emptyInstruction}`;
}

/**
 * Der Auftrag ans Modell.
 *
 * Auf Englisch formuliert, aus demselben Grund wie constraint_block() in
 * personalize.py: Formvorgaben befolgt das Modell in Englisch verlaesslicher.
 * Was das NICHT beeinflusst, ist die Sprache der Mails; die steht als harte
 * Vorgabe drin und kommt aus dem Angebot.
 */
/** Die Anrede, die als Schablone im Prompt steht. Immer mit {{firstName}}:
 *  eine Mail ohne Namen liest sich wie ein Rundschreiben, und der Name ist
 *  der eine Platzhalter, den jeder Lead sicher hat. */
export function greetingLine(offer: Offer): string {
  if (offer.language === "en") return "Hi {{firstName}},";
  return offer.address_form === "sie" ? "Guten Tag {{firstName}}," : "Hi {{firstName}},";
}

/**
 * @param eigene Die selbst definierten Felder des Workspaces (Migration 0098).
 *   Ohne sie ist der erzeugte Prompt Wort fuer Wort der von vorher; ein Test
 *   haelt das fest. Die WERTE kommen aus dem Angebot selbst
 *   (offer.custom_fields), damit es nicht zwei Wahrheiten darueber gibt, was
 *   in einem Feld steht.
 */
export function buildSequencePrompt(
  offer: Offer,
  opts: SequenceOptions,
  eigene?: OfferFieldDef[]
): string {
  const budget = ownWordBudget(opts.personalizationWords);
  const sprache = LANGUAGE_NAMES[offer.language] ?? "German";
  const signature = signatureFor(offer, opts.senderName);
  // Nur Felder MIT Wert erzeugen hier etwas. Warum ein leeres eigenes Feld,
  // anders als die zwoelf festen, kein Verbot erzeugt, steht bei
  // customFieldNotesBlock.
  const eigeneNotizen = customFieldNotesBlock(eigene ?? [], offer.custom_fields);

  const lines: string[] = [
    "You write cold outreach email sequences that get REPLIES, not admiration.",
    `Write a ${DEFAULT_STEP_COUNT}-step sequence with ${DEFAULT_VARIANTS_PER_STEP} variants per step.`,
    "",
    "THE OFFER (this is the only thing you know about the sender):",
    fieldLine("What they sell", offer.offering, "keep it abstract, never invent a product"),
    fieldLine("Who they sell to", offer.icp, "write for a generic business owner"),
    fieldLine("The pain before", offer.problem, "do not assert a specific pain"),
    // Die Friction traegt die Beobachtung, mit der Mail 1 anfaengt. Sie ist der
    // Grund, warum diese Sequenz konkret klingen kann und nicht wie eine
    // Vorlage, und sie ist Pflichtfeld, kommt hier also praktisch immer an.
    fieldLine(
      "The ONE friction (the thing buyers get stuck on, right before they would spend money)",
      offer.friction,
      "you have no friction to point at. Do not invent one. Open with the pain instead, in one plain sentence"
    ),
    fieldLine(
      "Why buyers hesitate at it (observed behaviour, never an accusation)",
      offer.friction_reason,
      "do not explain why. State the friction plainly and move on"
    ),
    fieldLine("Outcome after", offer.outcome, "do not promise a specific result"),
    // Der Mechanismus steht im Prompt, damit die spaeteren Stufen wissen,
    // worum es geht, aber er darf nicht in die Mail. Der Kaeufer entscheidet
    // in einer Kaltmail nicht ueber die Bauweise, sondern darueber, ob er
    // hinsieht.
    fieldLine(
      "How it works (background only, NEVER put this in step 1)",
      offer.mechanism,
      "do not explain how anything works"
    ),
    // Der wichtigste leere Fall im ganzen Prompt. Ein Modell ohne Referenzen
    // erfindet "over 200 happy clients". Das faellt nicht dem auf, der die
    // Mail schreibt, sondern dem Empfaenger, der nachfragt.
    fieldLine(
      "Proof",
      offer.proof,
      "NO proof exists. Never mention clients, numbers, case studies, years of experience or results. Not even vaguely"
    ),
    fieldLine(
      "What they will send once the reader says yes",
      offer.preview_asset,
      "there is nothing to send. Never promise a video, an audit, a document or an example"
    ),
    fieldLine(
      "How long that takes to look at",
      offer.review_time,
      "no time promise exists. Never say 'two minutes' or anything like it"
    ),
    fieldLine(
      "THE MICRO YES (the one binary question, repeated word for word in every step)",
      offer.cta,
      "ask one small yes/no question of your own. Never request a meeting"
    ),
    fieldLine("Tone notes", offer.tone, "direct, plain, business-like"),
    "",
    // ═══════════════════════════════════════════════════════════════════════
    // DIE STELLE, AN DER DIE ERSTE FASSUNG SCHIEFGING (2026-08-13)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Am Live-Stand gemessen: das Modell hat die Angebotsfelder woertlich
    // aneinandergeklebt. Aus "Role addresses like info@ get filtered out" und
    // "Their outreach Emails are not personalized and look like spam then the
    // buyer hesitate to reply" wurde ein Satz, samt dem Grammatikfehler des
    // Nutzers. Und der Micro-Yes stand woertlich als "Book a 30-minute call
    // to review client setup and set up the first workspace." in der Mail.
    //
    // Der Grund liegt an der Anweisung, nicht am Modell: "nenne die Friction"
    // liest sich als "setze den Feldinhalt ein". Die Felder sind aber NOTIZEN
    // des Absenders an sich selbst: oft kein Satz, oft in seiner Sprache,
    // oft schief. Sie sind der INHALT, nicht der Wortlaut.
    "THESE ARE NOTES, NOT SENTENCES.",
    "Everything above is how the sender jotted it down for themselves. Their wording, sometimes clumsy,",
    "sometimes not even a full sentence, sometimes in a different language than the email.",
    "- NEVER copy a field into the email. Understand what it means and say it the way the RECIPIENT would want to hear it.",
    "- Never glue two fields together into one sentence. If you can see the seams, rewrite it.",
    "- Silently fix their grammar, their word order and their register. Do not point it out.",
    "- The micro yes: put it into your own natural words ONCE, then repeat exactly that wording in every step.",
    "  'word for word' means identical across the four steps, not identical to the note above.",
    "- If a note is a meeting request, do not turn the email into one. Ask something the reader can answer with yes.",
    "",
    // Die eigenen Felder stehen HIER: hinter der Regel, dass Feldinhalte
    // Notizen und kein Wortlaut sind (sie gilt fuer sie genauso), und vor den
    // HARD RULES samt ARCHITECTURE-Block, der unangetastet bleibt und gewinnt.
    ...(eigeneNotizen.length > 0 ? [...eigeneNotizen, ""] : []),
    "HARD RULES (these override everything above):",
    `- Write every email in ${sprache}.`,
  ];

  if (offer.language === "de") {
    // Im Englischen gibt es die Unterscheidung nicht; sie dort zu erklaeren
    // wuerde das Modell nur beschaeftigen.
    lines.push(
      offer.address_form === "sie"
        ? '- Address the reader formally ("Sie"). Never use "du".'
        : '- Address the reader informally ("du"). Never use "Sie".'
    );
  }

  lines.push(
    // Der Aufbau steht als Schablone da und nicht als Beschreibung: an
    // echten Daten kam sonst ein einziger Block ohne Anrede, ohne Gruss und
    // ohne eine einzige Leerzeile zurueck. Auf dem Telefon ist so eine Mail
    // eine graue Wand, und sie wird nicht gelesen.
    "",
    "LAYOUT -- every email follows exactly this shape:",
    `  ${greetingLine(offer)}`,
    "  (blank line)",
    "  the message, in SHORT paragraphs of one to three sentences each,",
    "  separated by BLANK LINES",
    "  (blank line)",
    "  the question you want answered",
    signature ? "  (blank line)\n" + signature.split("\n").map((l) => `  ${l}`).join("\n") : "  (no signature, see below)",
    "",
    "- Use real blank lines (\\n\\n) between paragraphs. A wall of text does not get read.",
    "- Never write more than three sentences in one paragraph.",
    "",
    // Der Aufhaenger IST ein vollstaendiger Satz: er beginnt gross und
    // endet mit einem Punkt. Wer ihn wie ein Satzglied behandelt, erzeugt
    // "Hi Brian, Helping over 30,000 people ... reaching out.." (gemessen an
    // der LinkedIn-Vorlage am 2026-08-12).
    `- In step 1 the SECOND block is the literal token {{personalization}}, alone on its own line with blank lines around it.`,
    "- {{personalization}} is replaced with a COMPLETE SENTENCE that already starts with a capital and already ends with a full stop.",
    '  Write nothing before it and nothing after it on that line. Never lead into it ("I noticed", "I saw"), never add punctuation behind it.',
    `- Step 1: at most ${budget} words of your own (the token above counts for roughly ${opts.personalizationWords} more).`,
    "- Step 1 must contain NO link and NO URL of any kind.",
    `- Placeholders: only ${EMAIL_MERGE_TAGS.map((t) => `{{${t}}}`).join(", ")}. Any other {{...}} is never replaced and reaches the recipient as-is.`,
    // {{websiteFinding}} ist OPTIONAL, und das ist Absicht.
    //
    // Das Modell wird nicht angewiesen, den Platzhalter zu benutzen: wer ihn
    // benutzt, verliert alle Leads ohne Website-Befund (sie werden beim
    // Anlegen zurueckgehalten, siehe splitByWebsiteFinding). Diese Abwaegung
    // gehoert dem Menschen, der die Zahl im Torwart sieht, nicht einem
    // Sprachmodell, das die Lead-Liste gar nicht kennt.
    //
    // Wenn es ihn benutzt, gelten zwei Grenzen, und die erste ist die
    // wichtigere: der Befund ist der BELEG der einen Friction, nicht eine
    // zweite. Genau das schliesst die Playbook-Regel "EINE Friction ueber
    // alle vier Stufen" aus, und sie bleibt unangetastet.
    "- {{websiteFinding}} is one measured, verifiable flaw on THIS recipient's website,",
    "  written as a complete sentence. It is OPTIONAL: use it only when the friction of the",
    "  offer above is about their website, and then use it in step 1 only.",
    "- If you use it, it is EVIDENCE for the one friction, never a second problem and never a",
    "  second question. Write nothing before it and nothing after it on that line, exactly like",
    "  {{personalization}}.",
    "- Never use square brackets or angle brackets as fill-in blanks ([Name], <company>). If you do not know something, leave it out.",
    // Gleiche Begruendung wie DEFAULT_BANNED_WORDS in personalize.py: ein
    // Gedankenstrich mitten im Satz ist inzwischen das deutlichste
    // Erkennungszeichen fuer maschinell geschriebenen Text.
    "- Never use the characters — – or -- anywhere. Use a comma or a full stop.",
    "- No exclamation marks, no ALL CAPS.",
    // Zwei Fassungen sind nur dann etwas wert, wenn sie sich unterscheiden.
    // Zwei Umformulierungen desselben Gedankens messen nichts — der
    // A/B-Apparat (Migration 0071) wuerde Rauschen vergleichen.
    "- The two variants of a step must differ in APPROACH, not in wording. Different angle, different question, different first sentence.",
    "- Each email must be complete and sendable as it stands.",

    // ── Die Architektur ──────────────────────────────────────────────────
    // Das ist der Teil, der ueber Antwort oder Schweigen entscheidet. Alles
    // darueber ist Handwerk, das hier ist die Bauform.
    "",
    "THE ARCHITECTURE (this decides whether the sequence works at all):",
    "- ONE friction and ONE micro yes across all four steps. Never introduce a second problem,",
    "  a second question, a second offer or a new topic in a follow-up.",
    "- Repeat the micro yes WORD FOR WORD in every step. Do not rephrase it, do not escalate it.",
    `- Every step is SHORTER than the one before it. Upper limits in words: ${STEP_MAX_WORDS.join(", ")}.`,
    "  A follow-up that grows reads as chasing. If a step feels too thin, cut the step above it instead.",
    "- NEVER ask for a meeting, a call, a slot or 'a few minutes'. Never include a booking link.",
    "  The micro yes is the whole ask. A meeting is the largest request a cold email can make,",
    "  and it is the reason most of them are ignored.",
    "- Never invent numbers, percentages, revenue figures, conversion rates or client counts.",
    "  Describe consequences as observable behaviour instead: people arrive, hesitate at that step, and leave.",
    "",
    "STEP 1 (day 0) -- the observation",
    "  greeting, then {{personalization}} on its own line,",
    "  then: name the friction and, in the same breath, why buyers hesitate at it,",
    "  then: what that quietly costs, in plain words and with no numbers,",
    "  then: what you will send and how long it takes to look at, plus one line that removes the risk,",
    "  then: the micro yes.",
    "",
    "STEP 2 (day 3) -- tighter, not new",
    "  one line that anchors back to the first mail. Never 'just checking in'.",
    "  the same consequence, one notch more precise. Same friction, same page, same next step.",
    "  the micro yes, word for word.",
    "",
    "STEP 3 (day 5) -- the summary",
    "  a short context line, the consequence compressed to a single business outcome,",
    "  an even smaller ask than before, the micro yes. Nothing new.",
    "",
    "STEP 4 (day 7) -- the last one",
    "  one line that says plainly this is the last time you write, then the micro yes as a pure yes/no.",
    "  Nothing else: no proof, no explanation, no fresh argument, no goodbye speech.",
    "  It must read calmly enough to be forwarded to a colleague without embarrassment.",
    "",
    "SUBJECT LINES",
    `- ${SUBJECT_IDEAL_WORDS} words or fewer, never more than ${SUBJECT_MAX_WORDS}.`,
    "- All four steps of a variant use the SAME subject. The follow-ups belong to the same conversation.",
    // Gemeldet am 2026-08-13: in allen vier Stufen stand der Micro-Yes
    // woertlich als Betreff. Die alte Zeile ("announces exactly the decision
    // the micro yes asks for") las das Modell als Auftrag, die Frage zu
    // nehmen. Ankuendigen heisst benennen, nicht abschreiben.
    "- The subject is a LABEL for the thing the decision is about. It NAMES it, it does not ask it.",
    "- NEVER the micro yes, neither word for word nor shortened. NEVER a question mark.",
    "  A subject that already asks the question makes the mail redundant before it is opened,",
    "  and the same question in the inbox four times reads like an automated reminder.",
    "- Name the concrete thing the mail is about: the friction, or what you send once they say yes.",
    '  Good: "return slip behind login". Bad: "can I send you the recording?"',
    "- No numbers, no colons, no marketing headline, no 'Re:' or 'Fwd:' fakery, no exclamation marks.",
    "- It has to read like a message from a supplier they already work with. If you can hear a marketer, rewrite it.",
    "",
    "NEVER WRITE THESE (each one marks the mail as bulk mail on sight):",
    `  ${BANNED_PHRASES.join(", ")}`
  );

  // Wortgleich zur Begruendung in Migration 0073: ein erfundener Terminlink
  // faellt erst dem Empfaenger auf, und dann ist es zu spaet. Anders als
  // frueher steht hier KEIN Fall mehr, in dem ein Link erlaubt waere.
  lines.push("- There is no booking link in this sequence at all. Never invent one, never ask for one.");
  if (signature) {
    lines.push(`- End every email with exactly this signature, on its own lines:\n${signature}`);
  } else {
    // Kein Name hinterlegt: lieber ohne Unterschrift als mit einer erfundenen.
    // Gleiche Regel wie beim Terminlink in Migration 0073.
    lines.push("- No sender name is known. End with the question, without a signature. Never invent a name.");
  }

  if (opts.bestExample?.body.trim()) {
    lines.push(
      "",
      "This email of theirs earned the most replies so far. Match its voice and rhythm, do NOT copy its sentences:",
      `Subject: ${opts.bestExample.subject}`,
      opts.bestExample.body.trim()
    );
  }

  lines.push(
    "",
    "Answer with JSON only, no prose around it:",
    '[{"variants":[{"subject":"...","body":"..."},{"subject":"...","body":"..."}]}, ...]',
    `Exactly ${DEFAULT_STEP_COUNT} objects, exactly ${DEFAULT_VARIANTS_PER_STEP} variants each, in order.`
  );

  return lines.join("\n");
}

/** Das erste JSON-Array im Text — auch wenn ein Satz oder ein Codeblock
 *  drumherum steht. Gleiche Begruendung wie in lib/crm/reply-suggestions.ts:
 *  daran zu scheitern hiesse, eine Fehlermeldung zu zeigen, obwohl die
 *  Antwort direkt davor steht. */
function extractJsonArray(raw: string): string | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Die Antwort des Modells in Stufen verwandeln.
 *
 * Nachsichtig beim Format, streng beim Inhalt: leere Stufen und leere
 * Fassungen fliegen raus, die Abstaende setzen wir selbst. Was hier NICHT
 * passiert, ist Reparieren — ein zu langer Text bleibt zu lang und wird von
 * sequenceProblems() gemeldet, damit die Korrekturrunde etwas zu korrigieren
 * hat.
 */
export function parseSequence(raw: string): DraftStep[] {
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
      const obj = item as { variants?: unknown; subject?: unknown; body?: unknown };
      // Auch die flache Form akzeptieren ({subject, body} ohne variants):
      // die liefert das Modell gelegentlich, und sie ist eindeutig gemeint.
      const rawVariants = Array.isArray(obj?.variants)
        ? obj.variants
        : [{ subject: obj?.subject, body: obj?.body }];
      const variants = rawVariants
        .map((v) => {
          const o = v as { subject?: unknown; body?: unknown };
          return { subject: asText(o?.subject), body: asText(o?.body) };
        })
        .filter((v) => v.body.length > 0 && v.subject.length > 0);
      return { variants, delayDays: DEFAULT_DELAYS[i] ?? 3 };
    })
    .filter((s) => s.variants.length > 0)
    .slice(0, DEFAULT_STEP_COUNT);
}

/** Platzhalter, die niemand ersetzt: unbekannte {{...}} sowie eckige und
 *  spitze Fuellklammern. Die BEKANNTEN Merge-Tags sind ausdruecklich erlaubt --
 *  anders als in reply-suggestions.ts, wo jeder Platzhalter ein Fehler ist. */
export function unknownTags(text: string): string[] {
  const known = new Set<string>(EMAIL_MERGE_TAGS);
  const geschweift = (text.match(/\{\{\s*[^}]+\s*\}\}/g) ?? [])
    .map((raw) => raw.replace(/[{}]/g, "").trim())
    .filter((name) => !known.has(name))
    .map((name) => `{{${name}}}`);
  const eckig = text.match(/\[[^\]]{2,40}\]/g) ?? [];
  const spitz = text.match(/<[A-Za-zÄÖÜäöü][^>]{1,40}>/g) ?? [];
  return [...new Set([...geschweift, ...eckig, ...spitz])];
}

export type SequenceProblem =
  | { kind: "stepCount"; got: number }
  | { kind: "variantCount"; step: number; got: number }
  | { kind: "missingPersonalization" }
  | { kind: "firstMailTooLong"; words: number; max: number }
  | { kind: "firstMailHasLink" }
  | { kind: "unknownTags"; tags: string[] }
  | { kind: "dash"; step: number }
  | { kind: "variantsTooSimilar"; step: number }
  | { kind: "noParagraphs"; step: number }
  | { kind: "noGreeting"; step: number }
  /** Die Stufe endet ohne die hinterlegte Unterschrift. */
  | { kind: "missingSignature"; step: number }
  | { kind: "personalizationLeadIn"; text: string }
  // ── Playbook ────────────────────────────────────────────────────────────
  /** Die Stufe reisst ihre Wortgrenze. */
  | { kind: "stepTooLong"; step: number; words: number; max: number }
  /** Die Stufe ist nicht kuerzer als ihre Vorgaengerin — Kompression gebrochen. */
  | { kind: "notShorter"; step: number }
  /** Der Betreff hat zu viele Woerter. */
  | { kind: "subjectTooLong"; step: number; words: number; max: number }
  /** Der Betreff wechselt mitten in der Sequenz. */
  | { kind: "subjectDrift"; step: number }
  /** Der Betreff kuendigt etwas anderes an als der Micro-Yes. */
  | { kind: "subjectNoMirror"; step: number }
  /** Der Betreff ist der abgeschriebene Micro-Yes. */
  | { kind: "subjectIsMicroYes"; step: number }
  /** Der Betreff stellt selbst eine Frage. */
  | { kind: "subjectAsks"; step: number }
  /** Eine Wendung, an der man Massenpost erkennt. */
  | { kind: "bannedPhrase"; step: number; phrase: string }
  /** Die Stufe bittet um einen Termin. */
  | { kind: "meetingAsk"; step: number }
  /** Ein Angebotsfeld steht woertlich in der Mail statt formuliert. */
  | { kind: "copiedNote"; step: number; text: string };

/**
 * Ab wie vielen Woertern eine Mail ohne Leerzeile als Wand gilt.
 *
 * Darunter ist ein einzelner Block voellig in Ordnung — eine Nachfassmail
 * mit zwei Saetzen braucht keinen Absatz, und sie deswegen anzumeckern waere
 * dieselbe Sorte unbegruendetes Rot, die beim Copy-Check gerade abgeschafft
 * wurde.
 */
const PARAGRAPH_REQUIRED_FROM_WORDS = 35;

/**
 * Was an einem Entwurf nicht stimmt — deterministisch, ohne zweiten
 * Modellaufruf.
 *
 * Grundlage fuer genau EINE Korrekturrunde, wie in personalize.py: das Modell
 * erfaehrt seinen Fehler und antwortet neu. Bleibt der Fehler, wird der
 * Entwurf trotzdem gezeigt, mit dem Befund daneben — ein Text, an dem noch
 * zwei Woerter fehlen, ist mehr wert als eine Fehlermeldung.
 *
 * Die ersten Mails werden mit denselben Funktionen gemessen, die der Torwart
 * benutzt (estimateWords, hasLink), nicht mit eigenen Naeherungen.
 */
export function sequenceProblems(
  steps: DraftStep[],
  opts: SequenceOptions,
  /**
   * Das Angebot, aus dem der Entwurf entstanden ist. Optional, weil die
   * Pruefung ohne es weiterlaufen muss — ohne es fallen nur drei Befunde aus
   * (Betreff-Spiegel, Abschrift und fehlende Unterschrift), und ein Ausfall
   * ist besser als ein geratener Befund.
   */
  offer?: Pick<Offer, OfferTextField | "signature" | "language" | "custom_fields">,
  /** Die selbst definierten Felder. Ohne sie werden nur die zwoelf festen auf
   *  Abschrift geprueft; ein Wert ohne Definition stand nie im Prompt und kann
   *  also auch nicht abgeschrieben worden sein. */
  eigene?: OfferFieldDef[]
): SequenceProblem[] {
  const microYes = offer?.cta;
  // Dieselbe Unterschrift, die buildSequencePrompt vorgibt — aus derselben
  // Funktion, damit Auftrag und Nachmessung nicht auseinanderlaufen koennen.
  // Ist sie leer, gibt es nichts zu pruefen: dann SOLL die Mail ohne
  // Unterschrift enden, statt einen Namen zu erfinden (siehe signatureFor).
  const signatur = offer ? signatureFor(offer, opts.senderName) : "";
  // Die Felder, deren woertliche Uebernahme auffaellt. tone bleibt draussen:
  // "direkt, kein Hype" taucht nie in einer Mail auf, und proof SOLL zitiert
  // werden duerfen — eine Referenz ist eine Tatsache, keine Notiz.
  //
  // cta bleibt ebenfalls draussen, und das ist eine Ausnahme mit Grund: der
  // Micro-Yes ist das EINZIGE Feld, dessen woertliche Wiederholung der Prompt
  // ausdruecklich verlangt ("repeat the micro yes WORD FOR WORD in every
  // step"). Ist die Notiz schon eine saubere Ja/Nein-Frage, ist ihre
  // Uebernahme richtig und keine Abschrift; stuende cta hier, meldete jede
  // gut ausgefuellte Sequenz einen Befund und loeste damit eine zweite,
  // bezahlte Korrekturrunde aus. Der Fall, um den es 2026-08-13 wirklich ging
  // (eine Terminbitte als Micro-Yes), faellt weiterhin auf: einmal am Feld
  // selbst (offer-tests.ts, microYesProblems) und einmal am Text (meetingAsk).
  //
  // Die eigenen Felder (Migration 0098) stehen mit in dieser Liste: sie sind
  // Notizen wie die anderen auch, stehen im selben Prompt und werden genauso
  // woertlich uebernommen, wenn man das Modell laesst.
  const notizen = offer
    ? [
        ...OFFER_TEXT_FIELDS.filter((f) => f !== "tone" && f !== "proof" && f !== "cta").map(
          (f) => offer[f]
        ),
        ...(eigene ?? []).map((d) => offer.custom_fields[d.key] ?? ""),
      ].filter((v) => v.trim().length > 0)
    : [];
  const problems: SequenceProblem[] = [];
  if (steps.length !== DEFAULT_STEP_COUNT) problems.push({ kind: "stepCount", got: steps.length });

  steps.forEach((step, i) => {
    if (step.variants.length !== DEFAULT_VARIANTS_PER_STEP) {
      problems.push({ kind: "variantCount", step: i + 1, got: step.variants.length });
    }
    // Zwei Fassungen, die sich nur in Nuancen unterscheiden, sind keine zwei
    // Fassungen. Verglichen wird auf Wortebene, damit ein anderes Satzzeichen
    // nicht schon als Gegenentwurf durchgeht.
    if (step.variants.length >= 2 && aehnlich(step.variants[0].body, step.variants[1].body)) {
      problems.push({ kind: "variantsTooSimilar", step: i + 1 });
    }
    for (const v of step.variants) {
      if (/—|–|--/.test(v.subject + v.body)) {
        problems.push({ kind: "dash", step: i + 1 });
        break;
      }
    }
    // Anrede: die erste nichtleere Zeile muss den Vornamen tragen. Ohne sie
    // liest sich die Mail wie ein Rundschreiben — der gemeldete Fall vom
    // 2026-08-12 hatte weder Anrede noch Gruss.
    if (step.variants.some((v) => !hatAnrede(v.body))) {
      problems.push({ kind: "noGreeting", step: i + 1 });
    }
    // Und die andere Haelfte desselben Falls: der Gruss. Der Prompt verlangt
    // die Unterschrift woertlich, geprueft wurde bisher nur die Anrede — eine
    // Mail, die mitten in der Frage aufhoert, sieht abgeschnitten aus.
    if (signatur && step.variants.some((v) => !hatSignatur(v.body, signatur))) {
      problems.push({ kind: "missingSignature", step: i + 1 });
    }
    // Absaetze: erst ab einer Laenge, ab der ein Block wirklich stoert.
    if (
      step.variants.some(
        (v) => v.body.split(/\s+/).filter(Boolean).length >= PARAGRAPH_REQUIRED_FROM_WORDS && !/\n\s*\n/.test(v.body)
      )
    ) {
      problems.push({ kind: "noParagraphs", step: i + 1 });
    }

    // ── Playbook-Pruefungen ─────────────────────────────────────────────
    const max = STEP_MAX_WORDS[i];
    // Stufe 1 wird weiter unten mit estimateWords geprueft, weil dort der
    // Aufhaenger mitzaehlt. Hier ginge sie doppelt ins Netz.
    if (i > 0 && max !== undefined) {
      for (const v of step.variants) {
        const w = wordCount(v.body);
        if (w > max) {
          problems.push({ kind: "stepTooLong", step: i + 1, words: w, max });
          break;
        }
      }
    }

    for (const v of step.variants) {
      const treffer = bannedPhrasesIn(v.subject + "\n" + v.body);
      if (treffer.length > 0) {
        problems.push({ kind: "bannedPhrase", step: i + 1, phrase: treffer[0] });
        break;
      }
    }

    // Terminbitte. Geprueft wird der Text, nicht der Micro-Yes im Angebot --
    // den prueft offer-tests.ts an der Quelle.
    for (const v of step.variants) {
      if (bannedPhrasesIn(v.body, MEETING_WORDS).length > 0) {
        problems.push({ kind: "meetingAsk", step: i + 1 });
        break;
      }
    }

    // Abschrift eines Angebotsfeldes.
    //
    // Die Pruefung fehlte, seit der Befund eingefuehrt wurde (Commit 5efa2ea):
    // Typ, Notizen-Liste und Korrekturzeile standen da, nur diese Schleife
    // nicht. Sie ist der Grund, warum die Notizen-Liste ueberhaupt gebaut
    // wird. Gemessen wurde der Fall am Live-Stand (2026-08-13): das Modell hat
    // zwei Felder samt Grammatikfehler des Nutzers aneinandergeklebt.
    if (notizen.length > 0) {
      for (const v of step.variants) {
        const abgeschrieben = copiedFrom(v.body, notizen);
        if (abgeschrieben.length > 0) {
          problems.push({ kind: "copiedNote", step: i + 1, text: abgeschrieben[0] });
          break;
        }
      }
    }

    for (const v of step.variants) {
      const w = wordCount(v.subject);
      if (w > SUBJECT_MAX_WORDS) {
        problems.push({ kind: "subjectTooLong", step: i + 1, words: w, max: SUBJECT_MAX_WORDS });
        break;
      }
    }

    // Ein Betreff mit Fragezeichen ist der haeufigste Weg in denselben Fehler
    // und faellt auch ohne Micro-Yes im Angebot auf.
    for (const v of step.variants) {
      if (subjectAsks(v.subject)) {
        problems.push({ kind: "subjectAsks", step: i + 1 });
        break;
      }
    }

    if (microYes?.trim()) {
      // Zuerst die Abschrift: sie ist der schwerere Befund und macht den
      // Spiegel-Befund gegenstandslos — ein abgeschriebener Micro-Yes
      // spiegelt ihn natuerlich.
      const abgeschrieben = step.variants.some((v) => subjectCopiesMicroYes(v.subject, microYes));
      if (abgeschrieben) {
        problems.push({ kind: "subjectIsMicroYes", step: i + 1 });
      } else {
        for (const v of step.variants) {
          if (!mirrorsMicroYes(v.subject, microYes)) {
            problems.push({ kind: "subjectNoMirror", step: i + 1 });
            break;
          }
        }
      }
    }

    // Der Betreff bleibt ueber die Sequenz derselbe — die Follow-ups gehoeren
    // in dasselbe Gespraech. Verglichen wird Fassung fuer Fassung gegen Stufe
    // 1, damit A und B verschiedene Betreffs haben duerfen.
    if (i > 0 && steps[0]) {
      const abgewichen = step.variants.some((v, k) => {
        const erste = steps[0].variants[k];
        return erste && normVergleich(v.subject) !== normVergleich(erste.subject);
      });
      if (abgewichen) problems.push({ kind: "subjectDrift", step: i + 1 });
    }

    // Kompression. Verglichen wird die laengste Fassung je Stufe: eine kurze
    // Variante rettet keine lange.
    //
    // Gemessen wird die Mail, wie sie ANKOMMT (estimateWords), nicht der
    // rohe Text. Der Unterschied betrifft praktisch nur Stufe 1: dort stehen
    // {{personalization}} und moeglicherweise {{websiteFinding}}, zusammen
    // ueber fuenfzig Woerter, die als zwei Zeichenketten gezaehlt wuerden.
    // Roh gemessen sah eine Stufe 1 mit beiden Platzhaltern KUERZER aus als
    // ihr eigenes Follow-up, und die Kompressionsregel meldete einen Bruch an
    // einer Sequenz, die beim Empfaenger sauber schrumpft. Die Stufen 2 bis 4
    // enthalten nur {{firstName}}, dort sind beide Zahlen gleich.
    if (i > 0) {
      const laengste = (s: DraftStep) =>
        Math.max(...s.variants.map((v) => estimateWords(v.body, opts.personalizationWords)), 0);
      if (laengste(step) >= laengste(steps[i - 1])) {
        problems.push({ kind: "notShorter", step: i + 1 });
      }
    }
  });

  const alleTexte = steps.flatMap((s) => s.variants.flatMap((v) => [v.subject, v.body])).join("\n");
  const tags = unknownTags(alleTexte);
  if (tags.length > 0) problems.push({ kind: "unknownTags", tags });

  const erste = steps[0];
  if (erste) {
    for (const v of erste.variants) {
      // Lead-spezifisch muss Stufe 1 sein; WOMIT, entscheidet das Angebot.
      // {{websiteFinding}} erfuellt das genauso wie {{personalization}}:
      // alle Website-Kampagnen seit dem 2026-08-27 tragen NUR den Befund
      // ("der Befund ist die Personalisierung"), und beide Variablen
      // zusammen passen seit FINDING_MAX_WORDS = 55 rechnerisch nicht mehr
      // in die 90 Woerter von Mail 1 (55 + 35 = 90, null Rest fuer Text).
      if (
        !v.body.includes("{{personalization}}") &&
        !v.body.includes("{{websiteFinding}}")
      ) {
        problems.push({ kind: "missingPersonalization" });
        break;
      }
    }
    // Einleitung vor dem Aufhaenger. Er ist ein vollstaendiger Satz; alles,
    // was ihn einleitet, zerlegt ihn beim Versand.
    for (const v of erste.variants) {
      const einleitung = leadInBefore(v.body);
      if (einleitung) {
        problems.push({ kind: "personalizationLeadIn", text: einleitung });
        break;
      }
    }
    for (const v of erste.variants) {
      const words = estimateWords(v.body, opts.personalizationWords);
      if (words > FIRST_MAIL_MAX_WORDS) {
        problems.push({ kind: "firstMailTooLong", words, max: FIRST_MAIL_MAX_WORDS });
        break;
      }
    }
    if (erste.variants.some((v) => hasLink(v.body))) problems.push({ kind: "firstMailHasLink" });
  }

  return problems;
}

/**
 * Was steht auf derselben Zeile VOR dem Aufhaenger?
 *
 * Eine Anrede darf dort stehen — sie ist eine eigene Zeile und wird
 * abgezogen. Alles Weitere ist eine Einleitung, und die zerlegt den
 * Aufhaenger: er beginnt bereits gross und endet bereits mit einem Punkt.
 *
 * Liefert null, wenn nichts davor steht oder der Platzhalter fehlt.
 */
export function leadInBefore(body: string): string | null {
  const at = body.indexOf("{{personalization}}");
  if (at === -1) return null;
  // Die letzte NICHT LEERE Zeile davor, nicht bloss die letzte: nach dem
  // mechanischen Freistellen (freeStandingPersonalization) steht die
  // Einleitung eine Zeile hoeher, und eine Pruefung auf die unmittelbare
  // Zeile fände dort nur die leere.
  const zeile =
    body
      .slice(0, at)
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .pop() ?? "";
  const ohneAnrede = zeile.includes("{{firstName}}")
    ? zeile.slice(zeile.indexOf("{{firstName}}") + "{{firstName}}".length).replace(/^[\s,:.!-]+/, "")
    : zeile;
  const rest = ohneAnrede.trim();
  return rest.length > 0 ? rest : null;
}

/**
 * Traegt die erste Zeile eine Anrede?
 *
 * Geprueft wird auf {{firstName}} in der ersten nichtleeren Zeile, nicht auf
 * ein bestimmtes Grusswort: "Hi", "Hallo", "Guten Tag" und "Moin" sind alle
 * richtig, und eine Liste erlaubter Woerter waere beim ersten englischen
 * Angebot unvollstaendig.
 */
function hatAnrede(body: string): boolean {
  const ersteZeile = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  return ersteZeile.includes("{{firstName}}");
}

/**
 * Steht die hinterlegte Unterschrift unter der Mail?
 *
 * Verglichen wird normalisiert und nicht woertlich, aus zwei gemessenen
 * Gruenden (2026-08-16, an den erzeugten Entwuerfen nachgesehen): das Modell
 * haengt gern ein Komma an den Gruss ("Beste Grüße," statt "Beste Grüße") und
 * setzt die Zeilen der Signatur anders um. Beides ist dieselbe Unterschrift.
 * Was zaehlt, ist die Wortfolge — und die muss vollstaendig vorkommen, weil
 * der Prompt sie woertlich vorgibt.
 */
function hatSignatur(body: string, signature: string): boolean {
  const nadel = normVergleich(signature);
  if (!nadel) return true;
  return normVergleich(body).includes(nadel);
}

/**
 * Text vergleichbar machen: Kleinschreibung, Satzzeichen weg, ein Leerzeichen.
 *
 * Beim Betreff heisst das: ein nachgestelltes Fragezeichen ist keine
 * Abweichung. Bei der Signatur: Zeilenumbrueche fallen zu Leerzeichen
 * zusammen, ein mehrzeiliger Gruss laesst sich damit am Stueck suchen.
 */
function normVergleich(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ab wann zwei Fassungen dieselbe sind: mehr als vier Fuenftel gemeinsame
 *  Woerter. Kein hergeleiteter Wert, sondern die Grenze, ab der ein Vergleich
 *  offensichtlich nichts mehr misst. */
const AEHNLICHKEIT_GRENZE = 0.8;

function aehnlich(a: string, b: string): boolean {
  const worte = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/\{\{[^}]*\}\}/g, " ")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2)
    );
  const A = worte(a);
  const B = worte(b);
  if (A.size === 0 || B.size === 0) return false;
  let gemeinsam = 0;
  for (const w of A) if (B.has(w)) gemeinsam++;
  return gemeinsam / Math.min(A.size, B.size) > AEHNLICHKEIT_GRENZE;
}

/**
 * Die Befunde als Korrekturauftrag ans Modell — auf Englisch, wie der
 * Prompt selbst.
 */
export function correctionInstruction(problems: SequenceProblem[]): string {
  const zeilen = problems.map((p) => {
    switch (p.kind) {
      case "stepCount":
        return `- You returned ${p.got} steps. Return exactly ${DEFAULT_STEP_COUNT}.`;
      case "variantCount":
        return `- Step ${p.step} has ${p.got} variants. It needs exactly ${DEFAULT_VARIANTS_PER_STEP}.`;
      case "missingPersonalization":
        return "- Step 1 must start with the literal token {{personalization}} on its own line.";
      case "firstMailTooLong":
        return `- Step 1 comes to about ${p.words} words once the opening line is inserted, the limit is ${p.max}. Cut it, do not rephrase it.`;
      case "firstMailHasLink":
        return "- Step 1 contains a link. Remove it entirely.";
      case "unknownTags":
        return `- These placeholders are never replaced and would reach the recipient: ${p.tags.join(", ")}. Remove them or write the words out.`;
      case "dash":
        return `- Step ${p.step} uses a dash character. Replace it with a comma or a full stop.`;
      case "variantsTooSimilar":
        return `- The two variants of step ${p.step} say the same thing. Rewrite variant B with a different angle and a different question.`;
      case "noGreeting":
        return `- Step ${p.step} has no greeting. Start it with a greeting line containing {{firstName}}, followed by a blank line.`;
      case "missingSignature":
        return `- Step ${p.step} does not end with the signature you were given. Put it back, word for word, on its own lines after the question.`;
      case "noParagraphs":
        return `- Step ${p.step} is one solid block. Break it into paragraphs of one to three sentences, separated by blank lines.`;
      case "personalizationLeadIn":
        return `- Remove "${p.text}" in front of {{personalization}}. That token is already a full sentence; nothing may introduce it and nothing may follow it on that line.`;
      case "stepTooLong":
        return `- Step ${p.step} is ${p.words} words, the limit is ${p.max}. Cut it down, do not rewrite it.`;
      case "notShorter":
        return `- Step ${p.step} is not shorter than the step before it. Every follow-up must be shorter than its predecessor. Cut, do not add.`;
      case "subjectTooLong":
        return `- The subject of step ${p.step} is ${p.words} words, the limit is ${p.max}.`;
      case "subjectDrift":
        return `- Step ${p.step} uses a different subject than step 1. All four steps of a variant share one subject.`;
      case "subjectNoMirror":
        return `- The subject of step ${p.step} announces something other than the question the email asks. Make it name that decision.`;
      case "subjectIsMicroYes":
        return (
          `- The subject of step ${p.step} is the micro yes itself. Do not put the question in the subject: ` +
          "name the thing it is about instead, in three or four words, and let the mail ask."
        );
      case "subjectAsks":
        return `- The subject of step ${p.step} ends with a question mark. A subject labels, it does not ask.`;
      case "bannedPhrase":
        return `- Step ${p.step} contains "${p.phrase}". Remove it; it marks the mail as bulk mail.`;
      case "meetingAsk":
        return `- Step ${p.step} asks for a meeting, a call or a time slot. Remove it and ask the micro yes instead.`;
      case "copiedNote":
        return `- Step ${p.step} copies a note from the offer word for word: "${p.text}". Those are the sender's private jottings. Say the same thing in your own, natural sentence.`;
    }
  });
  return [
    "Your previous answer broke these rules:",
    ...zeilen,
    "Fix exactly these points and answer again with the full JSON array. Change nothing else.",
  ].join("\n");
}
