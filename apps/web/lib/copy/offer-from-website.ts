/**
 * Aus einer Website Vorschlaege fuer die Angebotsfelder machen.
 *
 * WOFUER
 *
 * Sieben leere Felder sind fuer den Nutzer dasselbe leere Blatt, das der
 * Sequenzgenerator gerade abschaffen soll. Die meisten Antworten stehen aber
 * schon auf seiner eigenen Website; er muss sie nur bestaetigen statt
 * abtippen.
 *
 * DIE ENTSCHEIDENDE EINSCHRAENKUNG
 *
 * Was hier entsteht, sind VORSCHLAEGE, kein gespeichertes Angebot. Der Nutzer
 * uebernimmt jedes Feld einzeln. Grund: eine falsch gelesene Website vergiftet
 * danach jede erzeugte Mail, und zwar unsichtbar: der Fehler steht dann in
 * einem Feld, das niemand mehr liest, weil es ja "schon ausgefuellt" ist.
 *
 * Und dieselbe Regel wie ueberall sonst in diesem Bereich: was nicht auf der
 * Seite steht, bleibt leer. Das Modell wird ausdruecklich angewiesen, nichts
 * zu ergaenzen, vor allem keine Referenzen und keine Zahlen.
 */
import { OFFER_TEXT_FIELDS, type OfferTextField } from "@/lib/offers";
import type { WebsiteContent } from "@/lib/website-text";
// Nur der Typ, und deshalb unbedenklich, obwohl offer-products.ts umgekehrt
// zwei Funktionen von hier holt: ein `import type` steht nach dem Uebersetzen
// nicht mehr da, es entsteht also kein Ladekreis.
import type { OfferProduct } from "./offer-products";

export type OfferSuggestion = Partial<Record<OfferTextField, string>>;

/**
 * Fuenf Felder werden bewusst NICHT vorgeschlagen.
 *
 * Die Trennlinie ist nicht "schwer zu finden", sondern: steht es auf der
 * Seite, oder ist es eine Entscheidung? Eine Website ist ein Schaufenster.
 * Was jemand in einer kalten Mail versprechen und fragen will, steht dort
 * nicht. Ein Vorschlag waere geraten, und geraten heisst hier: es steht
 * danach etwas im Feld, das niemand entschieden hat.
 *
 *  - tone: wie jemand schreiben will, hat mit seinem Schaufenster nichts zu tun.
 *  - preview_asset, review_time: was er hergibt und wie lange das dauert,
 *    entscheidet er, nicht seine Seite.
 *  - friction_reason: eine Verhaltensbeobachtung. Genau die Sorte Satz, die
 *    ein Modell erfindet, wenn es sie nicht findet.
 *  - cta: DER wichtigste Ausschluss. Auf fast jeder Seite steht "Termin
 *    buchen" oder "Demo anfragen", und genau das ist der Micro-Yes NICHT.
 *    Solange dieses Feld hier mitlief, hat die Uebernahme dem Nutzer die
 *    Terminbitte ins Angebot geschrieben, gegen die das ganze Playbook
 *    geschrieben ist.
 */
const NICHT_VORSCHLAGEN: OfferTextField[] = [
  "tone",
  "preview_asset",
  "review_time",
  "friction_reason",
  "cta",
];

export const SUGGESTED_FIELDS: OfferTextField[] = OFFER_TEXT_FIELDS.filter(
  (f) => !NICHT_VORSCHLAGEN.includes(f)
);

/**
 * Der Auftrag ans Modell.
 *
 * `produkt` ist gesetzt, wenn die Seite mehr als eine Sache beschreibt und der
 * Nutzer gesagt hat, um welche es in DIESEM Angebot geht (siehe
 * offer-products.ts). Ohne den Wert ist der Prompt Wort fuer Wort der von
 * vorher: die eindeutige Seite ist der Normalfall und darf sich nicht
 * aendern. Gleiche Form wie in offer-from-search.ts: eine Regelzeile oben und
 * der Block direkt vor dem Material, das er einschraenkt.
 */
export function buildOfferPrompt(
  content: WebsiteContent,
  language: "de" | "en",
  produkt?: OfferProduct | null
): string {
  const sprache = language === "en" ? "English" : "German";
  return [
    "You read a company website and fill in a short profile of what this company SELLS.",
    "This profile is later used to write cold outreach emails on their behalf.",
    "",
    "RULES:",
    "- Only use what is actually on the page. Never add industry knowledge of your own.",
    // Der Satz steht doppelt, hier als Regel und unten am Produkt selbst.
    // Was hier als ein Punkt zwischen acht anderen steht, wird sonst
    // mitueberlesen.
    produkt
      ? "- This company sells more than one thing. This profile is about exactly ONE of them, named below." +
        " Write about that one only and ignore the rest of the page."
      : "",
    // Der wichtigste Satz. Eine erfundene Referenz landet sonst in jeder
    // spaeter erzeugten Mail und faellt erst dem Empfaenger auf.
    "- If the page does not say something, return an empty string for that field. Never guess.",
    "- 'proof' may ONLY contain numbers, names or results that literally appear on the page.",
    "- 'problem' is what the CUSTOMER struggles with before buying, not what the company offers.",
    "- One or two plain sentences per field. No marketing language, no bullet points.",
    `- Write the values in ${sprache}.`,
    "",
    "FIELDS:",
    "- offering: what they sell, in one sentence",
    "- icp: who they sell to (industry, size, role)",
    "- problem: what the customer struggles with beforehand",
    // Die Friction ist der einzige der neuen Werte, der ueberhaupt auf einer
    // Verkaeuferseite stehen KANN, naemlich dort, wo sie das Problem ihrer
    // Kunden beschreibt. Die Anweisung ist deshalb streng: ein konkreter
    // Moment oder gar nichts. Ein allgemeiner Satz an dieser Stelle waere
    // schlimmer als ein leeres Feld, weil er sich ausgefuellt anfuehlt.
    "- friction: ONE concrete, checkable moment where that customer gets stuck, if the page names one.",
    "  It must be something a person could go and look at. If the page only talks in general terms, return an empty string.",
    "- outcome: what is different afterwards, with a number if the page names one",
    // Der Mechanismus steht fast immer auf der Seite, meist in
    // Werkzeugsprache. Genau die soll hier herausfallen.
    "- mechanism: how the result actually comes about, in plain words.",
    "  Never use the words AI, agent, LLM, API, platform, software, automation or any product name.",
    "- proof: references, results, figures, years in business, named clients",
    "",
    "Answer with JSON only:",
    '{"offering":"...","icp":"...","problem":"...","friction":"...","outcome":"...","mechanism":"...","proof":"..."}',
    "",
    // Der Block steht DIREKT vor der Seite und nicht bei den Regeln oben: er
    // schraenkt ein, was gleich darunter zu lesen ist, und eine
    // Einschraenkung gehoert unmittelbar vor das, was sie einschraenkt.
    produkt ? "THE ONE PRODUCT OR SERVICE THIS PROFILE IS ABOUT:" : "",
    produkt ? `Name: ${produkt.name}` : "",
    produkt && produkt.description ? `What it is: ${produkt.description}` : "",
    produkt
      ? "The page below also describes their other products or services. Every field you fill in --"
      : "",
    produkt
      ? "offering, icp, problem, friction, outcome, mechanism, proof -- is about THIS one only."
      : "",
    produkt ? "Do not mention the others and do not blend them in." : "",
    "",
    "THE PAGE:",
    content.title ? `Title: ${content.title}` : "",
    content.description ? `Description: ${content.description}` : "",
    "",
    content.text,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Das erste JSON-Objekt im Text, auch mit Vorrede oder Codeblock drumherum.
 *  Exportiert, weil offer-products.ts dieselbe Antwortform bekommt (JSON,
 *  gelegentlich mit Vorrede); eine zweite Kopie waere eine zweite Stelle, an
 *  der ein Codeblock nicht erkannt wird. */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * Die Antwort des Modells in Feldvorschlaege verwandeln.
 *
 * Streng in eine Richtung: unbekannte Schluessel fliegen raus, alles ausserhalb
 * von `erlaubt` wird ignoriert, und ein Feld, das das Modell mit einer Ausrede
 * gefuellt hat ("nicht angegeben", "unknown"), gilt als leer. Genau solche
 * Saetze landen sonst als Tatsachenbehauptung im naechsten Prompt.
 *
 * Die erlaubten Felder kommen als Parameter, weil es zwei Quellen gibt: die
 * eigene Website (SUGGESTED_FIELDS) und eine einzelne Lead-Liste
 * (offer-from-search.ts). Beide brauchen dieselbe Strenge; eine zweite Kopie
 * dieser Funktion waere eine zweite Ausreden-Liste, die auseinanderlaufen kann.
 */
export function parseSuggestionFields(raw: string, erlaubt: OfferTextField[]): OfferSuggestion {
  const json = extractJsonObject(raw);
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const obj = parsed as Record<string, unknown>;
  const out: OfferSuggestion = {};
  for (const field of erlaubt) {
    const value = obj[field];
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (!clean || istAusrede(clean)) continue;
    out[field] = clean;
  }
  return out;
}

/** Die Vorschlaege aus der eigenen Website, ohne die fuenf Felder, die eine
 *  Entscheidung sind und nicht auf einer Seite stehen (siehe
 *  NICHT_VORSCHLAGEN). */
export function parseOfferSuggestion(raw: string): OfferSuggestion {
  return parseSuggestionFields(raw, SUGGESTED_FIELDS);
}

/**
 * "Nicht angegeben", "n/a", "unbekannt": die Standardausreden.
 *
 * Ohne diese Pruefung steht spaeter woertlich "Keine Angabe auf der Website"
 * im Feld `proof`, und der Sequenzgenerator liest das als Beleg, den er
 * erwaehnen darf.
 *
 * Exportiert aus demselben Grund wie extractJsonObject: die Produkterkennung
 * (offer-products.ts) bekommt Produktnamen zurueck, und "nicht angegeben" ist
 * dort genauso wenig ein Name wie hier ein Beleg.
 */
export function istAusrede(value: string): boolean {
  const v = value.toLowerCase().replace(/[.!]/g, "").trim();
  if (v.length > 60) return false;
  return /^(n\/?a|keine? angaben?|nicht angegeben|nicht (ersichtlich|genannt|erkennbar|vorhanden)|unbekannt|unknown|not (specified|stated|mentioned|available)|none|kein[e]? .{0,30}(gefunden|genannt|angegeben))$/.test(
    v
  );
}
