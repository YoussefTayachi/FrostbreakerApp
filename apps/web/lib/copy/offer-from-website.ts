/**
 * Aus einer Website Vorschlaege fuer die Angebotsfelder machen.
 *
 * WOFUER
 *
 * Sieben leere Felder sind fuer den Nutzer dasselbe leere Blatt, das der
 * Sequenzgenerator gerade abschaffen soll. Die meisten Antworten stehen aber
 * schon auf seiner eigenen Website -- er muss sie nur bestaetigen statt
 * abtippen.
 *
 * DIE ENTSCHEIDENDE EINSCHRAENKUNG
 *
 * Was hier entsteht, sind VORSCHLAEGE, kein gespeichertes Angebot. Der Nutzer
 * uebernimmt jedes Feld einzeln. Grund: eine falsch gelesene Website vergiftet
 * danach jede erzeugte Mail, und zwar unsichtbar -- der Fehler steht dann in
 * einem Feld, das niemand mehr liest, weil es ja "schon ausgefuellt" ist.
 *
 * Und dieselbe Regel wie ueberall sonst in diesem Bereich: was nicht auf der
 * Seite steht, bleibt leer. Das Modell wird ausdruecklich angewiesen, nichts
 * zu ergaenzen -- vor allem keine Referenzen und keine Zahlen.
 */
import { OFFER_TEXT_FIELDS, type OfferTextField } from "@/lib/offers";
import type { WebsiteContent } from "@/lib/website-text";

export type OfferSuggestion = Partial<Record<OfferTextField, string>>;

/**
 * `tone` wird bewusst NICHT vorgeschlagen.
 *
 * Der Ton ist die einzige der sieben Angaben, die nicht auf der Website
 * steht, sondern eine Entscheidung des Absenders ist. Eine Website ist ein
 * Schaufenster; wie jemand eine kalte Mail schreiben will, hat damit nichts
 * zu tun. Ein Vorschlag dort waere geraten, und geraten heisst hier: es steht
 * danach etwas im Feld, das niemand entschieden hat.
 */
export const SUGGESTED_FIELDS: OfferTextField[] = OFFER_TEXT_FIELDS.filter((f) => f !== "tone");

export function buildOfferPrompt(content: WebsiteContent, language: "de" | "en"): string {
  const sprache = language === "en" ? "English" : "German";
  return [
    "You read a company website and fill in a short profile of what this company SELLS.",
    "This profile is later used to write cold outreach emails on their behalf.",
    "",
    "RULES:",
    "- Only use what is actually on the page. Never add industry knowledge of your own.",
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
    "- outcome: what is different afterwards, with a number if the page names one",
    "- proof: references, results, figures, years in business, named clients",
    "- cta: what they ask visitors to do (book a call, request a quote, ...)",
    "",
    "Answer with JSON only:",
    '{"offering":"...","icp":"...","problem":"...","outcome":"...","proof":"...","cta":"..."}',
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

/** Das erste JSON-Objekt im Text -- auch mit Vorrede oder Codeblock drumherum. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * Die Antwort des Modells in Feldvorschlaege verwandeln.
 *
 * Streng in eine Richtung: unbekannte Schluessel fliegen raus, `tone` wird
 * ignoriert (siehe SUGGESTED_FIELDS), und ein Feld, das das Modell mit einer
 * Ausrede gefuellt hat ("nicht angegeben", "unknown"), gilt als leer. Genau
 * solche Saetze landen sonst als Tatsachenbehauptung im naechsten Prompt.
 */
export function parseOfferSuggestion(raw: string): OfferSuggestion {
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
  for (const field of SUGGESTED_FIELDS) {
    const value = obj[field];
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (!clean || istAusrede(clean)) continue;
    out[field] = clean;
  }
  return out;
}

/**
 * "Nicht angegeben", "n/a", "unbekannt" -- die Standardausreden.
 *
 * Ohne diese Pruefung steht spaeter woertlich "Keine Angabe auf der Website"
 * im Feld `proof`, und der Sequenzgenerator liest das als Beleg, den er
 * erwaehnen darf.
 */
function istAusrede(value: string): boolean {
  const v = value.toLowerCase().replace(/[.!]/g, "").trim();
  if (v.length > 60) return false;
  return /^(n\/?a|keine? angaben?|nicht angegeben|nicht (ersichtlich|genannt|erkennbar|vorhanden)|unbekannt|unknown|not (specified|stated|mentioned|available)|none|kein[e]? .{0,30}(gefunden|genannt|angegeben))$/.test(
    v
  );
}
