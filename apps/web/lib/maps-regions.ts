// Laender-Abdeckung fuer die Maps-Suche: Staedtelisten und die Mengenlehre
// dahinter ("wie viele Staedte brauche ich fuer 500 Leads").
//
// ═══════════════════════════════════════════════════════════════════════
// DIESE LISTEN SIND KURIERT, NICHT GEMESSEN
// ═══════════════════════════════════════════════════════════════════════
//
// Anders als APOLLO_KEYWORD_GROUPS oder APOLLO_MARKET_SEGMENTS, wo jeder
// Eintrag vor der Aufnahme gegen die echte API gehalten wurde, steht hinter
// diesen Staedten KEINE Messung. Sie sind nach Einwohnerzahl und
// wirtschaftlicher Bedeutung von Hand ausgewaehlt (Stand 2026-08-16). Niemand
// hat geprueft, wie viele Firmen einer bestimmten Nische Google Maps pro Stadt
// tatsaechlich kennt; eine kleine Stadt weiter unten in der Liste kann fuer
// eine schmale Nische leer ausgehen. Genau deshalb rechnet planCountryCoverage
// unten konservativ und verspricht keine Zahl, sondern schaetzt sie.
//
// Die REIHENFOLGE ist Teil der Aussage: planCountryCoverage nimmt immer die
// ersten n Staedte. Oben steht deshalb, was am meisten hergibt. Wer die Liste
// erweitert, haengt hinten an, statt in der Mitte einzufuegen.
//
// ═══════════════════════════════════════════════════════════════════════
// WARUM NUR DIESE VIER LAENDER
// ═══════════════════════════════════════════════════════════════════════
//
// Keine technische Grenze, sondern eine bewusste Auswahl: B2B-Kaltakquise per
// E-Mail ist in Deutschland/Oesterreich deutlich strenger geregelt (UWG § 7:
// Einwilligung noetig, auch gegenueber Unternehmen) als in den vier Laendern
// hier. Ein groesserer, ungefilterter Laenderkatalog wuerde Nutzer in genau
// die Faelle fuehren, die man ihnen nicht anbieten sollte. Einordnung fuer
// Entwickler, die das pflegen. Keine Rechtsberatung, im Zweifel fragt der
// Kunde seinen Anwalt.
//
// Wer ein Land ergaenzen will, klaert vorher diese Einordnung, nicht nur die
// Staedteliste.

/** Die vier unterstuetzten Laender. Bewusst ein enger Typ und kein string:
 *  ein Land ohne Staedteliste waere ein Formular, das still nichts tut. */
export type MapsRegionCode = "NL" | "BE" | "GB" | "US";

export type MapsRegion = {
  code: MapsRegionCode;
  /**
   * Wird beim Bauen der Suchzeile an jeden Stadtnamen gehaengt. Der Worker
   * geokodiert searches.location als freien Text (siehe geocode() in
   * worker/pipelines/get_businesses.py): "Birmingham" allein waere zwischen
   * England und Alabama nicht entscheidbar, "Charleroi" zwischen Belgien und
   * Pennsylvania. Der Zusatz macht die Anfrage eindeutig.
   */
  geocodeSuffix: string;
  /** Ortsnamen in Landessprache bzw. englischer Standardschreibweise. Deutsche
   *  Exonyme (Bruessel, Luettich) waeren fuer eine Geocoding-Anfrage die
   *  ungewoehnlichere Variante, deshalb Brussels/Liege. */
  cities: string[];
};

export const MAPS_REGIONS: MapsRegion[] = [
  {
    // Recht: B2B-Kaltakquise an Firmenadressen unter "legitimate interest"
    // (DSGVO Art. 6 Abs. 1 lit. f) bzw. der Ausnahme fuer Unternehmen im
    // niederlaendischen Telecomwet vergleichsweise unproblematisch.
    code: "NL",
    geocodeSuffix: "Netherlands",
    cities: [
      "Amsterdam", "Rotterdam", "Utrecht", "Den Haag", "Eindhoven", "Tilburg",
      "Groningen", "Breda", "Nijmegen", "Arnhem", "Zwolle", "Delft", "Alkmaar",
      "Amersfoort", "'s-Hertogenbosch",
    ],
  },
  {
    // Recht: wie NL, Firmenadressen unter "legitimate interest", die
    // belgische Opt-out-Regel gilt fuer natuerliche Personen.
    code: "BE",
    geocodeSuffix: "Belgium",
    cities: [
      "Antwerpen", "Gent", "Brussels", "Leuven", "Brugge", "Liege", "Mechelen",
      "Hasselt", "Charleroi",
    ],
  },
  {
    // Recht: PECR nimmt "corporate subscribers" (Ltd, PLC, LLP) ausdruecklich
    // von der Einwilligungspflicht aus; ein Opt-out-Hinweis bleibt Pflicht.
    // Einzelunternehmer und Personengesellschaften fallen NICHT darunter.
    code: "GB",
    geocodeSuffix: "United Kingdom",
    cities: [
      "London", "Manchester", "Birmingham", "Leeds", "Glasgow", "Edinburgh",
      "Bristol", "Liverpool", "Sheffield", "Newcastle upon Tyne",
    ],
  },
  {
    // Recht: CAN-SPAM ist Opt-out-basiert, Kaltakquise ist zulaessig, solange
    // Absender und Postanschrift stimmen und ein Abmeldeweg existiert (den
    // deckt api/unsubscribe ab). Deshalb unproblematisch.
    //
    // Staedteauswahl: Top-Einwohnerzahlen, ergaenzt um Wirtschaftszentren, die
    // rein nach Einwohnern durchgefallen waeren (San Francisco, Seattle,
    // Boston, Atlanta): fuer B2B-Nischen zaehlt die Firmendichte mehr als
    // die Einwohnerzahl.
    code: "US",
    geocodeSuffix: "USA",
    cities: [
      "New York", "Los Angeles", "Chicago", "Houston", "Dallas", "Phoenix",
      "Philadelphia", "San Antonio", "San Diego", "Austin", "San Jose",
      "San Francisco", "Seattle", "Boston", "Atlanta",
    ],
  },
];

/**
 * Konservativ angesetzte Leads je Nische×Stadt-Kombination.
 *
 * Das theoretische Maximum liegt bei 20 (MAPS_MAX_TARGET_EMAILS: 100
 * durchsuchte Firmen bei ~20% Trefferquote fuer E-Mail-Funde). Die Planung
 * rechnet bewusst darunter, aus demselben Grund wie estimateRawResults im
 * Formular: lieber eine Stadt zu viel ansetzen als dem Nutzer eine Zielzahl
 * versprechen, die die Suche nicht einloest. Nicht gemessen: eine Nische
 * kann in einer kleineren Stadt auch nur drei Treffer hergeben.
 */
export const LEADS_PER_COMBINATION = 15;

/** Ziel-Leads pro Teilsuche im Abdeckungs-Modus. Entspricht dem Maximum des
 *  Feldes "Ziel: Leads mit E-Mail" im manuellen Modus; jede Teilsuche laeuft
 *  hier voll aus, die Steuerung passiert ueber die Anzahl der Staedte. */
export const MAPS_MAX_TARGET_EMAILS = 20;

/** Deckel fuer durchsuchte Firmen pro einzelner Suche. Lag bis zum 2026-08-16
 *  im Formular; steht hier, weil die Vorschau im Abdeckungs-Modus damit
 *  rechnet und zwei Kopien auseinanderlaufen wuerden. */
export const MAX_RAW_RESULTS = 100;

/**
 * Sicherheitsgrenze fuer den Abdeckungs-Modus: Kombinationen pro Absenden.
 *
 * Deutlich hoeher als MAX_FANOUT (20) bei manueller Eingabe: der Sinn des
 * Modus ist ja gerade, grosse Mengen ohne Abtippen abzudecken. Trotzdem
 * begrenzt: eine Produktentscheidung, keine technische Schranke. Der Nutzer
 * soll nach einer Tranche sehen koennen, was seine Nische tatsaechlich
 * hergibt, bevor er die naechste startet. Die Warteschlange selbst haelt das
 * auch mehr aus (der Worker holt Jobs seriell alle 5s ab), aber eine
 * danebengegangene Nische kostet dann 60 statt 600 Suchen an Credits.
 */
export const MAX_COUNTRY_FANOUT = 60;

/** Land zum Code, oder undefined. */
export function regionFor(code: string): MapsRegion | undefined {
  return MAPS_REGIONS.find((r) => r.code === code);
}

/**
 * Warum die Planung nicht die volle Zielzahl erreicht.
 *
 *   ok            alles erreichbar
 *   no_country    kein/unbekanntes Land gewaehlt
 *   no_niche      keine Nische eingetippt
 *   city_limit    die Staedteliste des Landes ist ausgeschoepft
 *   fanout_limit  MAX_COUNTRY_FANOUT bremst, in Tranchen weitermachen
 */
export type CoverageLimit = "ok" | "no_country" | "no_niche" | "city_limit" | "fanout_limit";

export type CoveragePlan = {
  /** Stadtnamen wie in der Liste, fuer die Anzeige. */
  cities: string[];
  /** Dieselben Staedte mit Landeszusatz: das, was in searches.location geht. */
  locations: string[];
  nicheCount: number;
  /** Staedte, die rechnerisch noetig waeren (ungedeckelt). */
  citiesNeeded: number;
  /** Staedte, die das Land ueberhaupt anbietet. */
  citiesAvailable: number;
  combinations: number;
  /** Firmen, die insgesamt durchsucht werden (Obergrenze). */
  scannedCompanies: number;
  /** Konservative Schaetzung der Leads, die dabei herauskommen. */
  estimatedLeads: number;
  /** true, wenn estimatedLeads unter der Zielzahl liegt. */
  shortfall: boolean;
  limit: CoverageLimit;
};

const EMPTY_PLAN: Omit<CoveragePlan, "limit" | "nicheCount" | "citiesAvailable"> = {
  cities: [],
  locations: [],
  citiesNeeded: 0,
  combinations: 0,
  scannedCompanies: 0,
  estimatedLeads: 0,
  shortfall: true,
};

/**
 * Aus Land + Nischen + Zielzahl die konkrete Staedteauswahl bauen.
 *
 * Rein rechnend, ohne Netz: das Ergebnis ist die Vorschau UND die Grundlage
 * der eingefuegten Zeilen. Wuerde die Vorschau anders rechnen als das
 * Absenden, waere die angezeigte Zahl eine Zusage, die die Suche nicht
 * einloest; derselbe Grund, aus dem der Apollo-Zaehler dasselbe Filterobjekt
 * schickt wie der Worker.
 *
 * Erfindet nie Staedte: reicht die Liste nicht, sagt limit/shortfall das, und
 * der Aufrufer zeigt es an.
 */
export function planCountryCoverage(input: {
  country: string;
  niches: string[];
  targetLeads: number;
  /** Nur fuer Tests/Sonderfaelle; sonst MAX_COUNTRY_FANOUT. */
  maxCombinations?: number;
}): CoveragePlan {
  const region = regionFor(input.country);
  // Nischen defensiv normalisieren: der Aufrufer nutzt zwar parseList, aber
  // diese Funktion ist auch die, gegen die getestet wird.
  const niches = Array.from(
    new Set(input.niches.map((n) => n.trim()).filter(Boolean))
  );
  const nicheCount = niches.length;
  const citiesAvailable = region?.cities.length ?? 0;

  if (!region) return { ...EMPTY_PLAN, nicheCount, citiesAvailable, limit: "no_country" };
  if (nicheCount === 0) return { ...EMPTY_PLAN, nicheCount, citiesAvailable, limit: "no_niche" };

  const target = Math.max(1, Math.floor(input.targetLeads || 0));
  const maxCombinations = input.maxCombinations ?? MAX_COUNTRY_FANOUT;

  const citiesNeeded = Math.ceil(target / (LEADS_PER_COMBINATION * nicheCount));
  const citiesByFanout = Math.floor(maxCombinations / nicheCount);

  // Mehr Nischen als Kombinationen erlaubt sind: dann geht selbst eine
  // einzige Stadt nicht mehr auf. Ehrlicher Abbruch statt einer Auswahl, die
  // die Haelfte der Nischen stillschweigend weglaesst.
  if (citiesByFanout < 1) {
    return { ...EMPTY_PLAN, nicheCount, citiesAvailable, citiesNeeded, limit: "fanout_limit" };
  }

  const cityCount = Math.min(citiesNeeded, citiesAvailable, citiesByFanout);
  const cities = region.cities.slice(0, cityCount);
  const combinations = nicheCount * cityCount;
  const estimatedLeads = combinations * LEADS_PER_COMBINATION;

  let limit: CoverageLimit = "ok";
  if (cityCount < citiesNeeded) {
    // Welche der beiden Schranken zuerst gegriffen hat; danach richtet sich,
    // was dem Nutzer zu tun bleibt (anderes Land vs. zweite Tranche).
    limit = citiesByFanout < citiesAvailable ? "fanout_limit" : "city_limit";
  }

  return {
    cities,
    locations: cities.map((c) => `${c}, ${region.geocodeSuffix}`),
    nicheCount,
    citiesNeeded,
    citiesAvailable,
    combinations,
    scannedCompanies: combinations * MAX_RAW_RESULTS,
    estimatedLeads,
    shortfall: estimatedLeads < target,
    limit,
  };
}
