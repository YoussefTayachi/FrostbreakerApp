/**
 * THAW als Coach: das Angebot pruefen, nicht den Text.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DAS BRAUCHT, OBWOHL ES SCHON PRUEFUNGEN GIBT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * lib/copy/offer-tests.ts misst, was messbar ist: fehlt ein Zeitrahmen, steht
 * ein Werkzeugwort im Mechanismus, endet der Micro-Yes mit einem Fragezeichen.
 *
 * Am 2026-08-13 stand ein Angebot dieser App auf 100 Prozent und gruen. Was
 * tatsaechlich drin stand:
 *
 *   "Was schickst du?"   -> "Meeting for a Phone Call"
 *   "Wie lange dauert?"  -> "5 Minutes Phone Call"
 *   "Die eine Frage"     -> "Book a 30-minute call to review client setup..."
 *   "Was belegt das?"    -> "Frostbreaker is proof for itself."
 *   "Was ist danach?"    -> "...10.6% reply rate, 17 meetings from 482 contacts..."
 *
 * Dreimal derselbe Termin in drei Feldern, die drei verschiedene Fragen
 * stellen. Und der Beleg steht im Ergebnisfeld, waehrend im Belegfeld ein
 * Wahlspruch steht -- die beiden sind VERTAUSCHT.
 *
 * Die messenden Pruefungen fanden davon drei von sieben. Die anderen vier
 * brauchen Bedeutung: dass "Meeting for a Phone Call" kein Anhang ist, dass
 * eine Kundenzahl ein Beleg und kein Ergebnis ist. Genau dafuer ist dieser
 * Aufruf da -- und fuer nichts sonst.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE GEFAEHRLICHSTE FEHLFUNKTION
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein Modell, das gebeten wird zu verbessern, verbessert IMMER etwas. Ein
 * Coach, der an jedem Feld etwas findet, ist nach der zweiten Woche Rauschen,
 * und ein Coach, der eine Terminbitte huebscher formuliert statt sie
 * abzulehnen, ist schlimmer als keiner: der schoenere falsche Satz fuehlt
 * sich fertig an.
 *
 * Deshalb steht im Prompt an drei Stellen ausdruecklich, dass Schweigen die
 * richtige Antwort ist, und der Parser wirft Befunde ohne Gegenvorschlag weg.
 */
import type { Offer, OfferTextField } from "@/lib/offers";
import { OFFER_TEXT_FIELDS } from "@/lib/offers";

/** Wie ernst ein Befund ist. Entscheidet ueber die Farbe am Knoten, nicht
 *  ueber die Reihenfolge -- die macht die Karte selbst. */
export type CoachSeverity = "blocker" | "weak";

export type CoachFinding = {
  field: OfferTextField;
  severity: CoachSeverity;
  /** Was nicht stimmt, ein Satz, in der Sprache des Angebots. */
  verdict: string;
  /** Ein einsetzbarer Gegenvorschlag fuer genau dieses Feld. */
  proposal: string;
  /**
   * Das zweite betroffene Feld, wenn Inhalte am falschen Platz stehen.
   *
   * Das ist der eine Befund, den ein Formular nicht darstellen kann und die
   * Karte schon: er wird zu einem Pfeil zwischen zwei Knoten.
   */
  relatedField?: OfferTextField;
};

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

/** Was jedes Feld sein SOLL -- knapp, damit das Modell nicht raten muss. */
const FIELD_PURPOSE: Record<OfferTextField, string> = {
  offering: "what they sell, in one sentence a stranger understands",
  icp: "the single kind of buyer, narrow enough to be recognisable",
  problem: "what the buyer suffers before buying, and what it costs over 90 days",
  friction:
    "ONE concrete, checkable moment where the buyer gets stuck, right before spending money. Not an opinion, not 'their website is outdated'",
  friction_reason:
    "the OBSERVABLE behaviour that explains why that moment causes hesitation. What a person DOES, not what a company gets wrong",
  outcome:
    "what is different for the reader afterwards, ideally a metric with a timeframe. NOT a past client result, that is proof",
  mechanism: "how the result comes about, in plain words, no tool names, no 'AI', no 'platform'",
  proof: "facts that back the claim: named clients, figures, years. A slogan is not proof",
  preview_asset:
    "the small concrete THING that gets sent after a yes, and that is built after the yes. A meeting is not a thing that gets sent",
  review_time: "how long looking at that thing takes, as a number plus a unit",
  cta: "ONE binary yes/no question, one line. Never a meeting, a call or a slot",
  tone: "how the mails should sound. Optional",
};

export function buildCoachPrompt(offer: Offer): string {
  const sprache = LANGUAGE_NAMES[offer.language] ?? "German";
  const lines: string[] = [
    "You are reviewing a cold outreach OFFER PROFILE before any email is written from it.",
    "You are not writing copy. You are checking whether each field actually answers its question.",
    "",
    "WHAT EACH FIELD IS FOR:",
    ...OFFER_TEXT_FIELDS.map((f) => `- ${f}: ${FIELD_PURPOSE[f]}`),
    "",
    "THE FILLED-IN OFFER:",
    ...OFFER_TEXT_FIELDS.map((f) => `${f}: ${offer[f].trim() || "(empty)"}`),
    "",
    "WHAT TO LOOK FOR, in this order of importance:",
    "1. CONTENT IN THE WRONG FIELD. A past client result sitting in 'outcome' belongs in 'proof'.",
    "   A meeting sitting in 'preview_asset' or 'review_time' is not a thing that gets sent.",
    "   When you find this, name the other field in relatedField.",
    "2. THE SAME ANSWER GIVEN TWICE in fields that ask different questions.",
    "3. A field that restates another field instead of adding something.",
    "4. An answer that is true but too broad to be checked by the reader.",
    "",
    "RULES THAT DECIDE WHETHER YOU SPEAK AT ALL:",
    // Drei Mal dasselbe, absichtlich: das ist die Regel, an der sich ein
    // hilfsbereites Modell am ehesten vorbeimogelt.
    "- SAY NOTHING about a field that does its job. A short answer is not a bad answer.",
    "- Do NOT polish wording. Only report a field that is WRONG, not one that could be prettier.",
    "- Returning an empty list is a perfectly good answer and happens often.",
    "- NEVER report an empty field. Empty is a decision the user has not made yet, not a mistake.",
    "- At most ONE finding per field. At most 5 findings in total, the most important ones.",
    "",
    "FOR EACH FINDING YOU MUST GIVE A USABLE REPLACEMENT:",
    `- verdict: one plain sentence in ${sprache}, saying what is wrong. No praise, no preamble.`,
    `- proposal: the text you would put in that field instead, in ${sprache}, ready to paste.`,
    "- You may ONLY rearrange, sharpen or shorten what the user already told you.",
    "  Never invent a number, a client, a result or a promise that is not in the offer above.",
    "- If the right answer is something only the user can know, say so in the verdict and make the",
    "  proposal a short question to themselves. Do not fabricate an answer.",
    '- severity: "blocker" if an email built on this field would be wrong. "weak" if it would just be weaker.',
    "",
    "Answer with JSON only, no prose around it:",
    '[{"field":"outcome","severity":"blocker","verdict":"...","proposal":"...","relatedField":"proof"}]',
    "An empty array [] is a valid answer.",
  ];
  return lines.join("\n");
}

/** Das erste JSON-Array im Text -- auch mit Vorrede oder Codeblock drumherum.
 *  Gleiche Begruendung wie in sequence-prompt.ts. */
function extractJsonArray(raw: string): string | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asField(v: unknown): OfferTextField | null {
  const s = asText(v);
  return (OFFER_TEXT_FIELDS as readonly string[]).includes(s) ? (s as OfferTextField) : null;
}

/** Hoechstens so viele Befunde. Mehr liest niemand, und ein Modell, das zehn
 *  findet, hat aufgehoert zu urteilen und angefangen aufzuzaehlen. */
const MAX_FINDINGS = 5;

/**
 * Die Antwort in Befunde verwandeln -- streng.
 *
 * Weggeworfen wird alles, was nicht handlungsfaehig ist: unbekannte Felder,
 * fehlendes Urteil, und vor allem ein fehlender Gegenvorschlag. "Das ist zu
 * vage" ohne einen besseren Satz daneben ist keine Hilfe, sondern eine
 * Hausaufgabe.
 *
 * Ausserdem hoechstens ein Befund je Feld: sonst stapeln sich drei Karten
 * unter einem Knoten und die Karte wird unlesbar.
 */
export function parseCoachFindings(raw: string, offer: Pick<Offer, OfferTextField>): CoachFinding[] {
  const json = extractJsonArray(raw);
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const gesehen = new Set<OfferTextField>();
  const out: CoachFinding[] = [];
  for (const item of parsed) {
    const o = item as Record<string, unknown>;
    const field = asField(o?.field);
    if (!field || gesehen.has(field)) continue;
    // Leere Felder meldet der Ring, nicht der Coach. Ein Befund an einem
    // leeren Feld waere die Aufforderung, etwas auszufuellen -- das weiss der
    // Nutzer selbst.
    if (!offer[field].trim()) continue;
    const verdict = asText(o?.verdict);
    const proposal = asText(o?.proposal);
    if (!verdict || !proposal) continue;
    const related = asField(o?.relatedField);
    gesehen.add(field);
    out.push({
      field,
      severity: asText(o?.severity) === "blocker" ? "blocker" : "weak",
      verdict,
      proposal,
      // Ein Verweis auf sich selbst waere ein Pfeil im Kreis.
      ...(related && related !== field ? { relatedField: related } : {}),
    });
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}
