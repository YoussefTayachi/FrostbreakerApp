/**
 * Das Playbook: die Regeln, nach denen in dieser App geschrieben wird.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WOHER DAS KOMMT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Aus dem Verkaufs-Wissen des Betreibers (zwei Kurse: Offer Blueprint und
 * Outreach Engine). Hier stehen die daraus destillierten REGELN in eigenen
 * Worten, nicht das Kursmaterial selbst. Das ist kein Zufall: Regeln wie
 * "drei bis vier Woerter im Betreff" sind Handwerk und gehoeren ins Produkt,
 * die Formulierungen eines fremden Kurses gehoeren dem Kurs.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DAS HIER STEHT UND NICHT IM PROMPT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein Prompt sagt "bitte". Eine Pruefung sagt "nein".
 *
 * Alles, was sich mechanisch nachmessen laesst (Wortzahlen, verbotene
 * Wendungen, ob ein Follow-up laenger wurde als sein Vorgaenger), steht
 * deshalb als Funktion hier und wird nach der Erzeugung angewandt. Der Prompt
 * bekommt dieselben Regeln als Text, aber er ist die zweite Verteidigungslinie,
 * nicht die erste. Genau dieses Muster traegt schon sequenceProblems() und es
 * hat sich bewaehrt: das Modell haelt sich an vier von fuenf Vorgaben, und die
 * fuenfte faellt beim Messen auf.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE DREI SAETZE, AUF DIE SICH ALLES ZURUECKFUEHREN LAESST
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. EINE Friction, EIN Micro-Yes, ueber alle vier Stufen dieselben. Wer im
 *    Follow-up ein neues Thema braucht, hatte in Mail 1 die falsche Friction.
 * 2. Jede Stufe ist KUERZER als die vorherige. Wer bei ausbleibender Antwort
 *    mehr schreibt, trainiert sich das Hinterherlaufen an.
 * 3. Nichts behaupten, was nicht belegt ist. Kein erfundener Wert, keine
 *    erfundene Referenz, keine erfundene Zahl. Das faellt nicht dem auf, der
 *    die Mail schreibt, sondern dem Empfaenger.
 */

/**
 * Die Abstaende der Sequenz in Tagen: Tag 0, 3, 5, 7.
 *
 * `delayDays` heisst "warte so lange VOR dieser Stufe"
 * (lib/instantly/campaigns.test.ts), also 0 + 3 + 2 + 2.
 *
 * Die Abstaende SCHRUMPFEN, und das ist der Punkt. Die erste Fassung dieser
 * App hatte [0, 2, 3, 5]: wachsende Abstaende ueber zehn Tage. Das ist die
 * Rhythmik einer Erinnerungskette ("melde mich nochmal"), nicht die einer
 * Entscheidung: wer nach zehn Tagen nachfasst, faengt beim Empfaenger bei null
 * an. Sieben Tage mit enger werdenden Abstaenden halten den Vorgang zusammen
 * und sind am siebten Tag abgeschlossen.
 */
export const PLAYBOOK_DELAYS = [0, 3, 2, 2];

/**
 * Wortzahl je Stufe, als Obergrenze.
 *
 * Nur Stufe 1 hat eine harte Grenze, die woanders herkommt
 * (FIRST_MAIL_MAX_WORDS aus campaign-readiness.ts, der Torwart, der den
 * Versand blockiert). Die Grenzen der Stufen 2 bis 4 sind die
 * Kompressionsarchitektur: jede Stufe hoechstens zwei Drittel der vorherigen.
 * Die Zahlen sind keine Messwerte, sondern eine gesetzte Staffelung; was
 * zaehlt, ist das Gefaelle, nicht der einzelne Wert.
 */
export const STEP_MAX_WORDS = [90, 70, 50, 35];

/**
 * Der Betreff.
 *
 * Kein Koeder, sondern ein Entscheidungsschild: er sagt, worueber der
 * Empfaenger gleich Ja oder Nein sagen soll. Drei bis vier Woerter, und er
 * spiegelt den Micro-Yes: steht im Betreff eine andere Entscheidung als im
 * Text, ist die Mail in sich widerspruechlich.
 */
export const SUBJECT_MAX_WORDS = 5;
export const SUBJECT_IDEAL_WORDS = 4;

/**
 * Wendungen, die eine Kaltmail sofort als Kaltmail ausweisen.
 *
 * Drei Gruppen, alle aus demselben Grund verboten: sie sind Signale einer
 * Massenaussendung, und der Empfaenger erkennt sie schneller als den Inhalt.
 *
 *  - Hoeflichkeitsfloskeln ohne Aussage ("ich hoffe, es geht dir gut")
 *  - Nachfass-Floskeln, die zugeben, dass es nichts Neues gibt
 *    ("wollte nur nochmal nachhaken"); der Kurs nennt das den Ton, an dem
 *    man Beduerftigkeit hoert
 *  - Werbesprache ("Game Changer", "revolutionaer")
 *
 * Kleingeschrieben verglichen, Wortgrenzen beachtet.
 */
export const BANNED_PHRASES: readonly string[] = [
  // Floskeln ohne Aussage
  "i hope this email finds you well",
  "i hope you are doing well",
  "hope you're doing well",
  "ich hoffe, es geht dir gut",
  "ich hoffe, es geht ihnen gut",
  "ich hoffe, diese mail erreicht",
  // Nachfassen ohne Inhalt
  "just checking in",
  "just following up",
  "circling back",
  "bumping this",
  "wollte nur nachhaken",
  "wollte nur nochmal",
  "nur ein kurzes update",
  "melde mich nochmal",
  // Werbesprache
  "game changer",
  "game-changer",
  "revolutionary",
  "revolutionaer",
  "revolutionär",
  "cutting edge",
  "state of the art",
  "no brainer",
  "skyrocket",
  "explodieren",
  "10x",
  // Agenturbaukasten
  "our team of experts",
  "unser expertenteam",
  "full service",
  "end-to-end solution",
  "ganzheitliche loesung",
  "ganzheitliche lösung",
];

/**
 * Woerter, die im Mechanismus nichts verloren haben.
 *
 * Der Kaeufer kauft ein Ergebnis, kein Werkzeug. Sobald "KI", "Agent" oder ein
 * Produktname im Satz steht, redet man ueber die Bauweise statt ueber das, was
 * herauskommt, und der Kaeufer muss die Uebersetzung selbst leisten.
 *
 * Nur fuer das Feld `mechanism` gedacht, nicht fuer die Mail insgesamt: eine
 * Mail, die "KI" NIRGENDS sagen darf, waere fuer eine KI-Agentur unschreibbar.
 */
export const MECHANISM_JARGON: readonly string[] = [
  "ki",
  "ai",
  "künstliche intelligenz",
  "kuenstliche intelligenz",
  "artificial intelligence",
  "agent",
  "agents",
  "llm",
  "gpt",
  "chatgpt",
  "api",
  "automation",
  "automatisierung",
  "workflow",
  "saas",
  "plattform",
  "platform",
  "tool",
  "software",
  "algorithmus",
  "machine learning",
  "n8n",
  "make.com",
  "zapier",
];

/** Wendungen, die aus einem Micro-Yes eine Terminbitte machen. */
export const MEETING_WORDS: readonly string[] = [
  "call",
  "termin",
  "meeting",
  "gespräch",
  "gespraech",
  "telefonat",
  "zoom",
  "kalender",
  "calendar",
  "15 minuten",
  "15 min",
  "30 minuten",
  "30 min",
  "hast du zeit",
  "haben sie zeit",
  "are you free",
  "book a",
  "schedule a",
];

/** Zeiteinheiten fuer die Pruefung von review_time und outcome. */
const TIME_UNITS =
  "sekunden|sekunde|minuten|minute|min|stunden|stunde|std|tagen|tage|tag|wochen|woche|monaten|monate|monat|seconds|second|secs|sec|minutes|minute|mins|hours|hour|days|day|weeks|week|months|month";

/** Enthaelt der Text eine Zahl UND eine Zeiteinheit? */
export function hasTimeframe(text: string): boolean {
  return new RegExp(`\\d+\\s*(${TIME_UNITS})\\b`, "i").test(text);
}

/** Enthaelt der Text ueberhaupt eine Zahl (Ziffer, Prozent, Waehrung)? */
export function hasNumber(text: string): boolean {
  return /\d/.test(text);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Welche verbotenen Wendungen stecken im Text?
 *
 * Wortgrenzen statt blossem includes: "10x" darf nicht in "110x" anschlagen
 * und "min" nicht in "minimal". Bei Wendungen mit Leerzeichen genuegt der
 * einfache Vergleich, weil sie ohnehin eindeutig sind.
 */
export function bannedPhrasesIn(text: string, list: readonly string[] = BANNED_PHRASES): string[] {
  const haystack = text.toLowerCase();
  return list.filter((p) => {
    if (p.includes(" ")) return haystack.includes(p);
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(p)}([^\\p{L}\\p{N}]|$)`, "iu").test(haystack);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ist das ein Micro-Yes, eine einzige binaere Frage?
 *
 * Gemessen wird, was messbar ist: eine Zeile, endet mit Fragezeichen, keine
 * Terminwoerter, kein Link, nicht zu lang. Was NICHT geprueft werden kann, ist
 * ob die Frage inhaltlich binaer ist ("welche Variante gefaellt dir besser?"
 * endet auch mit einem Fragezeichen). Diesen Teil uebernimmt der Coach, der
 * fragen kann.
 */
export type MicroYesProblem = "empty" | "multiline" | "noQuestion" | "meeting" | "link" | "tooLong";

/** Ab hier ist es keine Frage mehr, sondern ein Absatz. Exportiert, weil der
 *  Coach dem Modell dieselbe Zahl nennen muss; sonst schlaegt er einen
 *  Micro-Yes vor, den die App im naechsten Atemzug bemaengelt (gemessen am
 *  Live-Stand 2026-08-13: 30 Woerter). */
export const MICRO_YES_MAX_WORDS = 20;

/**
 * Sortiert nach SCHWERE, nicht nach Pruefreihenfolge.
 *
 * Unter dem Feld steht nur der erste Befund; drei Saetze unter einem
 * Eingabefeld liest niemand. Am Live-Stand aufgefallen (2026-08-13): bei
 * "Book a 30-minute call to review client setup and set up the first
 * workspace." meldete die Anzeige das fehlende Fragezeichen und verschwieg
 * die Terminbitte. Das fehlende Fragezeichen ist ein Formfehler, die
 * Terminbitte ist der eigentliche.
 */
export function microYesProblems(cta: string): MicroYesProblem[] {
  const t = cta.trim();
  if (!t) return ["empty"];
  const problems: MicroYesProblem[] = [];
  if (bannedPhrasesIn(t, MEETING_WORDS).length > 0) problems.push("meeting");
  if (/https?:\/\/|www\./i.test(t)) problems.push("link");
  if (t.split("\n").filter((l) => l.trim()).length > 1) problems.push("multiline");
  if (!t.endsWith("?")) problems.push("noQuestion");
  if (wordCount(t) > MICRO_YES_MAX_WORDS) problems.push("tooLong");
  return problems;
}

/**
 * Ab wie vielen Woertern ein woertlich uebernommener Feldinhalt als Abschrift
 * gilt.
 *
 * Kurze Uebereinstimmungen sind Zufall und keine Abschrift: "mehr Termine pro
 * Woche" steht in einem Angebotsfeld und darf auch in der Mail stehen. Ab
 * sechs Woertern in Folge hat niemand mehr denselben Satz zufaellig
 * geschrieben.
 */
const COPY_MIN_WORDS = 6;

function normalisiert(s: string): string {
  return s
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Welche Angebotsfelder stehen WOERTLICH in diesem Text?
 *
 * Die Felder sind Notizen des Absenders an sich selbst. Wandern sie
 * unveraendert in die Mail, liest der Empfaenger die Stichpunkte eines
 * Fremden, am Live-Stand gemessen (2026-08-13) samt Grammatikfehler und
 * einer Terminbitte, die als Micro-Yes gemeint war.
 *
 * Geprueft wird auf ganze Feldinhalte, nicht auf einzelne Woerter: dass die
 * Mail dieselben Begriffe benutzt wie das Angebot, ist ja der Zweck.
 */
export function copiedFrom(text: string, sources: string[]): string[] {
  const heu = normalisiert(text);
  return sources.filter((s) => {
    const nadel = normalisiert(s);
    if (nadel.split(" ").filter(Boolean).length < COPY_MIN_WORDS) return false;
    return heu.includes(nadel);
  });
}

/**
 * Spiegelt der Betreff den Micro-Yes?
 *
 * Die Regel aus dem Kurs lautet: der Betreff kuendigt genau die Entscheidung
 * an, die der Text verlangt. Vollstaendig pruefen laesst sich das nicht. Was
 * sich pruefen laesst, ist ob ueberhaupt ein inhaltliches Wort geteilt wird.
 * Ein Betreff ohne ein einziges gemeinsames Wort mit der Frage kuendigt
 * sicher etwas anderes an.
 *
 * Kurze Woerter fliegen raus, damit "der" und "eine" die Pruefung nicht
 * bestehen lassen.
 */
/**
 * Ist der Betreff nur die abgeschriebene Frage?
 *
 * Gemeldet am 2026-08-13 mit Bild: in allen vier Stufen stand als Betreff
 * woertlich "Reply yes then i can send you sth over?", also der Micro-Yes,
 * neun Woerter lang, mit Fragezeichen. Damit steht die Frage schon im
 * Posteingang, und die Mail dahinter hat nichts mehr zu sagen.
 *
 * Die Regel "der Betreff kuendigt die Entscheidung an" (mirrorsMicroYes)
 * laedt genau dazu ein: das Modell liest sie als "nimm die Frage". Deshalb
 * die Gegenprobe: ankuendigen heisst benennen, nicht abschreiben.
 *
 * Geprueft wird in beide Richtungen: der ganze Micro-Yes als Betreff faellt
 * ebenso auf wie sein Anfang ("Reply yes then i can").
 */
export function subjectCopiesMicroYes(subject: string, cta: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\{\{[^}]*\}\}/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const a = norm(subject);
  const b = norm(cta);
  if (!a || !b) return false;
  return b.includes(a) || a.includes(b);
}

/** Fragt der Betreff selbst? Ein Betreff ist ein Schild, keine Frage; die
 *  eine Frage steht in der letzten Zeile der Mail und nur dort. */
export function subjectAsks(subject: string): boolean {
  return subject.trim().endsWith("?");
}

export function mirrorsMicroYes(subject: string, cta: string): boolean {
  const inhalt = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/\{\{[^}]*\}\}/g, " ")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 3)
    );
  const a = inhalt(subject);
  const b = inhalt(cta);
  if (a.size === 0 || b.size === 0) return true; // nichts zu vergleichen
  for (const w of a) if (b.has(w)) return true;
  return false;
}
