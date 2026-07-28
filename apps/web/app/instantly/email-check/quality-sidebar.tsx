"use client";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../language-provider";
import type { Lang } from "@/lib/i18n/lang";
import { bodyHighlightRanges, hasAnalyzableContent, runEmailQualityCheck, type Highlights, type IssueCategory, type Severity } from "@/lib/email-quality";
import { RISK_TONE, READABILITY_TONE, SEVERITY_DOT, TONE_TEXT, groupByCategory, useDebouncedContent } from "../quality-shared";

// Grosse, immer offene Stat-Sidebar fuer den eigenstaendigen Text-Check --
// bewusst kein Ableger von email-quality-panel.tsx (das bleibt kompakt und
// eingeklappt fuer die dichte Sequenz-Karte), sondern eine eigene, deutlich
// geraeumigere Darstellung im Stil von hemingwayapp.com: grosse Kennzahl,
// darunter Kategorien als Zeile mit Anzahl statt einer Aufzaehlung jedes
// einzelnen Fundes. Teilt sich Farben/Gruppierung mit dem Panel ueber
// quality-shared.ts.

const DEBOUNCE_MS = 450;

export default function QualitySidebar({
  subject,
  body,
  onHighlightsChange,
}: {
  subject: string;
  body: string;
  onHighlightsChange?: (highlights: Highlights | null) => void;
}) {
  const { t, lang } = useT();
  const Q = t.instantly.campaigns.form.quality;

  const [contentLang, setContentLang] = useState<Lang>(lang);
  const content = useDebouncedContent(subject, body, DEBOUNCE_MS);
  const report = useMemo(() => runEmailQualityCheck(content, contentLang), [content, contentLang]);

  // Keine Einklapp-Logik hier (anders als im Panel) -- die Sidebar ist der
  // einzige Seiteninhalt, Markierungen sollen deshalb immer aktuell sein.
  useEffect(() => {
    onHighlightsChange?.({ ranges: bodyHighlightRanges(report), forText: content.body });
  }, [report, content.body, onHighlightsChange]);

  const { readability, spam, aiSounding } = report;
  const hasContent = hasAnalyzableContent(content);

  function categoryRows(issues: { category: IssueCategory; count: number; severity: Severity }[]) {
    if (issues.length === 0) return <p className="py-2 text-xs text-faint">{Q.noIssues}</p>;
    return issues.map(({ category, count, severity }) => (
      <div key={category} className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className="flex items-center gap-2 text-soft">
          <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + SEVERITY_DOT[severity]} />
          {Q.categoryLabels[category]}
        </span>
        <span className="font-medium text-ink">{count}</span>
      </div>
    ));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-faint">{Q.contentLangLabel}</span>
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

      {!hasContent && <p className="text-sm text-faint">{Q.emptyHint}</p>}

      {hasContent && (
        <>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-faint">{Q.readability.heading}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-4xl font-semibold text-ink">
                {readability.gradeLevel !== null ? Math.round(readability.gradeLevel) : "–"}
              </span>
              <span className={"text-sm font-medium " + TONE_TEXT[READABILITY_TONE[readability.band]]}>
                {Q.readability.bands[readability.band]}
              </span>
            </div>
            <p className="mt-1 text-xs text-faint">
              {Q.readability.stats(readability.wordCount, readability.sentenceCount, readability.avgSentenceLength)}
            </p>
            <div className="mt-3 divide-y divide-edge/60 border-t border-edge/60">{categoryRows(groupByCategory(readability.issues))}</div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-faint">{Q.spam.heading}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={"text-2xl font-semibold " + TONE_TEXT[RISK_TONE[spam.riskLevel]]}>{Q.spam.levels[spam.riskLevel]}</span>
              <span className="text-xs text-faint">{Q.spam.scoreLabel(spam.riskScore)}</span>
            </div>
            <div className="mt-3 divide-y divide-edge/60 border-t border-edge/60">{categoryRows(groupByCategory(spam.issues))}</div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-faint">{Q.aiSounding.heading}</p>
            <div className="mt-2">
              <span className={"text-2xl font-semibold " + TONE_TEXT[RISK_TONE[aiSounding.band]]}>{Q.aiSounding.levels[aiSounding.band]}</span>
            </div>
            <div className="mt-3 divide-y divide-edge/60 border-t border-edge/60">{categoryRows(groupByCategory(aiSounding.issues))}</div>
            {/* Bewusst immer sichtbar, nicht wegklickbar: eine Zahl ohne diesen
                Hinweis wuerde als Beweis gelesen, den sie nicht liefert. */}
            <p className="mt-3 text-xs leading-relaxed text-soft">{Q.aiSounding.disclaimer}</p>
          </div>
        </>
      )}
    </div>
  );
}
