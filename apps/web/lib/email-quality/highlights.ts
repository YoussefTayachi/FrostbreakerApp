import type { EmailQualityReport, QualityIssue, Severity } from "./types";

// Umrechnung der Befunde in zusammenhaengende, ueberschneidungsfreie
// Textabschnitte fuer die farbige Markierung im Textfeld. Reine
// Bereichsarithmetik, deshalb hier statt in der Komponente: so ist der
// heikle Teil (Ueberlappungen) testbar.

export type HighlightRange = { start: number; end: number; severity: Severity };

export type Highlights = {
  ranges: HighlightRange[];
  /**
   * Der Text, auf dem die Offsets berechnet wurden. Die Analyse laeuft
   * entprellt, das Tippen nicht; ohne diesen Abgleich wuerden die Flaechen
   * fuer den Moment dazwischen um ein paar Zeichen verrutschen und flackern.
   */
  forText: string;
};

export type HighlightSegment = { text: string; severity: Severity | null };

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, danger: 2 };

/** Alle Befunde im Mailtext, die sich auf eine konkrete Stelle beziehen. */
export function bodyHighlightRanges(report: EmailQualityReport): HighlightRange[] {
  const all: QualityIssue[] = [
    ...report.readability.issues,
    ...report.spam.issues,
    ...report.aiSounding.issues,
  ];
  return all
    .filter((i) => i.field === "body" && i.offset !== null)
    .map((i) => ({ start: i.offset!.start, end: i.offset!.end, severity: i.severity }));
}

/**
 * Zerlegt den Text in ueberschneidungsfreie Abschnitte. Bei Ueberlappung
 * gewinnt der engere Bereich: ein Fuellwort mitten in einem zu langen Satz
 * soll seine eigene Farbe behalten und nicht in der Satzflaeche untergehen.
 */
export function buildHighlightSegments(text: string, ranges: HighlightRange[]): HighlightSegment[] {
  const valid = ranges.filter((r) => r.start >= 0 && r.end <= text.length && r.start < r.end);
  if (valid.length === 0) return text ? [{ text, severity: null }] : [];

  const bounds = new Set<number>([0, text.length]);
  for (const r of valid) {
    bounds.add(r.start);
    bounds.add(r.end);
  }
  const points = [...bounds].sort((a, b) => a - b);

  const segments: HighlightSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    let winner: HighlightRange | null = null;
    for (const r of valid) {
      if (r.start > start || r.end < end) continue;
      if (!winner) {
        winner = r;
        continue;
      }
      const width = r.end - r.start;
      const bestWidth = winner.end - winner.start;
      if (width < bestWidth || (width === bestWidth && SEVERITY_RANK[r.severity] > SEVERITY_RANK[winner.severity])) {
        winner = r;
      }
    }
    segments.push({ text: text.slice(start, end), severity: winner?.severity ?? null });
  }

  // Benachbarte Abschnitte gleicher Farbe zusammenfassen, damit nicht fuer
  // jede Bereichsgrenze ein eigenes Element entsteht.
  return segments.reduce<HighlightSegment[]>((acc, seg) => {
    const last = acc[acc.length - 1];
    if (last && last.severity === seg.severity) last.text += seg.text;
    else acc.push({ ...seg });
    return acc;
  }, []);
}
