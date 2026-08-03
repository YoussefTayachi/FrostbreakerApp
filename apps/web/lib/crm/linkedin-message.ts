/**
 * Nachrichtenvorlage fuer die LinkedIn-Arbeitsliste.
 *
 * Warum es diese Datei gibt: 214 der 230 Kontakte, die NUR ein LinkedIn-Profil
 * und keine E-Mail-Adresse haben, besitzen bereits einen fertig generierten
 * Icebreaker in businesses.personalization (gemessen am Bestand 2026-08-03).
 * Der Text ist also laengst bezahlt und lag bisher nur nirgends sichtbar. Hier
 * wird er in eine versandfertige Nachricht eingesetzt.
 *
 * Verschickt wird NICHT automatisch. LinkedIn bietet keine API fuer Nachrichten
 * oder Kontaktanfragen an; jede Automatisierung laeuft ueber Browser-Steuerung,
 * verstoesst gegen die Nutzervereinbarung und riskiert die Sperrung des
 * LinkedIn-Kontos -- bei einem verkauften Produkt also die Konten der Kunden.
 * Die App bereitet vor, der Mensch fuegt ein und sendet.
 */

/**
 * Die Platzhalter heissen exakt wie die Merge-Tags der E-Mail-Kampagnen
 * (siehe lib/instantly/campaigns.ts und die Leads, die dort angelegt werden) --
 * wer eine Instantly-Sequenz geschrieben hat, muss hier nichts Neues lernen.
 */
export const LINKEDIN_PLACEHOLDERS = ["firstName", "companyName", "personalization"] as const;
export type LinkedInPlaceholder = (typeof LINKEDIN_PLACEHOLDERS)[number];

/** Fertige Tokens fuer die Einfuegen-Knoepfe, gleiche Reihenfolge wie im Kampagnen-Editor. */
export const LINKEDIN_VARIABLE_TOKENS: Record<LinkedInPlaceholder, string> = {
  firstName: "{{firstName}}",
  companyName: "{{companyName}}",
  personalization: "{{personalization}}",
};

/**
 * Standardvorlage. Bewusst kurz: LinkedIn kuerzt Erstnachrichten in der
 * Vorschau stark ab, und eine Kontaktanfrage mit Notiz ist ohnehin auf 300
 * Zeichen begrenzt. Der Icebreaker steht als eigener Absatz, damit bei den
 * Kontakten ohne Personalisierung nur eine Zeile fehlt statt mitten im Satz
 * eine Luecke zu klaffen -- dieselbe Ueberlegung wie bei den Mail-Vorlagen in
 * docs/KALTAKQUISE-VORLAGEN.md.
 */
export const DEFAULT_LINKEDIN_TEMPLATE_DE = `Hi {{firstName}},

{{personalization}}

Ich baue Software, die Firmen wie {{companyName}} genau die Arbeit abnimmt, die sonst zwischen fünf Tools hängen bleibt. Kein Pitch, ich wollte mich erstmal vernetzen.

Viele Grüße
Youssef`;

export const DEFAULT_LINKEDIN_TEMPLATE_EN = `Hi {{firstName}},

{{personalization}}

I build software that takes the work off companies like {{companyName}} that otherwise gets stuck between five different tools. No pitch, just wanted to connect first.

Best
Youssef`;

export function getDefaultLinkedInTemplate(lang: "de" | "en"): string {
  return lang === "en" ? DEFAULT_LINKEDIN_TEMPLATE_EN : DEFAULT_LINKEDIN_TEMPLATE_DE;
}

export type LinkedInMessageValues = {
  firstName?: string | null;
  companyName?: string | null;
  personalization?: string | null;
};

/**
 * Setzt die Platzhalter ein und raeumt auf, was durch fehlende Werte entsteht.
 *
 * Drei Faelle, die in echten Daten alle vorkommen:
 *
 *   1. Kein Vorname (Apollo liefert bei manchen Treffern nur den Nachnamen).
 *      "Hi ," waere die schlechtestmoegliche erste Zeile, deshalb faellt die
 *      Anrede auf ein neutrales "Hallo" zurueck -- nicht auf einen leeren
 *      String, sonst begaenne die Nachricht mit einem Komma.
 *   2. Keine Personalisierung (16 der 230 reinen LinkedIn-Kontakte). Der
 *      Absatz verschwindet dann komplett, inklusive der Leerzeile darunter --
 *      sonst klaffte eine doppelte Leerzeile mitten in der Nachricht, die man
 *      vor dem Einfuegen von Hand loeschen muesste.
 *   3. Kein Firmenname. Kommt selten vor, ist aber im Satz oft das Subjekt --
 *      hier bleibt bewusst ein neutrales Wort stehen statt einer Luecke.
 */
export function renderLinkedInMessage(template: string, values: LinkedInMessageValues): string {
  const firstName = (values.firstName ?? "").trim();
  const companyName = (values.companyName ?? "").trim();
  const personalization = (values.personalization ?? "").trim();

  let out = template
    .replace(/\{\{\s*firstName\s*\}\}/g, firstName)
    .replace(/\{\{\s*companyName\s*\}\}/g, companyName || "euch")
    .replace(/\{\{\s*personalization\s*\}\}/g, personalization);

  // Fall 1: "Hi ," / "Hallo ," -- entstanden durch den leeren Vornamen.
  if (!firstName) {
    out = out.replace(/^(\s*)(Hi|Hallo|Hey|Guten Tag)\s*,/im, "$1Hallo,");
  }

  return (
    out
      // Fall 2: Die Zeile des fehlenden Icebreakers hinterlaesst eine leere
      // Zeile zwischen zwei Leerzeilen. Drei oder mehr Umbrueche in Folge
      // wieder auf einen Absatz zusammenziehen.
      .replace(/\n{3,}/g, "\n\n")
      // Leerzeichen am Zeilenende entstehen beim Ersetzen und fallen beim
      // Einfuegen in LinkedIn als seltsame Abstaende auf.
      .replace(/[ \t]+$/gm, "")
      .trim()
  );
}

/**
 * Welche Platzhalter stehen in dieser Vorlage, die es gar nicht gibt?
 *
 * Ein Tippfehler wie {{firstname}} (klein geschrieben) bliebe sonst woertlich
 * in der Nachricht stehen und ginge so an den Empfaenger -- genau der Fehler,
 * der in Session 3 schon einmal in einer Mail-Vorlage steckte
 * ({{personalization - e.g., ...}}, siehe docs/KALTAKQUISE-VORLAGEN.md).
 */
export function unknownPlaceholders(template: string): string[] {
  const found = template.match(/\{\{\s*[^}]+\s*\}\}/g) ?? [];
  const known = new Set<string>(LINKEDIN_PLACEHOLDERS);
  const unknown = found
    .map((raw) => raw.replace(/[{}]/g, "").trim())
    .filter((name) => !known.has(name));
  return [...new Set(unknown)];
}

/**
 * Farbige Markierung der Variablen im Vorlagen-Editor.
 *
 * Nutzt denselben Mechanismus wie die Qualitaetspruefung im Kampagnen-Editor
 * (HighlightedTextarea + buildHighlightSegments), nur mit anderer Bedeutung:
 *
 *   info (blau) -- gueltige Variable, wird pro Empfaenger ersetzt
 *   danger (rot) -- Schreibfehler, landet woertlich beim Empfaenger
 *
 * Ohne diese Markierung sieht {{firstName}} im Textfeld genauso aus wie
 * {{firstname}}, und der Unterschied faellt erst dem Empfaenger auf.
 */
export function variableHighlightRanges(
  template: string
): { start: number; end: number; severity: "info" | "danger" }[] {
  const ranges: { start: number; end: number; severity: "info" | "danger" }[] = [];
  const known = new Set<string>(LINKEDIN_PLACEHOLDERS);
  // Bewusst dieselbe Regex wie in unknownPlaceholders, damit "gueltig" hier
  // und "unbekannt" dort nie auseinanderlaufen koennen.
  const pattern = /\{\{\s*[^}]+\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    const name = match[0].replace(/[{}]/g, "").trim();
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      severity: known.has(name) ? "info" : "danger",
    });
  }
  return ranges;
}
