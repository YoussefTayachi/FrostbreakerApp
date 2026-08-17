/**
 * Die Pruefungen des Playbooks, angewandt auf das ANGEBOT.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM AM ANGEBOT UND NICHT AM TEXT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * sequenceProblems() prueft das Erzeugnis. Hier wird die Quelle geprueft,
 * und das ist die frueheste Stelle, an der man etwas retten kann. Ein Outcome
 * ohne Zeitrahmen erzeugt vier Mails ohne Zeitrahmen, und dann steht der
 * Nutzer vor acht Textfeldern und weiss nicht, warum sie sich beliebig
 * anfuehlen. Am Feld selbst ist derselbe Befund eine Zeile Arbeit.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS HIER BEWUSST NICHT GEPRUEFT WIRD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das Playbook hat zwei Tests, die ein Rechner nicht bestehen kann:
 *
 *  - Der 90-Tage-Kosten-Test ("wenn dieses Problem 90 Tage weiterlaeuft, was
 *    kostet das?"). Ob eine Antwort darauf existiert, weiss nur der Nutzer.
 *  - Ob der Micro-Yes INHALTLICH binaer ist. "Welche der zwei Varianten
 *    gefaellt dir besser?" endet auch mit einem Fragezeichen.
 *
 * Beides gehoert in den Coach, der fragen kann. Hier steht nur, was sich
 * nachmessen laesst: lieber fuenf harte Befunde als zwoelf, von denen sieben
 * geraten sind. Ein Warnsystem, das oft danebenliegt, schaltet der Nutzer nach
 * einer Woche im Kopf ab.
 */
import {
  MECHANISM_JARGON,
  bannedPhrasesIn,
  hasNumber,
  hasTimeframe,
  microYesProblems,
  wordCount,
  type MicroYesProblem,
} from "./playbook";
import type { Offer, OfferTextField } from "@/lib/offers";

export type OfferFinding =
  /** Der Outcome nennt kein "in X Tagen". */
  | { kind: "outcomeNoTimeframe" }
  /** Der Outcome nennt keine Zahl, also keine Metrik, sondern eine Stimmung. */
  | { kind: "outcomeNoNumber" }
  /** Im Mechanismus stehen Werkzeugwoerter. */
  | { kind: "mechanismJargon"; words: string[] }
  /** Der Micro-Yes ist keine binaere Frage. */
  | { kind: "microYes"; problems: MicroYesProblem[] }
  /** Es wird etwas versprochen, aber ohne Zeitzusage. */
  | { kind: "reviewTimeMissing" }
  /** Die Zeitzusage enthaelt keine Zahl. */
  | { kind: "reviewTimeVague" }
  /** Die Friction ist zu allgemein, um eine Beobachtung zu tragen. */
  | { kind: "frictionTooBroad" }
  /** Der Kernsatz laesst sich nicht in 15 Sekunden sagen. */
  | { kind: "tooLongToSay"; words: number; max: number };

/** Zu welchem Feld ein Befund gehoert, fuer die Anzeige unter dem Feld. */
export const FINDING_FIELD: Record<OfferFinding["kind"], OfferTextField> = {
  outcomeNoTimeframe: "outcome",
  outcomeNoNumber: "outcome",
  mechanismJargon: "mechanism",
  microYes: "cta",
  reviewTimeMissing: "review_time",
  reviewTimeVague: "review_time",
  frictionTooBroad: "friction",
  tooLongToSay: "offering",
};

/**
 * Ab wie vielen Woertern eine Friction konkret genug sein KANN.
 *
 * Keine inhaltliche Pruefung, nur eine untere Schranke: "alte Website" oder
 * "schlechtes Marketing" sind drei Woerter und beschreiben nichts, was der
 * Empfaenger nachsehen koennte. Vier Woerter machen einen Satz noch nicht
 * konkret, aber unter vier ist er es sicher nicht.
 */
const FRICTION_MIN_WORDS = 4;

/**
 * Der 15-Sekunden-Test, so nah man ihm rechnerisch kommt.
 *
 * Im Playbook ist das ein Sprechtest: den Kern des Angebots ruhig und ohne
 * Ablesen in 15 Sekunden erklaeren. Ruhiges Sprechen sind rund 150 Woerter je
 * Minute, also etwa 38 Woerter in 15 Sekunden. Gezaehlt werden die drei Felder,
 * die zusammen den Kernsatz ergeben: was, wofuer, wie.
 *
 * Das ist eine Naeherung und wird auch so beschriftet. Sie taugt, um ein
 * Angebot zu erkennen, das in drei Schachtelsaetzen erklaert wird, nicht, um
 * zwischen 36 und 40 Woertern zu richten.
 */
const SPOKEN_WORDS_PER_15_SECONDS = 38;

export function coreSentenceWords(offer: Pick<Offer, "offering" | "outcome" | "mechanism">): number {
  return wordCount(offer.offering) + wordCount(offer.outcome) + wordCount(offer.mechanism);
}

export function offerFindings(offer: Pick<Offer, OfferTextField>): OfferFinding[] {
  const findings: OfferFinding[] = [];

  const outcome = offer.outcome.trim();
  if (outcome) {
    if (!hasTimeframe(outcome)) findings.push({ kind: "outcomeNoTimeframe" });
    if (!hasNumber(outcome)) findings.push({ kind: "outcomeNoNumber" });
  }

  const mechanism = offer.mechanism.trim();
  if (mechanism) {
    const words = bannedPhrasesIn(mechanism, MECHANISM_JARGON);
    if (words.length > 0) findings.push({ kind: "mechanismJargon", words });
  }

  // Der Micro-Yes wird nur bemaengelt, wenn er ausgefuellt ist. Ein leeres
  // Pflichtfeld meldet ohnehin schon der Ring; zwei Meldungen fuer dasselbe
  // Loch sind eine zu viel.
  if (offer.cta.trim()) {
    const problems = microYesProblems(offer.cta);
    if (problems.length > 0) findings.push({ kind: "microYes", problems });
  }

  const friction = offer.friction.trim();
  if (friction && wordCount(friction) < FRICTION_MIN_WORDS) {
    findings.push({ kind: "frictionTooBroad" });
  }

  // Die Zeitzusage haengt am Versprechen: ohne preview_asset gibt es nichts
  // anzusehen, und dann ist eine fehlende Zeitangabe kein Mangel.
  if (offer.preview_asset.trim()) {
    const zeit = offer.review_time.trim();
    if (!zeit) findings.push({ kind: "reviewTimeMissing" });
    else if (!hasNumber(zeit)) findings.push({ kind: "reviewTimeVague" });
  }

  const kern = coreSentenceWords(offer);
  if (kern > SPOKEN_WORDS_PER_15_SECONDS) {
    findings.push({ kind: "tooLongToSay", words: kern, max: SPOKEN_WORDS_PER_15_SECONDS });
  }

  return findings;
}
