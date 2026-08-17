/**
 * CSV-Import, Zerlegung und Spaltenzuordnung.
 *
 * Der Grund fuer diese Datei: Wer drei Jahre Historie in Pipedrive hat,
 * wechselt nicht ohne sie. Ohne Import ist jede andere Verbesserung fuer einen
 * Umsteiger belanglos — er kaeme mit einem leeren System an.
 *
 * Bewusst ohne Fremdbibliothek. Ein CSV-Parser ist ueberschaubar, solange man
 * die drei Faelle kennt, an denen naive Zerlegung scheitert:
 *
 *   1. Kommas INNERHALB von Anfuehrungszeichen ("Meyer, Anna GmbH")
 *   2. Anfuehrungszeichen im Feld, verdoppelt ("Die ""Alte"" Muehle")
 *   3. Zeilenumbrueche innerhalb eines Feldes (Adressen, Notizen)
 *
 * Alle drei kommen in echten Pipedrive-Exporten vor, und alle drei zerlegen
 * eine Zeile falsch, ohne dass es beim Import auffaellt — man merkt es erst,
 * wenn die Firma "Meyer" heisst und die Adresse " Anna GmbH" lautet.
 */

/** Zerlegt eine CSV-Datei in Zeilen aus Feldern. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Byte Order Mark: Excel schreibt ihn beim Export als UTF-8, und ungefiltert
  // heisst die erste Spalte dann "﻿Name" statt "Name" — die Zuordnung
  // findet sie nie.
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        // Verdoppeltes Anfuehrungszeichen ist ein echtes Zeichen, kein Ende.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // Windows-Zeilenenden: das \n danach erledigt den Umbruch.
    } else {
      field += ch;
    }
  }

  // Letztes Feld bzw. letzte Zeile ohne abschliessenden Umbruch.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Vollstaendig leere Zeilen (etwa am Dateiende) tragen nichts bei.
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/**
 * Trennzeichen erraten.
 *
 * Pipedrive exportiert mit Komma, deutsche Excel-Versionen mit Semikolon.
 * Geraten wird an der KOPFZEILE, weil dort keine Fliesstexte mit Kommas
 * stehen — an einer Datenzeile waere die Zaehlung unzuverlaessig.
 */
export type Delimiter = "," | ";" | "\t";

export function detectDelimiter(text: string): Delimiter {
  const head = text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  const candidates: Delimiter[] = [",", ";", "\t"];
  let best: Delimiter = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = head.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Felder, auf die eine CSV-Spalte gelegt werden kann. */
export const IMPORT_TARGETS = [
  "ignore",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "title",
  "linkedin",
  "company_name",
  "company_website",
] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

/**
 * Spaltenueberschriften den Zielfeldern zuordnen.
 *
 * Die Muster decken Pipedrives eigene Exportnamen ab (deutsch und englisch,
 * beides kommt vor) und die ueblichen Varianten aus Excel-Listen. Was nicht
 * erkannt wird, bleibt 'ignore' — der Nutzer stellt es dann von Hand ein.
 * Falsch raten waere schlimmer als nicht raten: eine E-Mail-Spalte, die
 * versehentlich als Telefonnummer landet, faellt erst beim naechsten Versand
 * auf.
 */
const HEADER_PATTERNS: [RegExp, ImportTarget][] = [
  [/^(vorname|first\s*name|given\s*name)$/i, "first_name"],
  [/^(nachname|last\s*name|surname|family\s*name)$/i, "last_name"],
  [/^(name|person|kontakt|contact|full\s*name)$/i, "full_name"],
  [/e-?mail/i, "email"],
  [/(telefon|phone|mobil|mobile|tel\.?)/i, "phone"],
  [/(position|titel|job\s*title|rolle|role)/i, "title"],
  [/linkedin/i, "linkedin"],
  [/(organisation|organization|firma|company|unternehmen|account)/i, "company_name"],
  [/(website|webseite|url|domain)/i, "company_website"],
];

export function guessTarget(header: string): ImportTarget {
  const h = header.trim();
  if (!h) return "ignore";
  for (const [pattern, target] of HEADER_PATTERNS) {
    if (pattern.test(h)) return target;
  }
  return "ignore";
}

export function guessMapping(headers: string[]): ImportTarget[] {
  const used = new Set<ImportTarget>();
  return headers.map((h) => {
    const guess = guessTarget(h);
    // Jedes Ziel hoechstens einmal: bei "E-Mail" und "E-Mail 2" wuerde sonst
    // die zweite Spalte die erste ueberschreiben.
    if (guess === "ignore" || used.has(guess)) return "ignore";
    used.add(guess);
    return guess;
  });
}

/** Ein aus einer CSV-Zeile aufbereiteter Datensatz. */
export type ImportRow = {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  linkedin: string | null;
  company_name: string | null;
  company_website: string | null;
};

const EMPTY: ImportRow = {
  first_name: null,
  last_name: null,
  full_name: null,
  email: null,
  phone: null,
  title: null,
  linkedin: null,
  company_name: null,
  company_website: null,
};

/**
 * Eine Zeile nach der Zuordnung in einen Datensatz uebersetzen.
 *
 * Ergaenzt dabei, was sich sicher ableiten laesst: fehlt der volle Name, wird
 * er aus Vor- und Nachnamen gebildet, und umgekehrt wird ein voller Name am
 * ERSTEN Leerzeichen geteilt. Nicht am letzten — "Anna Maria Berg" ist
 * haeufiger als ein doppelter Nachname, und bei der Anrede zaehlt der
 * Vorname.
 */
export function toRow(cells: string[], mapping: ImportTarget[]): ImportRow {
  const row: ImportRow = { ...EMPTY };
  mapping.forEach((target, i) => {
    if (target === "ignore") return;
    const value = (cells[i] ?? "").trim();
    if (value) row[target] = value;
  });

  if (!row.full_name && (row.first_name || row.last_name)) {
    row.full_name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  }
  if (row.full_name && !row.first_name && !row.last_name) {
    const at = row.full_name.indexOf(" ");
    if (at > 0) {
      row.first_name = row.full_name.slice(0, at);
      row.last_name = row.full_name.slice(at + 1);
    } else {
      row.first_name = row.full_name;
    }
  }

  if (row.email) row.email = row.email.toLowerCase();
  return row;
}

/** Ohne Firma kein Datensatz: businesses.name ist Pflicht (Migration 0001). */
export function isImportable(row: ImportRow): boolean {
  return Boolean(row.company_name?.trim());
}

export type ImportPlan = {
  /** Zeilen, die angelegt werden koennen. */
  usable: ImportRow[];
  /** Zeilen ohne Firma — ohne sie liesse sich kein Datensatz anlegen. */
  withoutCompany: number;
  /** Adressen, die es im Bestand schon gibt. */
  duplicates: number;
  /** Doppelte Adressen INNERHALB der Datei. */
  duplicatesInFile: number;
};

/**
 * Vorschau: was wuerde der Import tun?
 *
 * Pipedrive zeigt vor dem Import eine Zusammenfassung, und das aus gutem
 * Grund: ein Import laesst sich nicht rueckgaengig machen. Wer vorher sieht,
 * dass 300 von 500 Zeilen Dubletten sind, bricht ab und schaut nach, statt
 * seinen Bestand zu verdoppeln.
 *
 * Dubletten werden ueber die E-Mail-Adresse erkannt. Zeilen ohne Adresse
 * gelten nie als Dublette — zwei Personen ohne Adresse bei derselben Firma
 * koennen zwei verschiedene sein, und ein faelschlich verworfener Kontakt
 * waere schlimmer als ein doppelter.
 */
export function planImport(rows: ImportRow[], existingEmails: readonly string[]): ImportPlan {
  const known = new Set(existingEmails.map((e) => e.toLowerCase()));
  const seenInFile = new Set<string>();
  const usable: ImportRow[] = [];
  let withoutCompany = 0;
  let duplicates = 0;
  let duplicatesInFile = 0;

  for (const row of rows) {
    if (!isImportable(row)) {
      withoutCompany++;
      continue;
    }
    if (row.email) {
      if (known.has(row.email)) {
        duplicates++;
        continue;
      }
      if (seenInFile.has(row.email)) {
        duplicatesInFile++;
        continue;
      }
      seenInFile.add(row.email);
    }
    usable.push(row);
  }

  return { usable, withoutCompany, duplicates, duplicatesInFile };
}
