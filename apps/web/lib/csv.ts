// Minimaler, abhaengigkeitsfreier CSV-Parser fuer den Instantly-Bulk-Mailbox-
// Upload (siehe app/instantly/mailboxes/mailboxes-panel.tsx). Bewusst kein externes
// Paket (papaparse etc.) fuer so eine kleine, gut abgrenzbare Aufgabe;
// haelt die Bundle-Groesse und die Supply-Chain-Flaeche klein.
//
// Unterstuetzt: Komma-getrennt, doppelte Anfuehrungszeichen als Feld-Quoting
// ("a,b" / ""-Escaping fuer Anfuehrungszeichen im Feld), CRLF und LF.

/** Parst rohen CSV-Text in eine Matrix aus Strings (eine Zeile = ein Array). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalisiere Zeilenenden, damit \r nicht als eigenes Zeichen durchrutscht.
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Letztes Feld/Zeile (Datei endet ohne abschliessenden Newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * Parst CSV-Text mit Headerzeile in Objekte, Keys = Header (lowercase,
 * getrimmt). Reihenfolge der Spalten ist egal, unbekannte Spalten werden
 * durchgereicht (der Aufrufer entscheidet, was er davon nutzt).
 */
export function parseCsvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
}
