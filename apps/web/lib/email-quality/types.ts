import type { Lang } from "@/lib/i18n/lang";

// Gemeinsame Typen fuer die drei Textpruefungen (Lesbarkeit, Spam-Trigger,
// KI-Klang). Bewusst frei von React/i18n: die Pruefungen sind reine Funktionen
// und dadurch ohne DOM oder Dictionary testbar. Deshalb enthaelt ein Issue auch
// keinen fertigen Anzeigetext, sondern nur `category` + `meta` — die
// Uebersetzung passiert erst in der UI (siehe email-quality-panel.tsx), damit
// alle Texte wie ueberall sonst in dict.ts liegen.

export type { Lang };

export type Severity = "info" | "warning" | "danger";

export type EmailField = "subject" | "body";

export type IssueCategory =
  // Lesbarkeit
  | "long-sentence"
  | "very-long-sentence"
  | "passive"
  | "adverb"
  | "weasel"
  // Spam-Trigger
  | "money"
  | "urgency"
  | "exaggerated-claims"
  | "trust-manipulation"
  | "all-caps"
  | "exclamation"
  | "punctuation-cluster"
  | "unfilled-placeholder"
  // KI-Klang
  | "ai-phrase"
  | "low-burstiness";

export type QualityIssue = {
  category: IssueCategory;
  severity: Severity;
  field: EmailField;
  /** Der getroffene Text, wird in der UI zitiert ("Passiv: ..."). */
  snippet: string;
  /**
   * Zeichen-Offset im jeweiligen Feld. `null` bei Aggregat-Befunden, die sich
   * nicht auf eine Stelle beziehen (z. B. Gross-Schreib-Quote ueber den
   * gesamten Text). Wird in v1 noch nicht gerendert, ist aber die Grundlage
   * fuer spaeteres Inline-Highlighting im Textfeld — deshalb schon jetzt
   * mitgefuehrt, damit die Scoring-Logik dafuer nicht angefasst werden muss.
   */
  offset: { start: number; end: number } | null;
  /** Werte fuer die Textbausteine in dict.ts, z. B. { word: "garantiert" }. */
  meta?: Record<string, string | number>;
};

export type ReadabilityBand = "very-easy" | "easy" | "medium" | "difficult" | "very-difficult";

export type ReadabilityResult = {
  lang: Lang;
  /** 0-100, hoeher = leichter. EN: Flesch Reading Ease, DE: Amstad-Variante. */
  readingEaseScore: number;
  /** Schulstufe. EN: Flesch-Kincaid Grade, DE: Wiener Sachtextformel. */
  gradeLevel: number | null;
  band: ReadabilityBand;
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  avgSyllablesPerWord: number;
  /** Anteil der Saetze mit Passivkonstruktion (0-1). */
  passiveRatio: number;
  issues: QualityIssue[];
};

export type SpamCategory = "money" | "urgency" | "exaggerated-claims" | "trust-manipulation";

export type RiskLevel = "low" | "medium" | "high";

export type SpamCheckResult = {
  lang: Lang;
  riskLevel: RiskLevel;
  /** 0-100, hoeher = riskanter. */
  riskScore: number;
  categoryCounts: Record<SpamCategory, number>;
  /** Anteil komplett grossgeschriebener Woerter im Body (0-1). */
  capsRatio: number;
  exclamationCount: number;
  issues: QualityIssue[];
};

export type AiSoundingResult = {
  lang: Lang;
  /** 0-100 Heuristik-Indikator, ausdruecklich kein statistischer Detektor. */
  score: number;
  band: RiskLevel;
  /**
   * Variationskoeffizient der Satzlaengen (stdev/mean). Niedrig = gleichfoermig
   * = eher KI-typisch. `null`, wenn zu wenige Saetze fuer eine sinnvolle
   * Aussage vorliegen (siehe MIN_SENTENCES_FOR_BURSTINESS).
   */
  burstiness: number | null;
  issues: QualityIssue[];
};

export type EmailQualityReport = {
  lang: Lang;
  readability: ReadabilityResult;
  spam: SpamCheckResult;
  aiSounding: AiSoundingResult;
};

export type EmailContent = { subject: string; body: string };
