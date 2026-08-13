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
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WO DIESE STRENGE ZU WEIT GING (gemeldet 2026-08-13)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * "Egal wie oft ich Angebot pruefen klicke und alles so eingebe, wie er es
 * vorschlaegt -- es ist nie fertig."
 *
 * In der Datenbank nachgesehen: von zwoelf Feldern war genau EINES leer, und
 * zwar `cta` -- ein Pflichtfeld. Prompt und Parser schwiegen zu leeren Feldern
 * ausnahmslos ("Empty is a decision the user has not made yet"). Damit konnte
 * der Coach zu dem einen Feld, das das Angebot blockierte, strukturell nie
 * etwas sagen. Wer jedem Vorschlag folgte, kam trotzdem nie an.
 *
 * Die Regel ist deshalb geteilt, nicht gestrichen:
 *
 *   leeres OPTIONALES Feld  -> weiter Schweigen. Es ist eine Entscheidung.
 *   leeres PFLICHTFELD      -> ein fertiger Formulierungsvorschlag, hergeleitet
 *                              aus den Feldern, die schon dastehen.
 *
 * "Nichts erfinden" wiegt dabei weiterhin schwerer als Vollstaendigkeit: eine
 * Frage zu formulieren erfindet keine Tatsache, eine Referenz zu behaupten
 * schon. Deshalb wirft der Parser einen Entwurf fuer ein leeres Feld weg,
 * sobald darin eine Zahl steht, die nirgends im Angebot vorkommt.
 */
import type { Offer, OfferTextField } from "@/lib/offers";
import { OFFER_TEXT_FIELDS, missingForGeneration } from "@/lib/offers";

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
  // Die leeren PFLICHTfelder -- dieselbe Liste, an der auch der Knopf "Sequenz
  // erzeugen" haengt (lib/offers.ts). Nur zu diesen darf der Coach etwas
  // schreiben, das noch gar nicht dasteht.
  const fehlend = missingForGeneration(offer);
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
    // Geteilt seit dem 2026-08-13, Begruendung im Kopf dieser Datei: das
    // Schweigen zu leeren Feldern liess genau die Felder unbeantwortet, an
    // denen das Angebot haengenblieb.
    "- NEVER report an empty OPTIONAL field. Empty is a decision the user has not made yet, not a mistake.",
    "- At most ONE finding per field. At most 5 findings in total, the most important ones.",
  ];

  if (fehlend.length > 0) {
    lines.push(
      "",
      "EXCEPT FOR THESE. THEY ARE EMPTY AND REQUIRED, SO WRITE THEM:",
      `- ${fehlend.join(", ")}. No email can be built until they say something.`,
      "- Report each of them, and make the proposal the FINISHED TEXT for that field, ready to paste.",
      "  Not advice, not a question to the user, not 'think about what you send'. The sentence itself.",
      "- Build it out of the fields that ARE filled in above. Nothing else exists.",
      "- INVENT NOTHING while doing so: no number, no client, no result, no promise that is not above.",
      "  Phrasing a question invents no fact. Claiming a reference does. If the filled fields tell you",
      "  too little to write the field honestly, say nothing about it at all.",
      // Der gemeldete Fall: cta war das einzige leere Feld. Ein Micro-Yes, der
      // nicht zu Preview und Pruefzeit passt, waere ein zweites Angebot.
      "- For 'cta': one binary yes/no question, one line, matching exactly what they send after a yes",
      "  (preview_asset) and how long it takes to look at (review_time). Never a meeting, a call or a slot.",
      "- The verdict names what the field has to answer. Do not just say that it is empty, they can see that.",
      "- These come FIRST in your answer, before any finding about a field that is already filled in."
    );
  }

  lines.push(
    "",
    "FOR EACH FINDING YOU MUST GIVE A USABLE REPLACEMENT:",
    `- verdict: one plain sentence in ${sprache}, saying what is wrong. No praise, no preamble.`,
    `- proposal: the text you would put in that field instead, in ${sprache}, ready to paste.`,
    "- You may ONLY rearrange, sharpen or shorten what the user already told you.",
    "  Never invent a number, a client, a result or a promise that is not in the offer above.",
    "- If the right answer is something only the user can know, say so in the verdict and make the",
    "  proposal a short question to themselves. Do not fabricate an answer.",
    // Ohne diese Einschraenkung stehen zwei Anweisungen gegeneinander: die
    // Rueckfrage an sich selbst waere fuer ein leeres Pflichtfeld genau das,
    // was der Nutzer gemeldet hat -- ein Vorschlag, der das Feld nicht fuellt.
    "  That last rule is for fields that ALREADY contain something. For an empty required field you",
    "  either write the field or you say nothing about it.",
    '- severity: "blocker" if an email built on this field would be wrong. "weak" if it would just be weaker.',
    "",
    "Answer with JSON only, no prose around it:",
    '[{"field":"outcome","severity":"blocker","verdict":"...","proposal":"...","relatedField":"proof"}]',
    "An empty array [] is a valid answer."
  );
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
 * Enthaelt der Entwurf eine Zahl, die im Angebot nirgends vorkommt?
 *
 * Nur fuer Vorschlaege zu LEEREN Feldern gedacht. Dort schreibt das Modell
 * einen Satz aus dem Nichts, und genau dabei entsteht die "over 200 happy
 * clients" -- dieselbe Gefahr, gegen die in sequence-prompt.ts der leere
 * proof-Fall steht.
 *
 * Verglichen werden ganze Ziffernfolgen, nicht Teilstrings: sonst rutschte
 * eine "1" durch, nur weil im Angebot irgendwo "17" steht. Ausgeschriebene
 * Zahlen ("zwei Minuten") faengt das nicht -- eine bekannte Luecke, aber die
 * teuren Erfindungen sind Prozente und Kundenzahlen, und die stehen als
 * Ziffern da.
 */
function hasInventedNumber(proposal: string, offer: Pick<Offer, OfferTextField>): boolean {
  const imAngebot = new Set(OFFER_TEXT_FIELDS.map((f) => offer[f]).join(" ").match(/\d+/g) ?? []);
  return (proposal.match(/\d+/g) ?? []).some((n) => !imAngebot.has(n));
}

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

  const fehlendePflicht = new Set(missingForGeneration(offer));
  const gesehen = new Set<OfferTextField>();
  const out: CoachFinding[] = [];
  for (const item of parsed) {
    const o = item as Record<string, unknown>;
    const field = asField(o?.field);
    if (!field || gesehen.has(field)) continue;
    const leer = !offer[field].trim();
    // Ein leeres OPTIONALES Feld ist eine Entscheidung, kein Fehler -- dazu
    // schweigt der Coach weiter. Ein leeres PFLICHTfeld dagegen ist der Grund,
    // warum das Angebot nicht fertig wird; dort ist ein fertiger Satz das
    // Nuetzlichste, was er liefern kann (gemeldet 2026-08-13).
    if (leer && !fehlendePflicht.has(field)) continue;
    const verdict = asText(o?.verdict);
    const proposal = asText(o?.proposal);
    if (!verdict || !proposal) continue;
    // Lieber die Luecke behalten als eine erfundene Zahl einsetzen: der
    // Vorschlag sieht fertig aus, und was darin steht, prueft danach niemand
    // mehr nach.
    if (leer && hasInventedNumber(proposal, offer)) continue;
    const related = asField(o?.relatedField);
    gesehen.add(field);
    out.push({
      field,
      // Ein leeres Pflichtfeld ist immer ein Blocker, egal wie das Modell es
      // einstuft: ohne dieses Feld entsteht gar keine Mail.
      severity: leer || asText(o?.severity) === "blocker" ? "blocker" : "weak",
      verdict,
      proposal,
      // Ein Verweis auf sich selbst waere ein Pfeil im Kreis.
      ...(related && related !== field ? { relatedField: related } : {}),
    });
  }
  // Erst sortieren, dann kappen. Andersherum verschwaende ein fehlendes
  // Pflichtfeld hinter fuenf Stilhinweisen -- und genau das eine Feld, das das
  // Angebot blockiert, waere unsichtbar. Array.sort ist stabil, die Reihenfolge
  // des Modells bleibt innerhalb der beiden Gruppen erhalten.
  out.sort((a, b) => Number(!fehlendePflicht.has(a.field)) - Number(!fehlendePflicht.has(b.field)));
  return out.slice(0, MAX_FINDINGS);
}
