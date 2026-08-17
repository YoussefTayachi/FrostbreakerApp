// Parsing fuer die Blockliste (app/blocklist/page.tsx). Eigene Datei statt
// inline in der Seite, damit die Logik ohne React/DOM testbar ist — genau
// hier sass zuvor der Bug, der ganze Fliesstext-Absaetze als "Domain"
// gespeichert hat.

// Ein Domain-Label besteht aus alphanumerischen Zeichen mit optionalen
// Bindestrichen in der Mitte, mindestens zwei Labels durch Punkte getrennt.
// Ohne diese Pruefung reichte "enthaelt einen Punkt" als Domain-Erkennung --
// damit landete auch mal ein ganzer, versehentlich eingefuegter Website-Text-
// Absatz woertlich als "Domain" in der Sperrliste, sobald irgendwo eine
// Abkuerzung mit Punkt vorkam. Echte Domains haben nie Leerzeichen.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function parseInput(text: string): { emails: string[]; domains: string[] } {
  const tokens = text
    .split(/[\n,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const t of tokens) {
    if (t.includes("@")) {
      // CSV-Zeilen wie "Max;max@firma.de;..." -> E-Mail herausfischen
      const match = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (match) emails.add(match[0]);
    } else {
      const d = t.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      if (DOMAIN_RE.test(d) && d.length <= 253) domains.add(d);
    }
  }
  return { emails: [...emails], domains: [...domains] };
}
