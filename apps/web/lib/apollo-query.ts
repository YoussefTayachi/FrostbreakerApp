// Apollos People-Search-Anfrage, gebaut aus unseren gespeicherten Such-Filtern.
//
// Diese Datei ist die TypeScript-Entsprechung von build_people_search_body() in
// apps/worker/worker/pipelines/apollo.py und MUSS mit ihr uebereinstimmen. Der
// Grund ist der Trefferzaehler: er zaehlt nur dann die Wahrheit, wenn er exakt
// dieselbe Anfrage stellt wie der Worker spaeter beim echten Lauf. Weicht auch
// nur ein Feld ab, verspricht die Oberflaeche eine Zahl, die die Suche nicht
// einloest -- schlimmer als gar keine Zahl.
//
// Warum die Konstanten hier und nicht im Formular stehen: sie werden an zwei
// Stellen gebraucht (Formular und Zaehler-Route). Eine dritte Kopie waere genau
// die Sorte stiller Abweichung, die diese Datei verhindern soll.

/** Apollos vollstaendige, gueltige Werte fuer person_seniorities. Ein Wert
 *  ausserhalb dieser Liste ist bei Apollo eine ungueltige Anfrage, keine
 *  Geschmacksfrage. Spiegelt APOLLO_SENIORITIES im Worker. */
export const APOLLO_SENIORITIES = [
  "owner", "founder", "c_suite", "partner", "vp", "head", "director",
  "manager", "senior", "entry", "intern",
] as const;

/** Vorauswahl: die Stufen, die ueblicherweise entscheiden. Greift auch als
 *  Rueckfall, wenn nach dem Filtern nichts Gueltiges uebrig bleibt -- eine
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

/** Die Filter, wie sie in searches.filters liegen. */
export type ApolloFilters = {
  person_titles?: string | null;
  apollo_locations?: string[] | null;
  apollo_seniorities?: string[] | null;
  headcount?: string | null;
  keywords?: string | null;
  technologies?: string[] | null;
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
 *  waere die Anfrage "alle Menschen mit verifizierter Adresse" -- der Worker
 *  weist das ab, und der Zaehler soll gar nicht erst danach fragen. */
export function hasAnyApolloFilter(filters: ApolloFilters): boolean {
  return (
    commaList(filters.person_titles).length > 0 ||
    (filters.apollo_locations?.length ?? 0) > 0 ||
    commaList(filters.keywords).length > 0 ||
    employeeRange(filters.headcount) !== null ||
    (filters.technologies?.length ?? 0) > 0
  );
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
  return body;
}
