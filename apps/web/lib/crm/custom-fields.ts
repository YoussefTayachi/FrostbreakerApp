/**
 * Eigene Felder: Typen, Schluesselbildung und Wertepruefung.
 *
 * Die Werte liegen als jsonb am Objekt (Migration 0067), nicht in einer
 * eigenen Wertetabelle. Das heisst: die Datenbank prueft sie NICHT. Ein
 * Zahlenfeld, in dem "abc" steht, faellt dort nicht auf — es faellt auf,
 * wenn jemand danach sortiert oder summiert.
 *
 * Deshalb sitzt die Pruefung hier, als reine Funktion mit Tests, und wird an
 * genau einer Stelle aufgerufen (beim Speichern). Eine zweite Kopie in der
 * Oberflaeche waere die uebliche Art, wie solche Regeln auseinanderlaufen.
 */

export const FIELD_TYPES = ["text", "number", "date", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_ENTITIES = ["contact", "business", "deal"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export type CustomFieldDef = {
  id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  position: number;
};

/** Werte eines Objekts. Immer ein Objekt, nie null (Vorgabe in der DB). */
export type CustomValues = Record<string, string | number | null>;

/**
 * Aus einer Beschriftung einen technischen Schluessel bilden.
 *
 * Der Schluessel ist unveraenderlich, das Label nicht — wer "Branche" spaeter
 * in "Wirtschaftszweig" umbenennt, soll nicht die vorhandenen Werte verlieren.
 * Deshalb wird er einmal beim Anlegen erzeugt und danach nie wieder berechnet.
 *
 * Muss zum CHECK in Migration 0067 passen: ^[a-z][a-z0-9_]{0,39}$
 */
export function keyFromLabel(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    // Alles andere zu Unterstrichen, dann zusammenfassen und trimmen.
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  // Rueckfall VOR dem Voranstellen pruefen: bleibt von der Beschriftung nichts
  // uebrig ("!!!"), ergaebe das Voranstellen sonst den Schluessel "f_" — der
  // erfuellt zwar den Constraint, sagt aber nichts.
  if (!base) return "feld";
  // Der Constraint verlangt einen Buchstaben am Anfang: ein Feld namens "2024"
  // waere sonst nicht anlegbar.
  const withLetter = /^[a-z]/.test(base) ? base : "f_" + base;
  return withLetter.slice(0, 40);
}

/** Freien Schluessel finden, wenn der naheliegende schon vergeben ist. */
export function uniqueKey(label: string, taken: readonly string[]): string {
  const base = keyFromLabel(label);
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    // Auf 40 Zeichen kuerzen, BEVOR der Zaehler drankommt — sonst faellt er
    // bei einem langen Label wieder weg und die Kollision bleibt.
    const candidate = base.slice(0, 37) + "_" + i;
    if (!taken.includes(candidate)) return candidate;
  }
  return base + "_" + Date.now();
}

/**
 * Eine Eingabe auf den Typ des Feldes bringen.
 *
 * Gibt entweder den bereinigten Wert zurueck oder einen Fehlergrund. Leere
 * Eingaben ergeben null (= Feld nicht gesetzt) und sind nie ein Fehler: ein
 * eigenes Feld ist eine Zusatzangabe, keine Pflicht.
 */
export function coerceValue(
  def: Pick<CustomFieldDef, "field_type" | "options">,
  raw: string
): { value: string | number | null } | { error: "not_a_number" | "not_a_date" | "not_an_option" } {
  const text = raw.trim();
  if (!text) return { value: null };

  switch (def.field_type) {
    case "number": {
      // Komma als Dezimaltrennzeichen zulassen — in einer deutschsprachigen
      // Oberflaeche tippt niemand einen Punkt.
      const n = Number(text.replace(",", "."));
      return Number.isFinite(n) ? { value: n } : { error: "not_a_number" };
    }
    case "date": {
      // Nur ISO, weil das Feld ein <input type="date"> ist. Alles andere
      // waere Rateei ueber Tag/Monat-Reihenfolge.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: "not_a_date" };
      return Number.isNaN(new Date(text).getTime()) ? { error: "not_a_date" } : { value: text };
    }
    case "select":
      return def.options.includes(text) ? { value: text } : { error: "not_an_option" };
    case "text":
      return { value: text };
  }
}

/**
 * Werte fuer die Anzeige aufbereiten.
 *
 * Felder, deren Definition inzwischen geloescht wurde, tauchen hier NICHT auf.
 * Der Wert bleibt im jsonb liegen (siehe Entwurfsentscheidung in Migration
 * 0067) — er soll nur nicht ohne Beschriftung angezeigt werden, denn eine
 * Zahl ohne Feldnamen ist keine Information.
 */
export function visibleValues(
  defs: CustomFieldDef[],
  values: CustomValues
): { def: CustomFieldDef; value: string | number | null }[] {
  return defs
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((def) => ({ def, value: values?.[def.key] ?? null }));
}

/** Werte ohne zugehoerige Definition — fuer einen Hinweis beim Aufraeumen. */
export function orphanedKeys(defs: CustomFieldDef[], values: CustomValues): string[] {
  const known = new Set(defs.map((d) => d.key));
  return Object.keys(values ?? {}).filter((k) => !known.has(k));
}
