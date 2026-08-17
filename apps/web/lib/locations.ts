// Staedte-Vorschlaege fuer die Corporate-Suche (Hunter Discover).
//
// Warum eine eigene Liste statt Hunters Werten: Hunter veroeffentlicht fuer
// Branchen (industries.json) und Technologien (technologies.json) je eine
// Referenzdatei, fuer Staedte aber NICHT, und einen Autocomplete-Endpunkt
// gibt es in der dokumentierten API auch nicht (Stand 2026-07-30). Verifizierbar
// sind laut Doku nur country (ISO 3166-1 alpha-2), state (US-Kuerzel) und
// continent.
//
// Konsequenz fuer die UI: Diese Liste ist bewusst eine VORSCHLAGSLISTE
// (<datalist>), kein hartes <select>. Ein gesperrtes Dropdown wuerde
// vortaeuschen, jeder Eintrag sei garantiert gueltig; das kann hier niemand
// garantieren, und schlimmer noch: eine von Hunter durchaus indizierte Stadt,
// die hier fehlt, waere dann gar nicht mehr suchbar. So bekommt man die
// bequeme Auswahl und behaelt den Ausweg.
//
// Der eigentliche Fehlerschutz steckt in US_CITY_STATE: Hunter lehnt eine
// US-Stadt ohne Bundesstaat ab, und den richtigen Staat zu einer Stadt zu
// wissen ist genau die Kopplung, die man von Hand falsch macht. Wird eine
// bekannte US-Stadt gewaehlt, setzt das Formular den Bundesstaat automatisch.

export const CITY_SUGGESTIONS: Record<string, string[]> = {
  US: [
    "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio",
    "San Diego", "Dallas", "Austin", "San Jose", "Jacksonville", "Fort Worth", "Columbus",
    "Charlotte", "San Francisco", "Indianapolis", "Seattle", "Denver", "Boston", "Nashville",
    "Portland", "Las Vegas", "Detroit", "Memphis", "Louisville", "Baltimore", "Milwaukee",
    "Atlanta", "Miami", "Raleigh", "Minneapolis", "Tampa", "New Orleans", "Cleveland",
    "Pittsburgh", "Cincinnati", "St. Louis", "Kansas City", "Salt Lake City", "Orlando",
    "Sacramento", "San Diego", "Oakland", "Brooklyn", "Jersey City", "Cambridge", "Palo Alto",
    "Santa Monica", "Boulder",
  ],
  DE: [
    "Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Dusseldorf", "Leipzig",
    "Dortmund", "Essen", "Bremen", "Dresden", "Hanover", "Nuremberg", "Duisburg", "Bochum",
    "Wuppertal", "Bielefeld", "Bonn", "Munster", "Karlsruhe", "Mannheim", "Augsburg", "Wiesbaden",
    "Freiburg", "Heidelberg", "Darmstadt", "Potsdam",
  ],
  AT: [
    "Vienna", "Graz", "Linz", "Salzburg", "Innsbruck", "Klagenfurt", "Villach", "Wels",
    "St. Polten", "Dornbirn", "Wiener Neustadt", "Steyr", "Bregenz", "Leoben", "Baden",
  ],
  CH: [
    "Zurich", "Geneva", "Basel", "Bern", "Lausanne", "Winterthur", "Lucerne", "St. Gallen",
    "Lugano", "Zug", "Biel", "Thun", "Fribourg", "Schaffhausen", "Chur",
  ],
  GB: [
    "London", "Manchester", "Birmingham", "Leeds", "Glasgow", "Liverpool", "Bristol", "Sheffield",
    "Edinburgh", "Cardiff", "Nottingham", "Newcastle upon Tyne", "Leicester", "Belfast",
    "Brighton", "Cambridge", "Oxford", "Reading", "Southampton", "Aberdeen",
  ],
  NL: [
    "Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven", "Groningen", "Tilburg",
    "Almere", "Breda", "Nijmegen", "Haarlem", "Arnhem", "Delft", "Leiden", "Maastricht",
  ],
  FR: [
    "Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Montpellier", "Strasbourg",
    "Bordeaux", "Lille", "Rennes", "Toulon", "Grenoble", "Dijon", "Angers", "Nimes",
  ],
  IT: [
    "Rome", "Milan", "Naples", "Turin", "Palermo", "Genoa", "Bologna", "Florence", "Bari",
    "Catania", "Venice", "Verona", "Padua", "Trieste", "Brescia", "Parma",
  ],
  ES: [
    "Madrid", "Barcelona", "Valencia", "Seville", "Zaragoza", "Malaga", "Murcia", "Palma",
    "Las Palmas", "Bilbao", "Alicante", "Cordoba", "Valladolid", "Vigo", "Granada",
  ],
};

/**
 * Bundesstaat je US-Stadt. Hunter lehnt eine US-Stadt ohne state ab, und die
 * Zuordnung Stadt -> Bundesstaat ist genau die Stelle, an der man sich von
 * Hand vertut. Mehrdeutige Namen (z.B. "Springfield") stehen bewusst gar nicht
 * erst in CITY_SUGGESTIONS, damit hier nichts geraten werden muss.
 */
export const US_CITY_STATE: Record<string, string> = {
  "New York": "NY", "Brooklyn": "NY", "Los Angeles": "CA", "San Diego": "CA",
  "San Francisco": "CA", "San Jose": "CA", "Sacramento": "CA", "Oakland": "CA",
  "Palo Alto": "CA", "Santa Monica": "CA", "Chicago": "IL", "Houston": "TX",
  "San Antonio": "TX", "Dallas": "TX", "Austin": "TX", "Fort Worth": "TX",
  "Phoenix": "AZ", "Philadelphia": "PA", "Pittsburgh": "PA", "Jacksonville": "FL",
  "Miami": "FL", "Tampa": "FL", "Orlando": "FL", "Columbus": "OH", "Cleveland": "OH",
  "Cincinnati": "OH", "Charlotte": "NC", "Raleigh": "NC", "Indianapolis": "IN",
  "Seattle": "WA", "Denver": "CO", "Boulder": "CO", "Boston": "MA", "Cambridge": "MA",
  "Nashville": "TN", "Memphis": "TN", "Portland": "OR", "Las Vegas": "NV",
  "Detroit": "MI", "Louisville": "KY", "Baltimore": "MD", "Milwaukee": "WI",
  "Atlanta": "GA", "Minneapolis": "MN", "New Orleans": "LA", "St. Louis": "MO",
  "Kansas City": "MO", "Salt Lake City": "UT", "Jersey City": "NJ",
};

/** Vorschlaege fuer ein Land; unbekanntes Land -> keine Vorschlaege, Freitext bleibt moeglich. */
export function citySuggestionsFor(country: string): string[] {
  const list = CITY_SUGGESTIONS[country] ?? [];
  // Duplikate raus (die Rohliste ist handgepflegt) und alphabetisch, damit die
  // Vorschlagsliste im Browser vorhersagbar sortiert ist.
  return Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
}

/**
 * Bundesstaat zu einer eingegebenen US-Stadt, unabhaengig von Gross-/
 * Kleinschreibung und Randleerzeichen ("new york " -> "NY"). Unbekannte Stadt
 * -> null, dann bleibt die manuelle Auswahl stehen.
 */
export function usStateForCity(city: string): string | null {
  const needle = city.trim().toLowerCase();
  if (!needle) return null;
  for (const [name, code] of Object.entries(US_CITY_STATE)) {
    if (name.toLowerCase() === needle) return code;
  }
  return null;
}
