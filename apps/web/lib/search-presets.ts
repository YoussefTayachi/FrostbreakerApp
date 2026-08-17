import { apolloCountryCodes, APOLLO_DEFAULT_SENIORITIES } from "./apollo-query";
import { technologyIdsFromSlugs } from "./technologies";
import type { ProspeoFilters } from "./prospeo-query";

/**
 * Suchvorlagen: das Format und der Weg von einer gelaufenen Suche zurueck ins
 * Formular.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DIESE DATEI GIBT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein Kunde am 2026-08-10: "Ich habe einen Test gemacht, der gut gelaufen ist.
 * Top waere, wenn man die Vorlage gleich von diesem Interface aus speichern
 * koennte: dann muesste ich nicht nochmal ueberlegen, was hatte ich nochmal
 * ausgewaehlt."
 *
 * Vorlagen liessen sich bis dahin nur VOR einer Suche anlegen, im Formular auf
 * dem Dashboard. Die naheliegende Stelle (die fertige Suche, von der man
 * gerade weiss, dass sie funktioniert hat) ging nicht, weil die beiden
 * Seiten dieselben Werte in unterschiedlicher Schreibweise fuehren:
 *
 *   Formular/Vorlage   personTitles, apolloCountries (ISO-Codes),
 *                      technologies (interne IDs)
 *   searches.filters   person_titles, apollo_locations (Laendernamen),
 *                      technologies (Slugs des Anbieters)
 *
 * searchRowToPresetConfig ist genau diese Uebersetzung.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS DABEI NICHT ZURUECKKOMMT, UND WARUM DAS IN ORDNUNG IST
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. Bei Apollo, Corporate und Prospeo ist searches.query KEINE Nutzereingabe,
 *    sondern eine beim Anlegen erzeugte Ueberschrift ("keywords · Position").
 *    Die Vorlage nimmt ihre Werte deshalb aus filters, nicht aus dieser
 *    Spalte. Nur im Maps-Modus ist query das, was der Nutzer getippt hat.
 *
 * 2. Eine Maps-Suche mit mehreren Begriffen oder Orten erzeugt PRO Kombination
 *    eine eigene searches-Zeile (Kreuzprodukt, siehe new-search-form.tsx). Aus
 *    einer solchen Zeile entsteht die Vorlage fuer genau diese eine
 *    Kombination, nicht die urspruengliche Kommaliste. Das ist die richtige
 *    Auslegung von "speichere mir DIESE Suche".
 *
 *    Seit Migration 0096 haengen diese Zeilen an einer Gruppen-Huelle, und die
 *    ist es auch, die man auf der Suchen-Seite anklickt. Deren query/location
 *    sind fuer das Auge zusammengefasst ("15 Orte") und als Vorlage
 *    unbrauchbar; deshalb legt das Formular die urspruenglichen Kommalisten
 *    zusaetzlich als group_queries/group_locations in filters ab, und von dort
 *    holt sie diese Uebersetzung zurueck. "Suche wiederholen" auf einer
 *    gebuendelten Suche fuellt das Formular damit wieder genau so, wie es
 *    abgeschickt wurde.
 *
 * 3. Technologien ohne Slug beim jeweiligen Anbieter fehlen. Sie fehlen aber
 *    schon in der Suche selbst; resolveTechnologies hat sie beim Anlegen
 *    fallen lassen. Hier geht nichts verloren, was vorher da gewesen waere.
 */

export type SearchMode = "maps" | "corporate" | "apollo" | "prospeo";

/**
 * Der Inhalt von search_presets.config: eine Momentaufnahme des Formulars.
 *
 * Lag bis zum 2026-08-10 als Typ `Preset` im Formular selbst. Herausgezogen,
 * weil ihn jetzt zwei Seiten schreiben (Formular und Suchdetail), und zwei
 * Definitionen desselben Formats waeren genau die Sorte Abweichung, die man
 * erst bemerkt, wenn eine Vorlage halb geladen wird.
 *
 * Alle Felder ausser mode sind optional zu behandeln: die Migration haelt
 * ausdruecklich fest, dass die Oberflaeche unbekannte Schluessel ignoriert und
 * aeltere Vorlagen nach neuen Filtern weiter funktionieren muessen.
 */
export type PresetConfig = {
  mode: SearchMode;
  query: string;
  location: string;
  radius: number;
  targetEmails: number;
  /** Vorlagen von vor der Ziel-E-Mail-Umstellung hatten die rohe Firmenzahl. */
  maxResults?: number;
  noWebsite: boolean;
  maxRating: number | "";
  industry: string;
  city: string;
  state?: string;
  country: string;
  headcount: string;
  keywords: string;
  personTitles?: string;
  apolloCountries?: string[];
  apolloSeniorities?: string[];
  /** Interne IDs aus lib/technologies.ts, nicht die Slugs der Anbieter. */
  technologies?: string[];
  marketSegments?: string[];
  /**
   * Prospeos Filter als ganzes Objekt: so, wie sie auch in searches.filters
   * liegen.
   *
   * Fehlten bis zum 2026-08-10 komplett: savePreset schrieb `mode: "prospeo"`,
   * aber kein einziges Prospeo-Feld. Wer eine solche Vorlage lud, bekam ein
   * leeres Formular im richtigen Modus und keinen Hinweis darauf, dass etwas
   * fehlt. Aufgefallen erst, als die Vorlage auch aus einer fertigen Suche
   * entstehen sollte.
   */
  prospeoFilters?: ProspeoFilters;
};

/** Die Spalten einer searches-Zeile, die eine Vorlage braucht. */
export type SearchRowForPreset = {
  source: string | null;
  query: string | null;
  location: string | null;
  radius_m?: number | null;
  max_results?: number | null;
  target_email_count?: number | null;
  filters?: Record<string, unknown> | null;
};

/** Vorgaben des Formulars. Eine Vorlage muss sie mitbringen, sonst laedt sie
 *  leere Felder ueber sinnvolle Voreinstellungen. */
const DEFAULTS = {
  radius: 10000,
  targetEmails: 10,
  country: "DE",
} as const;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isMode(value: unknown): value is SearchMode {
  return value === "maps" || value === "corporate" || value === "apollo" || value === "prospeo";
}

/**
 * Aus einer gelaufenen Suche die Vorlage bauen, die sie erzeugt haette.
 *
 * Bewusst nachsichtig gegenueber dem, was in filters steht: die Spalte ist
 * jsonb und enthaelt je nach Alter der Suche unterschiedliche Schluessel. Ein
 * fehlender Wert wird zur Formularvorgabe, nicht zu undefined; eine Vorlage,
 * die beim Laden Felder leer raeumt, waere schlimmer als gar keine.
 */
export function searchRowToPresetConfig(row: SearchRowForPreset): PresetConfig {
  const mode: SearchMode = isMode(row.source) ? row.source : "maps";
  const f = row.filters ?? {};
  // Bei einer gebuendelten Suche ist target_email_count die SUMME ueber alle
  // Teilsuchen (bis 1200). Ins Formularfeld gehoert die Zahl pro Teilsuche:
  // das Feld ist bei 20 gedeckelt, und ein Wert darueber macht es ungueltig,
  // ohne dass jemand ihn getippt haette.
  const ziel =
    (typeof f.group_target_email_count === "number" ? f.group_target_email_count : null) ??
    row.target_email_count ??
    row.max_results ??
    DEFAULTS.targetEmails;

  // Gebuendelte Mehrfach-Suche: die Kommalisten, wie sie getippt wurden. In
  // der Gruppen-Zeile selbst stehen zusammengefasste Texte fuers Auge.
  const gruppenNischen = strList(f.group_queries);
  const gruppenOrte = strList(f.group_locations);

  const basis: PresetConfig = {
    mode,
    // Nur im Maps-Modus ist das die Eingabe des Nutzers, siehe Kopfkommentar.
    query: mode === "maps" ? (gruppenNischen.join(", ") || str(row.query)) : "",
    location: mode === "maps" ? (gruppenOrte.join(", ") || str(row.location)) : "",
    radius: row.radius_m ?? DEFAULTS.radius,
    targetEmails: ziel,
    noWebsite: f.pain_point_no_website === true,
    maxRating: typeof f.pain_point_max_rating === "number" ? f.pain_point_max_rating : "",
    industry: "",
    city: "",
    state: "",
    country: DEFAULTS.country,
    headcount: "",
    keywords: "",
  };

  if (mode === "apollo") {
    return {
      ...basis,
      personTitles: str(f.person_titles),
      apolloCountries: apolloCountryCodes(strList(f.apollo_locations)),
      // Leere Senioritaeten waeren eine Suche quer durch alle Hierarchiestufen,
      // dieselbe Rueckfallregel wie im Zaehler (validSeniorities).
      apolloSeniorities:
        strList(f.apollo_seniorities).length > 0
          ? strList(f.apollo_seniorities)
          : [...APOLLO_DEFAULT_SENIORITIES],
      headcount: str(f.headcount),
      keywords: str(f.keywords),
      technologies: technologyIdsFromSlugs(strList(f.technologies), "apollo"),
      marketSegments: strList(f.market_segments),
    };
  }

  if (mode === "corporate") {
    return {
      ...basis,
      industry: str(f.industry),
      city: str(f.city),
      state: str(f.state),
      country: str(f.country) || DEFAULTS.country,
      headcount: str(f.headcount),
      keywords: str(f.keywords),
      technologies: technologyIdsFromSlugs(strList(f.technologies), "hunter"),
    };
  }

  if (mode === "prospeo") {
    // Unveraendert uebernehmen: das Objekt in searches.filters IST das
    // Prospeo-Filterobjekt des Formulars (siehe new-search-form.tsx), es gibt
    // hier also nichts zu uebersetzen, und jede Umformung waere eine
    // Gelegenheit, ein Feld zu verlieren.
    return { ...basis, prospeoFilters: (row.filters ?? {}) as ProspeoFilters };
  }

  return basis;
}
