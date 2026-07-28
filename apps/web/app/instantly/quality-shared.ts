"use client";
import { useEffect, useState } from "react";
import type { EmailField, IssueCategory, QualityIssue, ReadabilityBand, RiskLevel, Severity } from "@/lib/email-quality";

// Gemeinsame Bausteine fuer die beiden Textqualitaets-Ansichten: das kompakte
// Panel in der Sequenz-Karte (campaigns/email-quality-panel.tsx) und die
// grosse Sidebar im eigenstaendigen Text-Check (email-check/quality-sidebar.tsx).
// Beide zeigen denselben Befund (lib/email-quality) nur unterschiedlich dicht --
// Farben, Gruppierung und das Entprellen sollen dabei nicht zweimal existieren.

export type Tone = "ok" | "warn" | "bad";

// Gleiche Statusfarben wie im Deliverability-Panel und in STATUS_BADGE_CLS --
// gruen/gelb/rot bedeutet in der App ueberall dasselbe.
export const TONE_BADGE: Record<Tone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};
export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
};
export const SEVERITY_DOT: Record<Severity, string> = {
  info: "bg-edge3",
  warning: "bg-amber-400",
  danger: "bg-red-400",
};

export const READABILITY_TONE: Record<ReadabilityBand, Tone> = {
  "very-easy": "ok",
  easy: "ok",
  medium: "warn",
  difficult: "bad",
  "very-difficult": "bad",
};
export const RISK_TONE: Record<RiskLevel, Tone> = { low: "ok", medium: "warn", high: "bad" };

export function useDebouncedContent(subject: string, body: string, delay: number) {
  const [content, setContent] = useState({ subject, body });
  useEffect(() => {
    const id = setTimeout(() => setContent({ subject, body }), delay);
    return () => clearTimeout(id);
  }, [subject, body, delay]);
  return content;
}

/**
 * Der eine Wert, den der Textbaustein in dict.ts einsetzt. Die Pruefungen
 * liefern absichtlich keinen fertigen Satz, damit alle Texte an einer Stelle
 * liegen und uebersetzbar bleiben.
 */
export function issueValue(issue: QualityIssue): string | number {
  const meta = issue.meta ?? {};
  return meta.words ?? meta.count ?? meta.word ?? meta.phrase ?? meta.burstiness ?? issue.snippet;
}

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };

export type IssueLine = { text: string; severity: Severity; field: EmailField; count: number };

/**
 * Gleiche Befunde zusammenfassen: fuenfmal dasselbe Fuellwort soll eine Zeile
 * mit "x5" sein, nicht fuenf identische Zeilen. Fuer die kompakte Listen-Ansicht.
 */
export function toIssueLines(issues: QualityIssue[], template: Record<string, (v: string | number) => string>): IssueLine[] {
  const byKey = new Map<string, IssueLine>();
  for (const issue of issues) {
    const text = template[issue.category](issueValue(issue));
    const key = `${issue.field}|${text}`;
    const existing = byKey.get(key);
    if (existing) existing.count++;
    else byKey.set(key, { text, severity: issue.severity, field: issue.field, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export type CategoryCount = { category: IssueCategory; count: number; severity: Severity };

/**
 * Pro Kategorie nur die Anzahl, nicht jeder einzelne Fund -- fuer die
 * Hemingway-artige Sidebar-Zeile ("3 lange Saetze") statt einer Aufzaehlung.
 */
export function groupByCategory(issues: QualityIssue[]): CategoryCount[] {
  const byCategory = new Map<IssueCategory, CategoryCount>();
  for (const issue of issues) {
    const existing = byCategory.get(issue.category);
    if (existing) existing.count++;
    else byCategory.set(issue.category, { category: issue.category, count: 1, severity: issue.severity });
  }
  return [...byCategory.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
