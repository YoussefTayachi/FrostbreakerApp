/**
 * Verkauft der Absender EINE Sache oder mehrere?
 *
 * WOFUER
 *
 * Das Feld `offering` ist Freitext ("was verkaufst du"), und manche Firmen
 * verkaufen darin mehr als eine Sache: ein Betrieb mit einer
 * WhatsApp-Marketing-App UND einer App fuer Support-Automatisierung schreibt
 * beide hinein. Der Zuschnitt auf eine Lead-Liste
 * (lib/copy/offer-from-search.ts) hat bis dahin das ganze Feld als EINE Sache
 * gelesen -- und aus zwei Produkten einen Mischsatz gemacht, der auf keines
 * von beiden passt.
 *
 * Deshalb ein eigener, kleiner Aufruf VOR dem teuren: er beantwortet nur die
 * eine Frage, und die Antwort entscheidet, ob der Nutzer vorher gefragt wird.
 *
 * WARUM EIN EIGENER AUFRUF UND KEIN ZUSATZFELD IM GROSSEN PROMPT
 *
 * Die Oberflaeche muss auf "mehrere gefunden" reagieren, BEVOR der teure
 * Aufruf laeuft -- sonst waere die Nachfrage eine Rueckfrage zu einem Ergebnis,
 * das schon bezahlt ist. Ein Aufruf mit rund 200 Tokens Eingabe kostet einen
 * Bruchteil eines Cents; ein verworfener Zuschnitt kostet den ganzen zweiten.
 *
 * DIE ENTSCHEIDENDE EINSCHRAENKUNG
 *
 * Dieselbe wie ueberall in diesem Bereich: nur was im Text steht. Und hier in
 * einer Richtung streng -- im Zweifel EINE Sache. Ein Angebot faelschlich zu
 * teilen ist der teurere Fehler: der Nutzer waehlt dann eine "Haelfte", die es
 * gar nicht gibt, und der Zuschnitt schreibt ueber ein Produkt, das niemand
 * verkauft. Wird eine echte zweite Sache uebersehen, bleibt alles so, wie es
 * vorher war.
 */
import { extractJsonObject, istAusrede } from "./offer-from-website";

/** Eine Sache, die der Absender verkauft. `description` darf leer sein -- der
 *  Freitext-Ausweg in der Oberflaeche liefert nur einen Namen. */
export type OfferProduct = { name: string; description: string };

/**
 * Obergrenzen.
 *
 * MAX_PRODUCTS ist eine Anzeigegrenze, keine fachliche: die Auswahl steht in
 * einer Karte im Formular, und wer mehr als sechs Dinge verkauft, waehlt
 * schneller ueber das Freitextfeld daneben als aus einer Liste zum Scrollen.
 * Die Laengen schneiden nur die Ausreisser -- ein "Name" mit 200 Zeichen ist
 * kein Name, sondern ein abgeschriebener Absatz.
 */
export const MAX_PRODUCTS = 6;
export const PRODUCT_NAME_MAX = 60;
export const PRODUCT_DESC_MAX = 140;

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

/**
 * Der Auftrag ans Modell.
 *
 * Englisch wie alle anderen Prompts dieser App (Formvorgaben befolgt das
 * Modell in Englisch verlaesslicher); die Sprache der Beschreibungen kommt aus
 * dem Angebot.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WO DIE GRENZE LIEGT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Die Pruefung ist nicht "stehen mehrere Substantive da", sondern: koennte
 * jemand das eine kaufen OHNE das andere, und benennt der Text es als eigene
 * Sache? Ein einzelnes Produkt wird fast immer mit mehreren Vorteilen,
 * Bausteinen, Schritten, Paketen und Zielgruppen beschrieben -- das ist der
 * Normalfall eines gut ausgefuellten Feldes und ausdruecklich KEIN zweites
 * Produkt. Ohne diesen Satz zerlegt das Modell jede Feature-Aufzaehlung.
 *
 * Ebenso ausdruecklich: die Zielgruppe darf nie der Grund fuer eine Teilung
 * sein. Dieselbe Sache an zwei Branchen zu verkaufen ist genau der Fall, fuer
 * den es den Listen-Zuschnitt ueberhaupt gibt.
 */
export function buildProductDetectPrompt(
  offering: string,
  icp: string,
  language: "de" | "en"
): string {
  const sprache = LANGUAGE_NAMES[language] ?? "German";
  const zeilen: (string | null)[] = [
    "You are reading how a sender describes what their business sells.",
    "Your ONLY job: decide whether this describes ONE product or service, or SEVERAL DISTINCT ones.",
    "",
    "RULES:",
    "- Only use the text below. Never add knowledge of your own about this company or its market.",
    "- The test for 'distinct': a buyer could buy one of them WITHOUT the other, and the text actually",
    "  names it or clearly describes it as a separate thing.",
    // Der wichtigste Satz. Ohne ihn wird jede Feature-Aufzaehlung zu einem
    // Produktkatalog -- und genau so ist ein gut ausgefuelltes Feld gebaut.
    "- Several features, benefits, steps, modules, packages or price tiers of ONE thing are NOT several",
    "  products. This is the mistake to avoid: almost every offer lists more than one benefit.",
    "- A service and the tool it is delivered with are ONE thing. So are a product and its onboarding,",
    "  support or setup.",
    // Zwei Branchen sind zwei Listen, nicht zwei Produkte -- und Listen sind
    // genau das, wofuer es den Zuschnitt gibt.
    "- Selling the same thing to two audiences or industries is NOT two products.",
    "- Never invent a name. If a distinct thing is described but not named, use two or three words from",
    "  the text itself.",
    "- If you are unsure, answer with one. One is the safe answer: splitting a single offer in two makes",
    "  the sender write about something they do not sell.",
    `- Write the descriptions in ${sprache}. Spell the names exactly as the text spells them.`,
    "- description: one short phrase saying what that one thing does. No marketing language.",
    "",
    "Answer with JSON only, no prose around it.",
    "If it is one thing:",
    '{"multiple":false,"products":[]}',
    "If there really are several:",
    '{"multiple":true,"products":[{"name":"...","description":"..."},{"name":"...","description":"..."}]}',
    "",
    "WHAT THEY SELL:",
    offering.trim(),
  ];
  const zielgruppe = icp.trim();
  if (zielgruppe) {
    zeilen.push(
      "",
      "WHO THEY SELL TO (background only -- never a reason to split):",
      zielgruppe
    );
  }
  return zeilen.filter((z): z is string => z !== null).join("\n");
}

/**
 * Die Antwort des Modells.
 *
 * Eine LEERE Liste heisst "eindeutig, weitermachen wie bisher" -- und sie ist
 * die Antwort auf jeden Zweifelsfall: kaputtes JSON, fehlendes Feld, `multiple`
 * ohne Produkte, oder nur EIN Produkt in der Liste. Der letzte Fall ist der
 * wichtigste: ein Modell, das "multiple" sagt und dann eine einzige Sache
 * aufzaehlt, hat die Frage nicht beantwortet, sondern das Feld wiederholt --
 * dafuer den Nutzer zu fragen waere eine Auswahl ohne Wahl.
 */
export function parseProductDetection(raw: string): OfferProduct[] {
  const json = extractJsonObject(raw);
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

  const obj = parsed as { multiple?: unknown; products?: unknown };
  if (obj.multiple !== true) return [];
  if (!Array.isArray(obj.products)) return [];

  const out: OfferProduct[] = [];
  const gesehen = new Set<string>();
  for (const eintrag of obj.products) {
    if (!eintrag || typeof eintrag !== "object") continue;
    const e = eintrag as { name?: unknown; description?: unknown };
    if (typeof e.name !== "string") continue;
    const name = e.name.trim().slice(0, PRODUCT_NAME_MAX);
    if (!name || istAusrede(name)) continue;
    // Zweimal derselbe Name waere in der Auswahl zweimal derselbe Knopf.
    const schluessel = name.toLowerCase();
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    const beschreibung = typeof e.description === "string" ? e.description.trim() : "";
    out.push({
      name,
      description: istAusrede(beschreibung) ? "" : beschreibung.slice(0, PRODUCT_DESC_MAX),
    });
    if (out.length === MAX_PRODUCTS) break;
  }
  return out.length >= 2 ? out : [];
}

/**
 * Ein Produkt aus einem fremden Eingang (Anfragekoerper) auf das Format
 * bringen, das in den Prompt darf.
 *
 * Steht hier und nicht in der Route, weil derselbe Schnitt fuer beide Wege
 * gilt: die erkannten Vorschlaege UND der Freitext, den der Nutzer eintippt,
 * wenn keiner davon passt.
 */
export function cleanProduct(value: unknown): OfferProduct | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { name?: unknown; description?: unknown };
  const name = typeof v.name === "string" ? v.name.trim().slice(0, PRODUCT_NAME_MAX) : "";
  if (!name) return null;
  const description =
    typeof v.description === "string" ? v.description.trim().slice(0, PRODUCT_DESC_MAX) : "";
  return { name, description };
}
