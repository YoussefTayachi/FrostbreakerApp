import type { SearchRowForPreset } from "./search-presets";

/**
 * Was in einer gelaufenen Suche tatsaechlich eingestellt war, lesbar.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DER ANLASS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Derselbe Kunde, derselbe Satz wie bei den Vorlagen: "dann muesste ich nicht
 * nochmal ueberlegen, was hatte ich nochmal ausgewaehlt." Die Suchdetailseite
 * zeigte bis zum 2026-08-10 nur Suchbegriff, Ort und Datum. Senioritaeten,
 * Firmengroesse, Technologien, Marktsegmente, also alles, was die Suche
 * ausmacht, lag in searches.filters und wurde nie angezeigt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM SCHLUESSEL STATT FERTIGER TEXTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Diese Datei liefert Schluessel und Rohwerte, keine uebersetzten Saetze. Die
 * Oberflaeche haengt die Beschriftung an (de/en) und uebersetzt, wo sie es
 * besser kann: Senioritaeten haben eigene Labels im Woerterbuch, Technologien
 * heissen im Formular anders als der Slug beim Anbieter. So bleibt hier reine
 * Logik, die der Test ohne Woerterbuch pruefen kann.
 */

/** Als Liste und nicht nur als Typ, damit ein Test nachsehen kann, ob fuer
 *  jeden Schluessel eine deutsche UND eine englische Beschriftung existiert.
 *  Ohne diese Liste faellt eine vergessene Uebersetzung erst im Browser auf,
 *  als "undefined:" vor dem Wert. */
export const FILTER_KEYS = [
  "radius", "noWebsite", "maxRating",
  "industry", "city", "country", "headcount", "keywords",
  "personTitles", "seniorities", "locations", "personLocations",
  "technologies", "marketSegments", "industries",
  "revenue", "funding", "intent", "hiringFor", "jobPostings", "traffic",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

export type FilterLine = {
  key: FilterKey;
  /** Rohwerte. Die Oberflaeche verbindet und uebersetzt sie. */
  items: string[];
  /** Fuer Technologien: aus welcher Slug-Welt die Werte stammen. */
  provider?: "apollo" | "hunter";
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "ab 2", "bis 5", "2 bis 5", je nachdem, welche Grenze gesetzt ist. */
function range(min: unknown, max: unknown): string | null {
  const von = num(min);
  const bis = num(max);
  if (von === null && bis === null) return null;
  if (von !== null && bis !== null) return `${von}–${bis}`;
  if (von !== null) return `≥ ${von}`;
  return `≤ ${bis}`;
}

export function searchFilterLines(row: SearchRowForPreset): FilterLine[] {
  const f = row.filters ?? {};
  const zeilen: FilterLine[] = [];
  const add = (key: FilterKey, items: string[], provider?: "apollo" | "hunter") => {
    if (items.length > 0) zeilen.push({ key, items, ...(provider ? { provider } : {}) });
  };

  if (row.source === "apollo") {
    add("personTitles", str(f.person_titles) ? [str(f.person_titles)] : []);
    add("seniorities", list(f.apollo_seniorities));
    add("locations", list(f.apollo_locations));
    add("headcount", str(f.headcount) ? [str(f.headcount)] : []);
    add("keywords", str(f.keywords) ? [str(f.keywords)] : []);
    add("technologies", list(f.technologies), "apollo");
    add("marketSegments", list(f.market_segments));
    return zeilen;
  }

  if (row.source === "corporate") {
    add("industry", str(f.industry) ? [str(f.industry)] : []);
    add("city", [str(f.city), str(f.state)].filter(Boolean));
    add("country", str(f.country) ? [str(f.country)] : []);
    add("headcount", str(f.headcount) ? [str(f.headcount)] : []);
    add("keywords", str(f.keywords) ? [str(f.keywords)] : []);
    add("technologies", list(f.technologies), "hunter");
    return zeilen;
  }

  if (row.source === "prospeo") {
    add("personTitles", str(f.person_titles) ? [str(f.person_titles)] : []);
    add("personLocations", list(f.person_locations));
    add("locations", list(f.company_locations));
    add("industries", list(f.industries));
    add("headcount", list(f.headcount));
    add("keywords", str(f.keywords) ? [str(f.keywords)] : []);
    add("technologies", list(f.technologies));
    add("revenue", list(f.revenue));
    add("funding", list(f.funding));
    add("intent", list(f.intent));
    add("hiringFor", str(f.hiring_for) ? [str(f.hiring_for)] : []);
    const stellen = range(f.job_posting_min, f.job_posting_max);
    add("jobPostings", stellen ? [stellen] : []);
    const besuche = range(f.traffic_min_visits, f.traffic_max_visits);
    add("traffic", besuche ? [besuche] : []);
    return zeilen;
  }

  // Maps. Der Umkreis steht als Spalte, nicht in filters; er ist deshalb der
  // einzige Wert, der auch ohne jeden gesetzten Filter eine Zeile ergibt.
  if (row.radius_m) add("radius", [`${Math.round(row.radius_m / 1000)} km`]);
  if (f.pain_point_no_website === true) add("noWebsite", ["ja"]);
  const bewertung = num(f.pain_point_max_rating);
  if (bewertung !== null) add("maxRating", [`≤ ${bewertung}`]);
  return zeilen;
}
