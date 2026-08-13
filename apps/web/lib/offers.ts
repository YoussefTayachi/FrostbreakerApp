/**
 * Das Angebot -- was der Workspace verkauft.
 *
 * Der Datentyp zu Migration 0090. Reine Typen und reine Funktionen, damit
 * Server-Route, Client-Formular und Prompt-Bau dieselbe Vorstellung von einem
 * Angebot haben und niemand ein zweites Mal aufschreibt, welche Felder es
 * gibt.
 *
 * Die zentrale Regel steht in `filledFields`/`missingFields`: ein leeres Feld
 * ist kein Fehler, sondern eine Aussage. Es fuehrt spaeter im Prompt zu einer
 * ausdruecklichen Anweisung, an dieser Stelle NICHTS zu behaupten (siehe
 * lib/copy/sequence-prompt.ts). Deshalb wird hier nirgends etwas
 * "vervollstaendigt" oder mit einem Platzhalter gefuellt.
 */

export type AddressForm = "du" | "sie";
export type OfferLanguage = "de" | "en";

/**
 * Die inhaltlichen Felder -- die, die in den Prompt wandern.
 *
 * Die Reihenfolge ist nicht beliebig: sie folgt dem Aufbau der ersten Mail
 * und damit der Reihenfolge, in der ein Mensch die Fragen beantworten kann.
 * Wer weiss, was er verkauft und an wen, kann danach das Problem benennen;
 * wer das Problem hat, findet den Stolperstein. Umgekehrt geht es nicht.
 *
 * friction/friction_reason/preview_asset/review_time kommen aus dem Playbook
 * (Migration 0093): im Kurs sind das Recherchewerte PRO LEAD, hier stehen sie
 * am Angebot, weil sie sich innerhalb einer Nische nicht aendern.
 */
export const OFFER_TEXT_FIELDS = [
  "offering",
  "icp",
  "problem",
  "friction",
  "friction_reason",
  "outcome",
  "mechanism",
  "proof",
  "preview_asset",
  "review_time",
  "cta",
  "tone",
] as const;

export type OfferTextField = (typeof OFFER_TEXT_FIELDS)[number];

export type Offer = {
  id: string;
  name: string;
  offering: string;
  icp: string;
  problem: string;
  /** Der eine Stolperstein der Nische, kurz vor dem Geld. */
  friction: string;
  /** Warum dieser Stolperstein Kaeufer zoegern laesst -- beobachtetes
   *  Verhalten, keine Theorie. */
  friction_reason: string;
  outcome: string;
  /** Wie das Ergebnis entsteht, ohne Tool-Sprache. Nicht fuer Mail 1. */
  mechanism: string;
  proof: string;
  /** Was der Empfaenger bekommt, wenn er Ja sagt. */
  preview_asset: string;
  /** Wie lange das Ansehen dauert. Exakt, sonst leer. */
  review_time: string;
  /** Der Micro-Yes: eine einzige binaere Ja/Nein-Frage. */
  cta: string;
  tone: string;
  address_form: AddressForm;
  language: OfferLanguage;
  website: string | null;
  /** Gruss und Unterschrift, mehrzeilig. Leer = Rueckfall auf
   *  workspaces.reply_sender_name; ist auch das leer, endet die Mail ohne
   *  Unterschrift statt mit einem erfundenen Namen (Migration 0091). */
  signature: string;
  is_default: boolean;
};

/** Was aus der Datenbank gelesen wird. Ein Literal, kein Zusammenbau: Supabase
 *  leitet die Feldtypen aus dem String ab und faellt sonst auf
 *  GenericStringError zurueck (dieselbe Falle wie in app/ai-agent/page.tsx). */
export const OFFER_COLUMNS =
  "id, name, offering, icp, problem, friction, friction_reason, outcome, mechanism, proof, preview_asset, review_time, cta, tone, address_form, language, website, signature, is_default";

export function emptyOffer(name: string, language: OfferLanguage = "de"): Omit<Offer, "id" | "is_default"> {
  return {
    name,
    offering: "",
    icp: "",
    problem: "",
    friction: "",
    friction_reason: "",
    outcome: "",
    mechanism: "",
    proof: "",
    preview_asset: "",
    review_time: "",
    cta: "",
    tone: "",
    address_form: "du",
    language,
    website: null,
    signature: "",
  };
}

/**
 * Die sechs Felder, ohne die keine brauchbare Mail entstehen kann.
 *
 * Bewusst NICHT als Datenbank-Zwang (dort haben alle Felder Default ''):
 * ein halb ausgefuelltes Angebot muss speicherbar sein, sonst geht die
 * angefangene Arbeit beim Wegklicken verloren. Der Zwang greift erst dort,
 * wo er hingehoert -- am Knopf "Sequenz erzeugen".
 *
 * `friction` und `cta` sind mit dem Playbook dazugekommen, und beide zu Recht:
 * die Friction traegt die Beobachtung, mit der die Mail anfaengt, und der
 * Micro-Yes ist die Entscheidung, um die es geht. Ohne sie erzeugt der
 * Generator genau die allgemeine Mail, gegen die das ganze Playbook
 * geschrieben ist -- er koennte es gar nicht anders.
 *
 * `proof` steht ausdruecklich NICHT in dieser Liste, und `preview_asset` /
 * `review_time` auch nicht. Wer nichts vorzuweisen hat, soll trotzdem
 * schreiben duerfen; der Prompt macht aus jedem leeren Feld ein Verbot, an
 * dieser Stelle etwas zu behaupten.
 */
export const REQUIRED_FOR_GENERATION: OfferTextField[] = [
  "offering",
  "icp",
  "problem",
  "friction",
  "outcome",
  "cta",
];

/**
 * Die vier Abschnitte, in denen die zwoelf Felder abgefragt werden.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM GRUPPEN UND KEINE LISTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Sieben Felder waren eine Liste, zwoelf sind eine Wand. Am Bild geprueft:
 * man scrollt an Feld vier vorbei und weiss nicht mehr, worauf das Ganze
 * hinauslaeuft.
 *
 * Die Gruppen sind nicht erfunden, sie sind der Aufbau der ersten Mail: wer
 * schreibt an wen, woran bleibt der Leser haengen, was hat er davon, worum
 * wird er gebeten. Damit beantwortet der Abschnittsname schon die Frage,
 * warum die Felder darin ueberhaupt zusammengehoeren -- und man kann drei
 * davon zuklappen, ohne den Faden zu verlieren.
 */
export const OFFER_STAGES = [
  // Der Ton steht beim Absender, nicht beim Ask: er beschreibt, WIE jemand
  // schreibt, nicht worum er bittet. Auf der Karte war er in der Ask-Spalte
  // ein Fremdkoerper zwischen Preview, Pruefzeit und Frage.
  { id: "who", fields: ["offering", "icp", "tone"] },
  { id: "hook", fields: ["problem", "friction", "friction_reason"] },
  { id: "value", fields: ["outcome", "mechanism", "proof"] },
  { id: "ask", fields: ["preview_asset", "review_time", "cta"] },
] as const satisfies readonly { id: string; fields: readonly OfferTextField[] }[];

export type OfferStageId = (typeof OFFER_STAGES)[number]["id"];

/** Die Nummer eines Feldes im Formular -- ueber alle Abschnitte durchgezaehlt,
 *  damit die Zaehlung beim Zuklappen nicht springt. */
export function fieldNumber(field: OfferTextField): number {
  return OFFER_TEXT_FIELDS.indexOf(field) + 1;
}

export function missingForGeneration(offer: Pick<Offer, OfferTextField>): OfferTextField[] {
  return REQUIRED_FOR_GENERATION.filter((f) => !offer[f].trim());
}

export function canGenerate(offer: Pick<Offer, OfferTextField>): boolean {
  return missingForGeneration(offer).length === 0;
}

/**
 * Wie vollstaendig das Angebot ist, in Prozent -- ueber ALLE sieben Felder.
 *
 * Nur fuer die Anzeige. Eine Zahl daneben beantwortet die Frage "reicht das
 * jetzt?" besser als sieben Haken, und sie macht sichtbar, dass die drei
 * optionalen Felder etwas beitragen, ohne Pflicht zu sein.
 */
export function completeness(offer: Pick<Offer, OfferTextField>): number {
  const gefuellt = OFFER_TEXT_FIELDS.filter((f) => offer[f].trim().length > 0).length;
  return Math.round((gefuellt / OFFER_TEXT_FIELDS.length) * 100);
}
