/**
 * Prospeos Personensuche, gebaut aus unseren gespeicherten Such-Filtern.
 *
 * Diese Datei ist die TypeScript-Entsprechung von build_search_filters() in
 * apps/worker/worker/pipelines/prospeo.py und MUSS mit ihr uebereinstimmen;
 * derselbe Grund wie bei apollo-query.ts: der Trefferzaehler im Formular
 * zaehlt nur dann die Wahrheit, wenn er exakt dieselbe Anfrage stellt wie der
 * Worker beim echten Lauf. Weicht ein Feld ab, verspricht die Oberflaeche eine
 * Zahl, die die Suche nicht einloest.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS ICH GERATEN HABE UND WAS BELEGT IST
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Belegt aus prospeo.io/api-docs (2026-08-05): alle Feldnamen unten, die
 * Stufenlisten fuer Groesse und Umsatz, die Grenzen (max 20 Technologien,
 * max 500 Stellentitel, max 5 Laender) und die Tarifanforderungen.
 *
 * NICHT geraten wurden die wertgebundenen Felder. Prospeo verlangt fuer Ort,
 * Branche, Technologie, Intent und einige weitere Felder Werte aus seiner
 * eigenen Suggestions-API ("Location values must be obtained from the Search
 * Suggestions API"). Diese Werte stehen deshalb NIRGENDS in diesem Code als
 * Liste: das Formular holt sie zur Laufzeit ueber /api/prospeo/suggestions.
 *
 * Das ist Absicht und der wichtigste Entwurfsentscheid dieser Datei: eine
 * hier hinterlegte Enum-Liste waere im Moment des Schreibens eine Vermutung
 * und im Moment des naechsten Prospeo-Updates falsch, und der Fehler waere
 * nicht laut, sondern ein leeres Suchergebnis.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TARIFSTUFEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Drei Filter setzen einen bezahlten Prospeo-Tarif voraus. Das ist eine
 * Sperre des Anbieters, kein Fehler bei uns; die Oberflaeche kennzeichnet
 * sie, und der Worker meldet einen 403 darauf verstaendlich statt als
 * "Suche fehlgeschlagen".
 */

/** Welcher Prospeo-Tarif ein Filter mindestens braucht. */
export type ProspeoPlan = "free" | "starter" | "pro";

/**
 * Belegt am 2026-08-05 in der Filter-Dokumentation und am eigenen Konto
 * gegengeprueft (Free-Konto zeigt "Upgrade to Starter to unlock" auf
 * Technologies und Job Posting).
 */
export const PROSPEO_FILTER_PLAN: Record<string, ProspeoPlan> = {
  company_technology: "starter",
  company_job_posting_hiring_for: "starter",
  company_job_posting_quantity: "starter",
  company_revenue: "starter",
  company_funding: "starter",
  // Der staerkste Filter und zugleich der teuerste: laut Doku Pro.
  company_website_traffic: "pro",
};

/**
 * Prospeos elf Groessenstufen, wortwoertlich aus der Doku.
 *
 * Achtung, Unterschied zu Apollo: die oberste Stufe heisst bei Prospeo
 * "10000+", bei Apollo "10001+". Eine gemeinsame Konstante waere deshalb ein
 * stiller Fehler bei genau einer der beiden Suchen.
 */
export const PROSPEO_HEADCOUNT_RANGES = [
  "1-10", "11-20", "21-50", "51-100", "101-200", "201-500",
  "501-1000", "1001-2000", "2001-5000", "5001-10000", "10000+",
] as const;

/** Umsatzstufen, wortwoertlich aus der Doku. */
export const PROSPEO_REVENUE_TIERS = [
  "<100K", "100K", "500K", "1M", "5M", "10M", "25M", "50M",
  "100M", "250M", "500M", "1B", "5B", "10B+",
] as const;

/** Bezugszeitraum der Traffic-Veraenderung. Voreinstellung laut Doku: monthly. */
export const PROSPEO_TRAFFIC_PERIODS = ["monthly", "quarterly", "yearly"] as const;
export type ProspeoTrafficPeriod = (typeof PROSPEO_TRAFFIC_PERIODS)[number];

/**
 * Wie Stellentitel verglichen werden. GROSSGESCHRIEBEN, und es sind vier.
 *
 * Die Doku schreibt "contains (default) or exact". Die echte API lehnt beides
 * klein ab: "Invalid match_mode. Must be one of: CONTAINS, EXACT, SIMILAR,
 * STRICT." Am 2026-08-05 im Testlauf gegen die API gemessen; ohne den waere
 * jede Suche mit Positionsangabe an einem 400 gescheitert.
 */
export const PROSPEO_MATCH_TYPES = ["CONTAINS", "EXACT", "SIMILAR", "STRICT"] as const;
export type ProspeoMatchMode = (typeof PROSPEO_MATCH_TYPES)[number];

/** Unbekanntes faellt auf CONTAINS zurueck, statt einen ungueltigen Wert zu
 *  schicken. Spiegelt _match_mode() im Worker. */
function matchMode(raw: unknown): ProspeoMatchMode {
  const value = String(raw ?? "").trim().toUpperCase();
  return (PROSPEO_MATCH_TYPES as readonly string[]).includes(value)
    ? (value as ProspeoMatchMode)
    : "CONTAINS";
}

/** Grenzen aus der Doku. Ueberschreiten heisst bei Prospeo: ungueltige Anfrage. */
export const PROSPEO_LIMITS = {
  technologies: 20,
  keywords: 20,
  industries: 500,
  jobPostingTerms: 500,
  trafficCountries: 5,
  websites: 500,
  /** 25 Treffer je Seite, hoechstens 1000 Seiten. */
  perPage: 25,
  maxPages: 1000,
} as const;

/**
 * Die Filter, wie sie in searches.filters liegen.
 *
 * Bewusst flach und mit unseren eigenen Namen, nicht Prospeos verschachtelter
 * Struktur: so bleibt das gespeicherte Format lesbar und unabhaengig davon,
 * ob Prospeo seine Feldnamen einmal umbenennt. Die Uebersetzung passiert
 * genau an einer Stelle: in buildProspeoFilters() unten.
 */
export type ProspeoFilters = {
  /** Freitext, mehrere durch Komma. Wird zu person_job_title. */
  person_titles?: string | null;
  person_title_match?: ProspeoMatchMode | null;
  /** Werte aus der Suggestions-API (location_search). */
  person_locations?: string[] | null;
  company_locations?: string[] | null;
  /** Werte aus der Suggestions-API (industry_search). */
  industries?: string[] | null;
  /** Eine oder mehrere der elf Stufen. */
  headcount?: string[] | null;
  /** Werte aus der Suggestions-API (technology_search), max 20. */
  technologies?: string[] | null;
  /** Freitext, mehrere durch Komma, max 20. */
  keywords?: string | null;
  revenue?: string[] | null;
  funding?: string[] | null;
  /** Kaufabsicht: Themennamen, nicht IDs. */
  intent?: string[] | null;
  /** Stellenausschreibungen: wonach gesucht wird. */
  hiring_for?: string | null;
  hiring_match?: ProspeoMatchMode | null;
  job_posting_min?: number | null;
  job_posting_max?: number | null;
  /** Website-Traffic. */
  traffic_min_visits?: number | null;
  traffic_max_visits?: number | null;
  traffic_change_period?: ProspeoTrafficPeriod | null;
  traffic_change_min?: number | null;
  traffic_change_max?: number | null;
  /** Werte aus der Suggestions-API (company_website_traffic_countries_search). */
  traffic_countries?: string[] | null;
  traffic_country_min_pct?: number | null;
};

export type ProspeoSearchFilters = Record<string, unknown>;

function commaList(value: string | null | undefined, max?: number): string[] {
  const list = String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return max ? list.slice(0, max) : list;
}

function cleanList(raw: unknown, max?: number): string[] {
  if (!Array.isArray(raw)) return [];
  const list = raw.map((v) => String(v).trim()).filter(Boolean);
  return max ? list.slice(0, max) : list;
}

/** Zahl oder null, niemals NaN; das waere bei Prospeo eine ungueltige Anfrage. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Baut Prospeos `filters`-Objekt.
 *
 * Grundregel: ein Filter, der nicht gesetzt ist, taucht GAR NICHT auf. Ein
 * leeres include-Array ist bei Prospeo kein "egal", sondern eine Bedingung,
 * die nichts erfuellt; das waere die Sorte Fehler, die als "keine Treffer"
 * erscheint und stundenlang gesucht wird.
 */
export function buildProspeoFilters(f: ProspeoFilters): ProspeoSearchFilters {
  const out: ProspeoSearchFilters = {};

  // ── Person ────────────────────────────────────────────────────────────
  const titles = commaList(f.person_titles);
  if (titles.length) {
    out.person_job_title = {
      include: titles,
      match_mode: matchMode(f.person_title_match),
    };
  }

  const personLocations = cleanList(f.person_locations);
  if (personLocations.length) out.person_location_search = { include: personLocations };

  // ── Firma: Grunddaten ────────────────────────────────────────────────
  const companyLocations = cleanList(f.company_locations);
  if (companyLocations.length) out.company_location_search = { include: companyLocations };

  const industries = cleanList(f.industries, PROSPEO_LIMITS.industries);
  if (industries.length) out.company_industry = { include: industries };

  const headcount = cleanList(f.headcount).filter((h) =>
    (PROSPEO_HEADCOUNT_RANGES as readonly string[]).includes(h)
  );
  if (headcount.length) out.company_headcount_range = { include: headcount };

  const keywords = commaList(f.keywords, PROSPEO_LIMITS.keywords);
  if (keywords.length) out.company_keywords = { include: keywords };

  // ── Firma: Tarifgebundene Filter ─────────────────────────────────────
  const technologies = cleanList(f.technologies, PROSPEO_LIMITS.technologies);
  if (technologies.length) out.company_technology = { include: technologies };

  const revenue = cleanList(f.revenue).filter((r) =>
    (PROSPEO_REVENUE_TIERS as readonly string[]).includes(r)
  );
  if (revenue.length) out.company_revenue = { include: revenue };

  const funding = cleanList(f.funding);
  if (funding.length) out.company_funding = { include: funding };

  const intent = cleanList(f.intent);
  if (intent.length) out.company_intent = { include: intent };

  // ── Stellenausschreibungen ───────────────────────────────────────────
  const hiring = commaList(f.hiring_for, PROSPEO_LIMITS.jobPostingTerms);
  if (hiring.length) {
    out.company_job_posting_hiring_for = {
      include: hiring,
      match_type: matchMode(f.hiring_match),
    };
  }

  const jobMin = num(f.job_posting_min);
  const jobMax = num(f.job_posting_max);
  if (jobMin !== null || jobMax !== null) {
    const range: Record<string, number> = {};
    if (jobMin !== null) range.min = jobMin;
    if (jobMax !== null) range.max = jobMax;
    out.company_job_posting_quantity = range;
  }

  // ── Website-Traffic ──────────────────────────────────────────────────
  //
  // Laut Doku muss mindestens eines der drei Kriterien gesetzt sein:
  // Besuchsspanne, Veraenderung oder Laender. Ein Traffic-Objekt, das nur
  // aus einem Zeitraum besteht, waere eine ungueltige Anfrage; deshalb
  // wird hier geprueft und nicht blind zusammengebaut.
  const traffic: Record<string, unknown> = {};
  const minVisits = num(f.traffic_min_visits);
  const maxVisits = num(f.traffic_max_visits);
  if (minVisits !== null) traffic.min_monthly_visits = minVisits;
  if (maxVisits !== null) traffic.max_monthly_visits = maxVisits;

  const changeMin = num(f.traffic_change_min);
  const changeMax = num(f.traffic_change_max);
  if (changeMin !== null || changeMax !== null) {
    const change: Record<string, unknown> = {
      period: f.traffic_change_period ?? "monthly",
    };
    if (changeMin !== null) change.min_change = changeMin;
    if (changeMax !== null) change.max_change = changeMax;
    traffic.visit_change = change;
  }

  const countries = cleanList(f.traffic_countries, PROSPEO_LIMITS.trafficCountries);
  if (countries.length) {
    traffic.top_countries = countries;
    // min_country_pct ist laut Doku nur zusammen mit top_countries erlaubt.
    const pct = num(f.traffic_country_min_pct);
    if (pct !== null) traffic.min_country_pct = pct;
  }

  const hasTrafficCriterion =
    minVisits !== null || maxVisits !== null || "visit_change" in traffic || countries.length > 0;
  if (hasTrafficCriterion) out.company_website_traffic = traffic;

  return out;
}

/** Ist ueberhaupt ein Filter gesetzt? Eine Suche ohne jeden Filter wuerde
 *  quer durch 200 Millionen Kontakte laufen und Credits verbrennen. */
export function hasAnyProspeoFilter(f: ProspeoFilters): boolean {
  return Object.keys(buildProspeoFilters(f)).length > 0;
}

/**
 * Welche tarifgebundenen Filter sind gesetzt?
 *
 * Damit die Oberflaeche VOR dem Start sagen kann "dieser Filter braucht Pro",
 * statt den Nutzer in einen 403 laufen zu lassen. Derselbe Gedanke wie beim
 * Torwart: lieber vorher erklaeren als hinterher scheitern.
 */
export function requiredProspeoPlan(f: ProspeoFilters): {
  plan: ProspeoPlan;
  fields: string[];
} {
  const built = buildProspeoFilters(f);
  const order: ProspeoPlan[] = ["free", "starter", "pro"];
  let plan: ProspeoPlan = "free";
  const fields: string[] = [];

  for (const field of Object.keys(built)) {
    const needed = PROSPEO_FILTER_PLAN[field];
    if (!needed || needed === "free") continue;
    fields.push(field);
    if (order.indexOf(needed) > order.indexOf(plan)) plan = needed;
  }
  return { plan, fields };
}
