/**
 * Aus einem Angebot eine vollstaendige Mail-Sequenz machen.
 *
 * WOFUER
 *
 * Der Weg von der fertigen Lead-Liste zur laufenden Kampagne fuehrte bisher
 * durch acht leere Textfelder (vier Stufen mal Betreff und Text). Genau dort
 * endet Akquise fuer die meisten Nutzer -- nicht an den Leads, nicht an der
 * Zustellbarkeit, sondern an der Frage "was schreibe ich denn?".
 *
 * Hier steht das, was man testen kann: wie aus einem Angebot (Migration 0090)
 * ein Auftrag ans Modell wird, wie aus dessen Antwort benutzbare Stufen
 * werden, und woran ein Entwurf scheitert. Der Aufruf selbst sitzt in
 * api/copy/sequence -- nach demselben Schnitt wie lib/crm/reply-suggestions.ts.
 *
 * DIE REGEL, DIE DIESE DATEI TRAEGT
 *
 * Der Generator darf nichts erzeugen, was der eigene Torwart
 * (lib/campaign-readiness.ts) danach blockiert. Deshalb kommen die Grenzen
 * fuer die erste Mail -- Wortzahl, kein Link -- aus genau denselben
 * Konstanten und werden mit genau denselben Funktionen nachgemessen. Ein
 * Vorschlag, der beim Absenden rot wird, waere schlimmer als kein Vorschlag:
 * er saehe fertig aus.
 */
import { FIRST_MAIL_MAX_WORDS, estimateWords, hasLink } from "@/lib/campaign-readiness";
import { DEFAULT_MAX_WORDS } from "@/lib/personalization-defaults";
import type { Offer } from "@/lib/offers";

/**
 * Die Platzhalter, die Instantly beim Versand tatsaechlich ersetzt.
 *
 * Muss mit VARIABLES in app/instantly/campaigns/campaign-step-card.tsx
 * uebereinstimmen (Quelle: https://help.instantly.ai/en/articles/6135930).
 * Ein erfundener Platzhalter wird NICHT ersetzt -- er geht als
 * "{{painPoint}}" an den Empfaenger raus, und das faellt erst dort auf.
 */
export const EMAIL_MERGE_TAGS = ["firstName", "lastName", "companyName", "email", "personalization"] as const;
export type EmailMergeTag = (typeof EMAIL_MERGE_TAGS)[number];

/** Vier Stufen: Erstkontakt, anderer Blickwinkel, kurze Nachfrage, Abschied. */
export const DEFAULT_STEP_COUNT = 4;
/** Zwei Fassungen je Stufe -- siehe Begruendung in buildSequencePrompt. */
export const DEFAULT_VARIANTS_PER_STEP = 2;

/**
 * Abstaende in Tagen, von uns gesetzt und nicht vom Modell.
 *
 * Ein Sprachmodell hat zu Sendeabstaenden keine Meinung, die besser waere als
 * eine feste Vorgabe -- es hat nur eine, die von Lauf zu Lauf schwankt. Jedes
 * Feld, das das Modell nicht ausfuellen muss, ist ein Feld, das nicht
 * schiefgehen kann.
 */
export const DEFAULT_DELAYS = [0, 2, 3, 5];

export type DraftVariant = { subject: string; body: string };
export type DraftStep = { variants: DraftVariant[]; delayDays: number };

export type SequenceOptions = {
  /** Terminlink aus den Einstellungen (workspaces.calendar_link, Migration 0073). */
  calendarLink: string | null;
  /** Name unter der Mail (workspaces.reply_sender_name). */
  senderName: string | null;
  /** Wortgrenze der Aufhaengerzeile -- sie zaehlt in der ersten Mail mit. */
  personalizationWords: number;
  /**
   * Die beste eigene Fassung als Vorbild. NUR uebergeben, wenn die Menge dafuer
   * reicht (lib/report/copy-outcomes.ts, MIN_SAMPLE) -- sonst zementiert der
   * Generator einen Zufallstreffer aus vierzig Mails.
   */
  bestExample?: DraftVariant | null;
};

export function defaultSequenceOptions(): SequenceOptions {
  return {
    calendarLink: null,
    senderName: null,
    personalizationWords: DEFAULT_MAX_WORDS,
    bestExample: null,
  };
}

/**
 * Wie viele EIGENE Woerter die erste Mail haben darf.
 *
 * Die Wortgrenze des Torwarts gilt fuer die Mail, wie sie ankommt -- also
 * inklusive des eingesetzten Aufhaengers. Dem Modell die 90 zu nennen hiesse,
 * es um die Laenge des Aufhaengers zu betruegen; es schriebe 90 und die Mail
 * kaeme mit 112 an. Der kleine Abzug am Ende ist Luft fuer Anrede und Gruss.
 */
export function ownWordBudget(personalizationWords: number): number {
  // Der Abzug deckt Anrede, Gruss und Unterschrift ab -- die drei Zeilen, die
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
 * Ist beides leer, gibt es KEINE Unterschrift -- und der Prompt sagt das
 * ausdruecklich. Ein erfundener Name unter einer Geschaeftsmail ist schlimmer
 * als gar keiner.
 */
export function signatureFor(offer: Offer, senderName: string | null): string {
  const eigene = offer.signature.trim();
  if (eigene) return eigene;
  const name = (senderName ?? "").trim();
  if (!name) return "";
  return offer.language === "en" ? `Best,\n${name}` : `Beste Grüße\n${name}`;
}

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

/** Ein Angebotsfeld als Prompt-Zeile -- oder als ausdrueckliches Verbot. */
function fieldLine(label: string, value: string, emptyInstruction: string): string {
  const v = value.trim();
  return v ? `${label}: ${v}` : `${label}: (nicht angegeben) -> ${emptyInstruction}`;
}

/**
 * Der Auftrag ans Modell.
 *
 * Auf Englisch formuliert, aus demselben Grund wie constraint_block() in
 * personalize.py: Formvorgaben befolgt das Modell in Englisch verlaesslicher.
 * Was das NICHT beeinflusst, ist die Sprache der Mails -- die steht als harte
 * Vorgabe drin und kommt aus dem Angebot.
 */
/** Die Anrede, die als Schablone im Prompt steht. Immer mit {{firstName}}:
 *  eine Mail ohne Namen liest sich wie ein Rundschreiben, und der Name ist
 *  der eine Platzhalter, den jeder Lead sicher hat. */
export function greetingLine(offer: Offer): string {
  if (offer.language === "en") return "Hi {{firstName}},";
  return offer.address_form === "sie" ? "Guten Tag {{firstName}}," : "Hi {{firstName}},";
}

export function buildSequencePrompt(offer: Offer, opts: SequenceOptions): string {
  const budget = ownWordBudget(opts.personalizationWords);
  const sprache = LANGUAGE_NAMES[offer.language] ?? "German";
  const signature = signatureFor(offer, opts.senderName);

  const lines: string[] = [
    "You write cold outreach email sequences that get REPLIES, not admiration.",
    `Write a ${DEFAULT_STEP_COUNT}-step sequence with ${DEFAULT_VARIANTS_PER_STEP} variants per step.`,
    "",
    "THE OFFER (this is the only thing you know about the sender):",
    fieldLine("What they sell", offer.offering, "keep it abstract, never invent a product"),
    fieldLine("Who they sell to", offer.icp, "write for a generic business owner"),
    fieldLine("Problem before", offer.problem, "do not assert a specific pain"),
    fieldLine("Outcome after", offer.outcome, "do not promise a specific result"),
    // Der wichtigste leere Fall im ganzen Prompt. Ein Modell ohne Referenzen
    // erfindet "over 200 happy clients" -- das faellt nicht dem auf, der die
    // Mail schreibt, sondern dem Empfaenger, der nachfragt.
    fieldLine(
      "Proof",
      offer.proof,
      "NO proof exists. Never mention clients, numbers, case studies, years of experience or results. Not even vaguely"
    ),
    fieldLine("Desired next step", offer.cta, "ask a small, low-effort question instead of requesting a meeting"),
    fieldLine("Tone notes", offer.tone, "direct, plain, business-like"),
    "",
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
    `- In step 1 the SECOND block is the literal token {{personalization}} on its own. It is replaced per recipient with a researched opening line, so never write your own opening observation.`,
    `- Step 1: at most ${budget} words of your own (the token above counts for roughly ${opts.personalizationWords} more).`,
    "- Step 1 must contain NO link and NO URL of any kind.",
    "- Steps 2 to 4 stay short, 40 to 70 words, and each one does something NEW:",
    "  step 2 a different angle or a concrete example, step 3 a one-line question,",
    "  step 4 a friendly close that makes it easy to say no.",
    "- Never write a follow-up that only says 'just bumping this up'. If a step has nothing to add, give it something to add.",
    `- Placeholders: only ${EMAIL_MERGE_TAGS.map((t) => `{{${t}}}`).join(", ")}. Any other {{...}} is never replaced and reaches the recipient as-is.`,
    "- Never use square brackets or angle brackets as fill-in blanks ([Name], <company>). If you do not know something, leave it out.",
    // Gleiche Begruendung wie DEFAULT_BANNED_WORDS in personalize.py: ein
    // Gedankenstrich mitten im Satz ist inzwischen das deutlichste
    // Erkennungszeichen fuer maschinell geschriebenen Text.
    "- Never use the characters — – or -- anywhere. Use a comma or a full stop.",
    "- Subjects: 2 to 5 words, lowercase-ish, no colon-separated marketing headline, no 'Re:' or 'Fwd:' fakery.",
    "- No exclamation marks, no ALL CAPS, no 'I hope this email finds you well'.",
    // Zwei Fassungen sind nur dann etwas wert, wenn sie sich unterscheiden.
    // Zwei Umformulierungen desselben Gedankens messen nichts -- der
    // A/B-Apparat (Migration 0071) wuerde Rauschen vergleichen.
    "- The two variants of a step must differ in APPROACH, not in wording. Different angle, different question, different first sentence.",
    "- Each email must be complete and sendable as it stands."
  );

  if (opts.calendarLink) {
    lines.push(`- Where a meeting fits, use exactly this link: ${opts.calendarLink} (never in step 1).`);
  } else {
    // Wortgleich zur Begruendung in Migration 0073: ein erfundener
    // Terminlink faellt erst dem Empfaenger auf, und dann ist es zu spaet.
    lines.push("- There is NO booking link. Never invent one. Ask for a reply instead.");
  }
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

/** Das erste JSON-Array im Text -- auch wenn ein Satz oder ein Codeblock
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
 * passiert, ist Reparieren -- ein zu langer Text bleibt zu lang und wird von
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
  | { kind: "noGreeting"; step: number };

/**
 * Ab wie vielen Woertern eine Mail ohne Leerzeile als Wand gilt.
 *
 * Darunter ist ein einzelner Block voellig in Ordnung -- eine Nachfassmail
 * mit zwei Saetzen braucht keinen Absatz, und sie deswegen anzumeckern waere
 * dieselbe Sorte unbegruendetes Rot, die beim Copy-Check gerade abgeschafft
 * wurde.
 */
const PARAGRAPH_REQUIRED_FROM_WORDS = 35;

/**
 * Was an einem Entwurf nicht stimmt -- deterministisch, ohne zweiten
 * Modellaufruf.
 *
 * Grundlage fuer genau EINE Korrekturrunde, wie in personalize.py: das Modell
 * erfaehrt seinen Fehler und antwortet neu. Bleibt der Fehler, wird der
 * Entwurf trotzdem gezeigt, mit dem Befund daneben -- ein Text, an dem noch
 * zwei Woerter fehlen, ist mehr wert als eine Fehlermeldung.
 *
 * Die ersten Mails werden mit denselben Funktionen gemessen, die der Torwart
 * benutzt (estimateWords, hasLink), nicht mit eigenen Naeherungen.
 */
export function sequenceProblems(steps: DraftStep[], opts: SequenceOptions): SequenceProblem[] {
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
    // liest sich die Mail wie ein Rundschreiben -- der gemeldete Fall vom
    // 2026-08-12 hatte weder Anrede noch Gruss.
    if (step.variants.some((v) => !hatAnrede(v.body))) {
      problems.push({ kind: "noGreeting", step: i + 1 });
    }
    // Absaetze: erst ab einer Laenge, ab der ein Block wirklich stoert.
    if (
      step.variants.some(
        (v) => v.body.split(/\s+/).filter(Boolean).length >= PARAGRAPH_REQUIRED_FROM_WORDS && !/\n\s*\n/.test(v.body)
      )
    ) {
      problems.push({ kind: "noParagraphs", step: i + 1 });
    }
  });

  const alleTexte = steps.flatMap((s) => s.variants.flatMap((v) => [v.subject, v.body])).join("\n");
  const tags = unknownTags(alleTexte);
  if (tags.length > 0) problems.push({ kind: "unknownTags", tags });

  const erste = steps[0];
  if (erste) {
    for (const v of erste.variants) {
      if (!v.body.includes("{{personalization}}")) {
        problems.push({ kind: "missingPersonalization" });
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
 * Die Befunde als Korrekturauftrag ans Modell -- auf Englisch, wie der
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
      case "noParagraphs":
        return `- Step ${p.step} is one solid block. Break it into paragraphs of one to three sentences, separated by blank lines.`;
    }
  });
  return [
    "Your previous answer broke these rules:",
    ...zeilen,
    "Fix exactly these points and answer again with the full JSON array. Change nothing else.",
  ].join("\n");
}
