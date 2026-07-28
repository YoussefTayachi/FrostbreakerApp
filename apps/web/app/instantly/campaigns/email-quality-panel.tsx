"use client";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../language-provider";
import type { Lang } from "@/lib/i18n/lang";
import {
  bodyHighlightRanges,
  hasAnalyzableContent,
  runEmailQualityCheck,
  type EmailField,
  type Highlights,
  type QualityIssue,
  type ReadabilityBand,
  type RiskLevel,
  type Severity,
} from "@/lib/email-quality";

// Lesbarkeit, Spam-Trigger und KI-Klang je Sequenzschritt, direkt unter dem
// Textfeld. Die Pruefungen sind reine Funktionen ohne Netzwerk (siehe
// lib/email-quality), laufen also waehrend des Tippens im Browser -- anders
// als der Deliverability-Check, der fuer DNS zwingend einen Serverweg braucht.

/** Nur gegen Flackern der Badges beim Tippen, nicht aus Performancegruenden. */
const DEBOUNCE_MS = 450;

/** Mehr Zeilen je Abschnitt erschlagen die ohnehin dichte Schritt-Karte. */
const MAX_VISIBLE_ISSUES = 6;

type Tone = "ok" | "warn" | "bad";

// Gleiche Statusfarben wie im Deliverability-Panel und in STATUS_BADGE_CLS --
// gruen/gelb/rot bedeutet in der App ueberall dasselbe.
const TONE_BADGE: Record<Tone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  bad: "bg-red-400",
};
const SEVERITY_DOT: Record<Severity, string> = {
  info: "bg-edge3",
  warning: "bg-amber-400",
  danger: "bg-red-400",
};

const READABILITY_TONE: Record<ReadabilityBand, Tone> = {
  "very-easy": "ok",
  easy: "ok",
  medium: "warn",
  difficult: "bad",
  "very-difficult": "bad",
};
const RISK_TONE: Record<RiskLevel, Tone> = { low: "ok", medium: "warn", high: "bad" };

function useDebouncedContent(subject: string, body: string, delay: number) {
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
function issueValue(issue: QualityIssue): string | number {
  const meta = issue.meta ?? {};
  return meta.words ?? meta.count ?? meta.word ?? meta.phrase ?? meta.burstiness ?? issue.snippet;
}

const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };

type Line = { text: string; severity: Severity; field: EmailField; count: number };

/**
 * Gleiche Befunde zusammenfassen: fuenfmal dasselbe Fuellwort soll eine Zeile
 * mit "x5" sein, nicht fuenf identische Zeilen.
 */
function toLines(issues: QualityIssue[], template: Record<string, (v: string | number) => string>): Line[] {
  const byKey = new Map<string, Line>();
  for (const issue of issues) {
    const text = template[issue.category](issueValue(issue));
    const key = `${issue.field}|${text}`;
    const existing = byKey.get(key);
    if (existing) existing.count++;
    else byKey.set(key, { text, severity: issue.severity, field: issue.field, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export default function EmailQualityPanel({
  subject,
  body,
  onHighlightsChange,
}: {
  subject: string;
  body: string;
  /**
   * Meldet die Fundstellen im Body nach oben, damit das Textfeld sie farbig
   * markieren kann. Nur im aufgeklappten Zustand -- eingeklappt bleibt das
   * Formular ruhig, und die Markierung ist damit eine bewusste Entscheidung
   * des Nutzers statt Dauerzustand.
   */
  onHighlightsChange?: (highlights: Highlights | null) => void;
}) {
  const { t, lang } = useT();
  const Q = t.instantly.campaigns.form.quality;

  // Die Sprache des Mailtexts ist unabhaengig von der Oberflaechensprache --
  // eine Sequenz kann englisch getextet sein, waehrend die App auf Deutsch
  // steht. Startwert ist die UI-Sprache, weil das meistens passt.
  const [contentLang, setContentLang] = useState<Lang>(lang);
  const [expanded, setExpanded] = useState(false);

  const content = useDebouncedContent(subject, body, DEBOUNCE_MS);
  const report = useMemo(() => runEmailQualityCheck(content, contentLang), [content, contentLang]);

  useEffect(() => {
    if (!onHighlightsChange) return;
    if (!expanded) {
      onHighlightsChange(null);
      return;
    }
    onHighlightsChange({ ranges: bodyHighlightRanges(report), forText: content.body });
  }, [report, expanded, content.body, onHighlightsChange]);

  if (!hasAnalyzableContent(content)) return null;

  const { readability, spam, aiSounding } = report;
  const readabilityLines = toLines(readability.issues, Q.issues);
  const spamLines = toLines(spam.issues, Q.issues);
  const aiLines = toLines(aiSounding.issues, Q.issues);

  const badge = (tone: Tone, label: string) => (
    <span className={"flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] " + TONE_BADGE[tone]}>
      <span className={"h-1.5 w-1.5 rounded-full " + TONE_DOT[tone]} />
      {label}
    </span>
  );

  const section = (heading: string, tone: Tone, label: string, stats: string | null, lines: Line[]) => (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-soft">{heading}</span>
        {badge(tone, label)}
        {stats && <span className="text-[11px] text-faint">{stats}</span>}
      </div>
      <ul className="mt-1.5 space-y-1">
        {lines.length === 0 && <li className="text-[11px] text-faint">{Q.noIssues}</li>}
        {lines.slice(0, MAX_VISIBLE_ISSUES).map((line, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-soft">
            <span className={"mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " + SEVERITY_DOT[line.severity]} />
            <span>
              {line.field === "subject" && (
                <span className="mr-1.5 rounded border border-edge2 px-1 py-px text-[10px] text-faint">
                  {Q.fieldSubject}
                </span>
              )}
              {line.text}
              {line.count > 1 && <span className="ml-1 text-faint">×{line.count}</span>}
            </span>
          </li>
        ))}
        {lines.length > MAX_VISIBLE_ISSUES && (
          <li className="text-[11px] text-faint">{Q.moreIssues(lines.length - MAX_VISIBLE_ISSUES)}</li>
        )}
      </ul>
    </div>
  );

  return (
    <div className="mt-2 rounded-lg border border-edge/60 bg-panel2/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-faint">{Q.heading}</span>
        {readability.wordCount > 0 &&
          badge(READABILITY_TONE[readability.band], Q.readability.bands[readability.band])}
        {badge(RISK_TONE[spam.riskLevel], `${Q.spam.heading}: ${Q.spam.levels[spam.riskLevel]}`)}
        {badge(RISK_TONE[aiSounding.band], `${Q.aiSounding.heading}: ${Q.aiSounding.levels[aiSounding.band]}`)}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-[11px] font-medium text-sky-600 hover:text-sky-500 dark:text-sky-400"
        >
          {expanded ? Q.hideDetails : Q.showDetails}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-edge/60 pt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-faint">{Q.contentLangLabel}</span>
            {(["de", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setContentLang(l)}
                className={
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase transition-colors " +
                  (contentLang === l
                    ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                    : "border-edge2 text-faint hover:border-sky-500/50")
                }
              >
                {l}
              </button>
            ))}
          </div>

          {readability.wordCount > 0 &&
            section(
              Q.readability.heading,
              READABILITY_TONE[readability.band],
              `${Q.readability.bands[readability.band]} · ${Q.readability.gradeLevel(readability.gradeLevel ?? 0)}`,
              Q.readability.stats(readability.wordCount, readability.sentenceCount, readability.avgSentenceLength),
              readabilityLines
            )}

          {section(
            Q.spam.heading,
            RISK_TONE[spam.riskLevel],
            Q.spam.levels[spam.riskLevel],
            Q.spam.scoreLabel(spam.riskScore),
            spamLines
          )}

          <div>
            {section(
              Q.aiSounding.heading,
              RISK_TONE[aiSounding.band],
              Q.aiSounding.levels[aiSounding.band],
              null,
              aiLines
            )}
            {/* Bewusst immer sichtbar und nicht wegklickbar: eine Zahl ohne
                diesen Hinweis wuerde als Beweis gelesen, den sie nicht liefert.
                Deshalb auch text-soft statt text-mute -- der Hinweis muss im
                Dark Mode lesbar bleiben, nicht nur formal dastehen. */}
            <p className="mt-1.5 text-[11px] leading-relaxed text-soft">{Q.aiSounding.disclaimer}</p>
          </div>
        </div>
      )}
    </div>
  );
}
