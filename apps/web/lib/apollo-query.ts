// Apollos People-Search-Anfrage, gebaut aus unseren gespeicherten Such-Filtern.
//
// Diese Datei ist die TypeScript-Entsprechung von build_people_search_body() in
// apps/worker/worker/pipelines/apollo.py und MUSS mit ihr uebereinstimmen. Der
// Grund ist der Trefferzaehler: er zaehlt nur dann die Wahrheit, wenn er exakt
// dieselbe Anfrage stellt wie der Worker spaeter beim echten Lauf. Weicht auch
// nur ein Feld ab, verspricht die Oberflaeche eine Zahl, die die Suche nicht
// einloest — schlimmer als gar keine Zahl.
//
// Warum die Konstanten hier und nicht im Formular stehen: sie werden an zwei
// Stellen gebraucht (Formular und Zaehler-Route). Eine dritte Kopie waere genau
// die Sorte stiller Abweichung, die diese Datei verhindern soll.

/**
 * Apollos organization_locations erwartet ausgeschriebene englische Namen,
 * nicht ISO-Codes — deshalb eine eigene Zuordnung statt der lokalisierten
 * Labels aus dem Woerterbuch (die je nach UI-Sprache "Deutschland" oder
 * "Germany" waeren und Apollo im ersten Fall nichts liefern).
 *
 * Stand bis zum 2026-08-10 im Formular. Umgezogen, weil die Rueckrechnung
 * (Name -> Code) beim Erzeugen einer Vorlage aus einer gelaufenen Suche
 * gebraucht wird und eine zweite Kopie genau die stille Abweichung waere, vor
 * der der Kopfkommentar dieser Datei warnt.
 */
export const APOLLO_COUNTRY_NAMES: Record<string, string> = {
  AT: "Austria", DE: "Germany", CH: "Switzerland", GB: "United Kingdom",
  US: "United States", NL: "Netherlands", FR: "France", IT: "Italy", ES: "Spain",
};

/** Gegenrichtung fuer den Weg aus searches.filters zurueck ins Formular.
 *  Unbekannte Namen fallen weg: Apollo kennt mehr Laender, als das Formular
 *  anbietet, und ein Code, den die Auswahl nicht hat, waere ein Haken, den
 *  niemand sieht und niemand wieder loswird. */
export function apolloCountryCodes(names: string[]): string[] {
  const codes = new Set<string>();
  for (const name of names) {
    const code = Object.keys(APOLLO_COUNTRY_NAMES).find(
      (c) => APOLLO_COUNTRY_NAMES[c].toLowerCase() === name.trim().toLowerCase()
    );
    if (code) codes.add(code);
  }
  return [...codes];
}

/** Apollos vollstaendige, gueltige Werte fuer person_seniorities. Ein Wert
 *  ausserhalb dieser Liste ist bei Apollo eine ungueltige Anfrage, keine
 *  Geschmacksfrage. Spiegelt APOLLO_SENIORITIES im Worker. */
export const APOLLO_SENIORITIES = [
  "owner", "founder", "c_suite", "partner", "vp", "head", "director",
  "manager", "senior", "entry", "intern",
] as const;

/** Vorauswahl: die Stufen, die ueblicherweise entscheiden. Greift auch als
 *  Rueckfall, wenn nach dem Filtern nichts Gueltiges uebrig bleibt — eine
 *  Suche ganz ohne Senioritaet wuerde quer durch alle Hierarchiestufen
 *  Credits verbrauchen. Spiegelt DECISIONMAKER_SENIORITIES im Worker. */
export const APOLLO_DEFAULT_SENIORITIES = [
  "owner", "founder", "c_suite", "partner", "vp", "head", "director",
];

/** Apollos eigene elf Stufen aus dem "# Employees"-Filter. Eine eigene Stufung
 *  waere ein stiller Unterschied zu dem, was der Kunde in Apollo selbst sieht
 *  ("11-50" ist dort keine Option). Spiegelt APOLLO_EMPLOYEE_RANGES im Worker. */
export const APOLLO_EMPLOYEE_RANGES = [
  "1-10", "11-20", "21-50", "51-100", "101-200", "201-500",
  "501-1000", "1001-2000", "2001-5000", "5001-10000", "10001+",
];

/**
 * Apollos "Market Segments" aus dem Bereich "Industry & Keywords".
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WIE DIESE WERTE ZUSTANDE KOMMEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Nicht geraten, sondern am 2026-08-09 gegen die echte API gemessen. Das war
 * noetig, weil Apollos API-Referenz den Filter ueberhaupt nicht auffuehrt --
 * sie listet nicht einmal q_organization_keyword_tags, das die App seit
 * Langem erfolgreich nutzt. Und ein Parametername, den Apollo nicht kennt,
 * wird STILL IGNORIERT statt abgelehnt (derselbe Fall wie seinerzeit
 * q_organization_domains, siehe apollo.py). Der Zaehler haette dann eine Zahl
 * versprochen, die die Suche nicht einloest.
 *
 * Messung mit gleicher Basisanfrage, nur der Segment-Parameter variiert:
 *
 *   organization_market_segments     4278 -> 4278   ignoriert
 *   q_organization_market_segments   4278 -> 4278   ignoriert
 *   market_segments                  4278 -> 1409   WIRKT
 *
 * Danach jeder einzelne Wert einzeln geprueft (Basis 2443): b2b 2159,
 * b2c 1003, b2b2c 4, ecommerce 261, fintech 23, d2c 571, non_profit 2,
 * saas 766, consulting 1634, services 2437, retail 910. Kein Wert blieb auf
 * der Basis stehen, alle elf werden also erkannt.
 *
 * Mehrere Werte sind ein ODER: saas 766 + consulting 1634 zusammen 1796 --
 * mehr als jeder einzelne, also Vereinigung und nicht Schnitt. Ein UND waere
 * hier auch sinnlos, kaum eine Firma ist gleichzeitig SaaS und Retail.
 *
 * Die Schreibweisen sind Apollos, nicht unsere: "ecommerce" ohne Bindestrich,
 * "non_profit" mit Unterstrich. Spiegelt APOLLO_MARKET_SEGMENTS im Worker.
 */
export const APOLLO_MARKET_SEGMENTS = [
  "b2b", "b2c", "b2b2c", "ecommerce", "fintech", "d2c",
  "non_profit", "saas", "consulting", "services", "retail",
] as const;

/** Die Filter, wie sie in searches.filters liegen. */
export type ApolloFilters = {
  person_titles?: string | null;
  apollo_locations?: string[] | null;
  apollo_seniorities?: string[] | null;
  headcount?: string | null;
  keywords?: string | null;
  technologies?: string[] | null;
  market_segments?: string[] | null;
};

export type ApolloSearchBody = Record<string, unknown>;

function commaList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function validSeniorities(raw: string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return [...APOLLO_DEFAULT_SENIORITIES];
  const picked = APOLLO_SENIORITIES.filter((s) => raw.includes(s));
  return picked.length > 0 ? [...picked] : [...APOLLO_DEFAULT_SENIORITIES];
}

/** Formularwert ("11-20", "10001+") in Apollos Range-Schreibweise ("11,20").
 *  Unbekannte Stufen werden verworfen statt umgerechnet. */
export function employeeRange(headcount: string | null | undefined): string | null {
  const value = (headcount ?? "").trim();
  if (!value || !APOLLO_EMPLOYEE_RANGES.includes(value)) return null;
  if (value.endsWith("+")) return `${value.slice(0, -1)},1000000`;
  const [low, high] = value.split("-");
  return `${low},${high}`;
}

/** True, wenn ueberhaupt ein Filter gesetzt ist. Ohne einen einzigen Filter
 *  waere die Anfrage "alle Menschen mit verifizierter Adresse" — der Worker
 *  weist das ab, und der Zaehler soll gar nicht erst danach fragen. */
export function hasAnyApolloFilter(filters: ApolloFilters): boolean {
  return (
    commaList(filters.person_titles).length > 0 ||
    (filters.apollo_locations?.length ?? 0) > 0 ||
    commaList(filters.keywords).length > 0 ||
    employeeRange(filters.headcount) !== null ||
    (filters.technologies?.length ?? 0) > 0 ||
    validMarketSegments(filters.market_segments).length > 0
  );
}

/** Nur Apollos eigene elf Werte durchlassen. Ein unbekannter Wert wuerde von
 *  Apollo stillschweigend ignoriert — dann zaehlte die Oberflaeche mit einem
 *  Filter, den die Suche gar nicht anwendet. */
function validMarketSegments(raw: string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return APOLLO_MARKET_SEGMENTS.filter((s) => raw.includes(s));
}

/**
 * Der People-Search-Body. Spiegelt build_people_search_body() im Worker.
 *
 * contact_email_status=verified ist der Kern: Apollo gibt so ausschliesslich
 * Personen zurueck, fuer die eine verifizierte E-Mail vorliegt. Genau deshalb
 * ist die gezaehlte Zahl auch die Zahl erreichbarer Leads und nicht bloss die
 * Zahl passender Personen.
 */
export function buildApolloSearchBody(
  filters: ApolloFilters,
  page = 1,
  perPage = 1
): ApolloSearchBody {
  const body: ApolloSearchBody = {
    page,
    per_page: perPage,
    contact_email_status: ["verified"],
    person_seniorities: validSeniorities(filters.apollo_seniorities),
  };
  const titles = commaList(filters.person_titles);
  if (titles.length > 0) body.person_titles = titles;
  // Standort der FIRMA, nicht der Person: gesucht sind Unternehmen in einem
  // Markt; wo die Person privat sitzt, ist fuer die Zielgruppe unerheblich.
  const locations = (filters.apollo_locations ?? [])
    .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    .map((l) => l.trim());
  if (locations.length > 0) body.organization_locations = locations;
  const keywords = commaList(filters.keywords);
  if (keywords.length > 0) body.q_organization_keyword_tags = keywords;
  const range = employeeRange(filters.headcount);
  if (range) body.organization_num_employees_ranges = [range];
  // "any_of" ist Absicht: mehrere Shopsysteme sind ein ODER (Shopify ODER
  // Shopware), ein UND haette praktisch nie einen Treffer.
  const technologies = (filters.technologies ?? []).filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0
  );
  if (technologies.length > 0) {
    body.currently_using_any_of_technology_uids = [...new Set(technologies.map((t) => t.trim()))];
  }
  // Mehrere Segmente sind bei Apollo ein ODER (nachgemessen, siehe
  // APOLLO_MARKET_SEGMENTS) — genau richtig fuer "B2B oder SaaS".
  const segments = validMarketSegments(filters.market_segments);
  if (segments.length > 0) body.market_segments = segments;
  return body;
}
