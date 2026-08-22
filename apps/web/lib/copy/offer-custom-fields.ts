/**
 * Eigene, frei definierbare Angebotsfelder.
 *
 * WOFUER
 *
 * Die zwoelf festen Felder (lib/offers.ts) sind das Playbook: jedes traegt
 * eine benannte Rolle in der Mail-Architektur. Was ihnen fehlt, ist Platz fuer
 * das, was ein bestimmter Absender ausserdem im Kopf hat und in SEINEN Worten
 * nennt: "Risk Reversal", "ungefaehre Verluste wegen des Pain Points",
 * "Integrationsdauer".
 *
 * Diese Felder kommen deshalb ZUSAETZLICH, nie ersetzend (Migration 0098).
 * Die Definitionen haengen am Workspace, die Werte am Angebot
 * (offers.custom_fields).
 *
 * DIESE DATEI IST DER EINE ORT, AN DEM AUS DEFINITIONEN PROMPT-ZEILEN WERDEN
 *
 * Rein und ohne Datenbank, damit sich jede Regel testen laesst: was Core
 * fragen darf, was Aim fragen darf, was aus einer Modellantwort uebrig bleibt
 * und wie ein leeres eigenes Feld sich verhaelt.
 *
 * ZUM LADEKREIS MIT offer-from-website.ts
 *
 * Von dort kommen extractJsonObject und istAusrede, und dorthin geht
 * customFieldPromptBlock. Das ist ein echter Kreis, aber ein harmloser: beide
 * Seiten benutzen voneinander nur Funktionsdeklarationen, und zwar erst zur
 * Laufzeit. Waehrend die Module ausgewertet werden, ruft keine Seite etwas von
 * der anderen auf. Eine zweite Kopie der Ausreden-Liste waere die teurere
 * Loesung: zwei Listen, die auseinanderlaufen.
 */
import { extractJsonObject, istAusrede } from "./offer-from-website";

/**
 * Aus welchem Material ein eigenes Feld gefuellt wird.
 *
 * Das ist keine Bequemlichkeit, sondern dieselbe Trennlinie, die
 * SEARCH_SUGGESTED_FIELDS in offer-from-search.ts sorgfaeltig zieht: Core
 * liest die Verkaeuferseite (was DU verkaufst), Aim liest die recherchierten
 * Firmenbeschreibungen (an WEN). Wer beides aus derselben Quelle zieht,
 * bekommt erfundene Werte.
 */
export type FieldFillFrom = "core" | "aim" | "both" | "manual";

/** Was der Prompt von einem eigenen Feld wissen muss. */
export type OfferFieldDef = {
  /** Der Schluessel in offers.custom_fields. Unveraenderlich. */
  key: string;
  /** Wie der Nutzer das Feld nennt. Darf jederzeit umbenannt werden. */
  label: string;
  /** Die Anweisung ans Modell. Der eigentliche Hebel. */
  instruction: string;
  fill_from: FieldFillFrom;
};

/** Die Zeile, wie sie aus offer_field_defs kommt. */
export type OfferFieldDefRow = OfferFieldDef & { id: string; sort_order: number };

/** Die Werte am Angebot: Schluessel = OfferFieldDef.key. */
export type CustomFieldValues = Record<string, string>;

/**
 * Hoechstens acht eigene Felder je Workspace.
 *
 * Zwei Gruende, beide praktisch: jedes Feld verlaengert JEDEN Prompt (Core,
 * Aim, Sequenz, LinkedIn) um eine Anweisungszeile, und ein Formular mit
 * zwanzig Zusatzfeldern ist wieder das leere Blatt, gegen das dieser ganze
 * Bereich gebaut ist. Wer mehr als acht braucht, hat kein Feldproblem,
 * sondern ein Angebotsproblem: dann sind es zwei Angebote.
 */
export const MAX_CUSTOM_FIELDS = 8;

/** Laengen. Sie schneiden nur die Ausreisser: ein "Label" mit 200 Zeichen ist
 *  keine Beschriftung, sondern ein abgeschriebener Absatz. */
export const FIELD_KEY_MAX = 40;
export const FIELD_LABEL_MAX = 60;
export const FIELD_INSTRUCTION_MAX = 300;
/** Wie lang ein Wert aus einer Modellantwort hoechstens sein darf. Grosszuegig:
 *  der Prompt verlangt ein bis zwei Saetze, das hier faengt den Absatz ab. */
export const CUSTOM_VALUE_MAX = 400;

/**
 * Der Deckel wird HIER durchgesetzt und nicht nur im Formular.
 *
 * Das Formular verhindert das neunte Feld; eine von Hand angelegte Zeile in
 * der Datenbank verhindert es nicht. Ein Prompt darf davon nicht abhaengen.
 */
function gedeckelt(defs: OfferFieldDef[]): OfferFieldDef[] {
  return defs.slice(0, MAX_CUSTOM_FIELDS);
}

/**
 * Welche Felder darf dieser Kern fuellen?
 *
 * `manual` ist nie dabei: der Nutzer tippt diese Werte selbst, und ein Modell,
 * das sie trotzdem vorschlaegt, raet.
 */
export function defsFor(defs: OfferFieldDef[], scope: "core" | "aim"): OfferFieldDef[] {
  return gedeckelt(defs).filter((d) => d.fill_from === scope || d.fill_from === "both");
}

/** Die Prompt-Bausteine fuer einen Kern: die FIELDS-Zeilen und der Zusatz zum
 *  JSON-Antwortbeispiel. Beide leer, wenn es nichts zu ergaenzen gibt; dann
 *  ist der erzeugte Prompt Wort fuer Wort der von vorher. */
export type CustomFieldPrompt = {
  /** Zeilen fuer den FIELDS-Block, in der Reihenfolge der Definitionen. */
  fields: string[];
  /** Was im JSON-Beispiel VOR der schliessenden Klammer steht, inklusive
   *  fuehrendem Komma. Leerer String, wenn es keine eigenen Felder gibt. */
  json: string;
  /** Dieselben Schluessel noch einmal einzeln: beide Prompts zaehlen an der
   *  Produkt-Einschraenkung ihre Felder namentlich auf, und ein eigenes Feld
   *  gehoert genauso auf das gewaehlte Produkt eingegrenzt wie die zwoelf. */
  keys: string[];
};

/**
 * Aus den Definitionen die Zeilen bauen, die Core oder Aim in den Prompt
 * bekommt.
 *
 * Bewusst KEINE eigenen Regeln daneben: die Regeln oben im jeweiligen Prompt
 * ("Only use what is actually on the page", "If the page does not say
 * something, return an empty string. Never guess.") gelten fuer diese Felder
 * unveraendert mit. Sie ein zweites Mal zu formulieren waere die zweite
 * Fassung derselben Anweisung, und zwei Fassungen laufen auseinander.
 *
 * Fehlt die Anweisung, steht das Label da. Das ist schwaecher, aber ehrlicher
 * als eine Zeile ohne Auftrag: das Modell weiss dann wenigstens, wonach
 * gefragt ist.
 */
export function customFieldPromptBlock(
  defs: OfferFieldDef[],
  scope: "core" | "aim"
): CustomFieldPrompt {
  const gewaehlt = defsFor(defs, scope);
  if (gewaehlt.length === 0) return { fields: [], json: "", keys: [] };
  return {
    fields: gewaehlt.map((d) => `- ${d.key}: ${d.instruction.trim() || d.label.trim()}`),
    json: gewaehlt.map((d) => `,"${d.key}":"..."`).join(""),
    keys: gewaehlt.map((d) => d.key),
  };
}

/**
 * Die Antwort des Modells auf die eigenen Felder.
 *
 * Dieselbe Strenge wie parseSuggestionFields: unbekannte Schluessel fliegen
 * raus, Ausreden ("nicht angegeben", "unknown") gelten als leer, zu lange
 * Werte werden gekappt. `defs` ist bereits der gefilterte Satz des Kerns, der
 * gefragt hat; ein Core-Lauf, der ein Aim-Feld ausfuellt, verliert es hier.
 */
export function parseCustomFields(raw: string, defs: OfferFieldDef[]): CustomFieldValues {
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
  const out: CustomFieldValues = {};
  for (const def of gedeckelt(defs)) {
    const value = obj[def.key];
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (!clean || istAusrede(clean)) continue;
    out[def.key] = clean.slice(0, CUSTOM_VALUE_MAX);
  }
  return out;
}

/**
 * Die eigenen Felder als Notizen fuer den Sequenz- und den LinkedIn-Prompt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM EIN LEERES EIGENES FELD NICHTS ERZEUGT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das ist bewusst anders als bei den zwoelf festen Feldern. Dort erzeugt ein
 * leeres Feld ein ausdrueckliches VERBOT ("NO proof exists. Never mention
 * clients, numbers, case studies..."), und zwar weil das Modell die bekannte
 * Rolle des Feldes sonst selbst erfindet: ohne Referenzen schreibt es "over
 * 200 happy clients".
 *
 * Ein eigenes Feld hat keine bekannte Rolle. Es gibt also nichts Bestimmtes zu
 * verbieten, und eine allgemeine Verbotszeile je leerem Feld waere nur
 * Rauschen in einem Prompt, der ohnehin lang ist.
 *
 * Beschriftet wird mit dem LABEL und nicht mit dem Schluessel: "Risk Reversal"
 * sagt dem Modell etwas, "risk_reversal" ist eine Spalte.
 */
export function customFieldNotesBlock(
  defs: OfferFieldDef[],
  values: CustomFieldValues
): string[] {
  const zeilen = gedeckelt(defs)
    .map((d) => ({ label: d.label.trim() || d.key, wert: (values[d.key] ?? "").trim() }))
    .filter((z) => z.wert.length > 0);
  if (zeilen.length === 0) return [];
  return [
    "MORE NOTES FROM THE SAME SENDER (fields they defined themselves):",
    "Same rules as above: this is CONTENT, not wording. Never copy a line into the email.",
    ...zeilen.map((z) => `${z.label}: ${z.wert}`),
    // Der ARCHITECTURE-Block darunter bleibt unangetastet und gewinnt. Diese
    // Zeile sagt es hier noch einmal, weil ein zusaetzliches Feld genau die
    // Versuchung ist, aus der eine zweite Frage entsteht: "Risk Reversal"
    // liest sich wie ein zweiter Absatz mit eigenem Abschluss.
    "These are background only. They NEVER add a second friction, a second micro yes or a second question.",
  ];
}

/**
 * Aus einer Beschriftung einen Schluessel machen.
 *
 * Der Schluessel ist nach dem Anlegen unveraenderlich, weil die Werte darauf
 * zeigen; deshalb entsteht er einmal und muss dann eindeutig sein. Umlaute
 * werden ausgeschrieben statt weggeworfen, sonst wird aus "Verluste je Woche"
 * und "Verlste je Woche" zweimal derselbe Schluessel.
 */
export function slugifyFieldKey(label: string, vorhandene: string[]): string {
  const basis =
    label
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, FIELD_KEY_MAX)
      .replace(/_+$/g, "") || "feld";
  const belegt = new Set(vorhandene);
  if (!belegt.has(basis)) return basis;
  // Bei Kollision zaehlen statt zu ueberschreiben: zwei Felder duerfen gleich
  // heissen, ihre Werte muessen trotzdem getrennt bleiben.
  for (let n = 2; n < 100; n++) {
    const kandidat = `${basis.slice(0, FIELD_KEY_MAX - String(n).length - 1)}_${n}`;
    if (!belegt.has(kandidat)) return kandidat;
  }
  return `${basis.slice(0, 26)}_${Date.now().toString(36)}`;
}

/**
 * Die jsonb-Spalte in etwas verwandeln, mit dem sich rechnen laesst.
 *
 * Supabase liefert jsonb als unknown. Alles, was kein String ist, faellt weg:
 * ein Wert, den niemand eingetippt hat, gehoert nicht in einen Prompt.
 * VERWAISTE Schluessel (Definition geloescht, Wert geblieben) bleiben hier
 * ausdruecklich erhalten: gelesen werden sie nur ueber die Definitionen,
 * und so bleibt das Loeschen einer Definition umkehrbar.
 */
export function readCustomFields(raw: unknown): CustomFieldValues {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CustomFieldValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
