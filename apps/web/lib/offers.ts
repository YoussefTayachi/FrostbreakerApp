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

/** Die inhaltlichen Felder -- die, die in den Prompt wandern. */
export const OFFER_TEXT_FIELDS = [
  "offering",
  "icp",
  "problem",
  "outcome",
  "proof",
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
  outcome: string;
  proof: string;
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
  "id, name, offering, icp, problem, outcome, proof, cta, tone, address_form, language, website, signature, is_default";

export function emptyOffer(name: string, language: OfferLanguage = "de"): Omit<Offer, "id" | "is_default"> {
  return {
    name,
    offering: "",
    icp: "",
    problem: "",
    outcome: "",
    proof: "",
    cta: "",
    tone: "",
    address_form: "du",
    language,
    website: null,
    signature: "",
  };
}

/**
 * Die vier Felder, ohne die keine brauchbare Mail entstehen kann.
 *
 * Bewusst NICHT als Datenbank-Zwang (dort haben alle Felder Default ''):
 * ein halb ausgefuelltes Angebot muss speicherbar sein, sonst geht die
 * angefangene Arbeit beim Wegklicken verloren. Der Zwang greift erst dort,
 * wo er hingehoert -- am Knopf "Sequenz erzeugen".
 *
 * `proof` steht ausdruecklich NICHT in dieser Liste. Wer keine Referenzen
 * hat, soll trotzdem schreiben duerfen; der Prompt macht daraus dann ein
 * Verbot, welche zu erfinden.
 */
export const REQUIRED_FOR_GENERATION: OfferTextField[] = ["offering", "icp", "problem", "outcome"];

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
