"use client";
import { useEffect, useState } from "react";
import { useT } from "../../language-provider";
import { cardCls, inputCls, primaryBtnCls } from "@/lib/ui";
import type { DeliverabilityReport, CheckStatus } from "@/lib/deliverability";

const STATUS_STYLES: Record<CheckStatus, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  missing: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
const STATUS_DOT: Record<CheckStatus, string> = {
  ok: "bg-emerald-400",
  warning: "bg-amber-400",
  missing: "bg-red-400",
};

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

export default function DeliverabilityPanel({ hasInstantlyKey }: { hasInstantlyKey: boolean }) {
  const { t } = useT();
  const D = t.deliverability;

  const [domains, setDomains] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [dkimSelector, setDkimSelector] = useState("");
  const [report, setReport] = useState<DeliverabilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasInstantlyKey) return;
    fetch("/api/instantly/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const items: { email: string }[] = body?.items ?? [];
        const unique = Array.from(new Set(items.map((a) => extractDomain(a.email)).filter((d): d is string => !!d)));
        setDomains(unique);
        if (unique.length > 0) setDomain(unique[0]);
      })
      .catch(() => {});
  }, [hasInstantlyKey]);

  async function runCheck(d: string) {
    const target = d.trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/deliverability/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: target, dkimSelector: dkimSelector.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || D.errorGeneric);
      setReport(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function spfTips(r: DeliverabilityReport): string[] {
    if (r.spf.status === "missing") return [D.spfMissingTip];
    const tips: string[] = [];
    if (r.spf.issues.includes("multiple_records")) tips.push(D.spfMultipleTip);
    if (r.spf.issues.includes("no_catch_all")) tips.push(D.spfNoCatchAllTip);
    if (r.spf.issues.includes("neutral_catch_all")) tips.push(D.spfNeutralTip);
    return tips.length > 0 ? tips : [D.spfOkTip];
  }
  function dkimTips(r: DeliverabilityReport): string[] {
    return r.dkim.status === "missing" ? [D.dkimMissingTip] : [D.dkimOkTip];
  }
  function dmarcTips(r: DeliverabilityReport): string[] {
    if (r.dmarc.status === "missing") return [D.dmarcMissingTip];
    if (r.dmarc.issues.includes("policy_none")) return [D.dmarcPolicyNoneTip];
    return [D.dmarcOkTip];
  }

  return (
    <div className="space-y-6">
      <div className={cardCls}>
        {hasInstantlyKey && domains.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 text-xs font-medium text-faint">{D.quickSelectLabel}</p>
            <div className="flex flex-wrap gap-1.5">
              {domains.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDomain(d)}
                  className={
                    "rounded-full border px-3 py-1 text-xs transition-colors " +
                    (domain === d
                      ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                      : "border-edge2 text-faint hover:border-sky-500/50 hover:text-ink")
                  }
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}
        {!hasInstantlyKey && <p className="mb-4 text-xs text-faint">{D.noKeyHint}</p>}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 min-w-52 flex-col text-sm font-medium text-soft">
            {D.domainLabel}
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder={D.domainPlaceholder}
              className={inputCls + " mt-1.5"}
              onKeyDown={(e) => e.key === "Enter" && runCheck(domain)}
            />
          </label>
          <label className="flex flex-col text-sm font-medium text-soft">
            {D.dkimSelectorLabel}
            <input
              value={dkimSelector}
              onChange={(e) => setDkimSelector(e.target.value)}
              placeholder={D.dkimSelectorPlaceholder}
              className={inputCls + " mt-1.5 w-56"}
            />
          </label>
          <button onClick={() => runCheck(domain)} disabled={loading || !domain.trim()} className={primaryBtnCls}>
            {loading ? D.checking : D.checkButton}
          </button>
        </div>
        <p className="mt-2 text-xs text-faint">{D.dkimSelectorHint}</p>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>

      {report && (
        <div className="space-y-4">
          <p className="text-xs text-faint">
            {D.checkedAtPrefix}
            {new Date(report.checkedAt).toLocaleString()}
          </p>

          {(
            [
              { key: "spf" as const, heading: D.spfHeading, status: report.spf.status, tips: spfTips(report), record: report.spf.record },
              { key: "dkim" as const, heading: D.dkimHeading, status: report.dkim.status, tips: dkimTips(report), record: report.dkim.foundSelectors[0]?.record ?? null, selector: report.dkim.foundSelectors[0]?.selector },
              { key: "dmarc" as const, heading: D.dmarcHeading, status: report.dmarc.status, tips: dmarcTips(report), record: report.dmarc.record },
            ] as const
          ).map((section) => (
            <div key={section.key} className={cardCls}>
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-ink">{section.heading}</h2>
                <span
                  className={
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs " +
                    STATUS_STYLES[section.status]
                  }
                >
                  <span className={"h-1.5 w-1.5 rounded-full " + STATUS_DOT[section.status]} />
                  {section.status === "ok" ? D.statusOk : section.status === "warning" ? D.statusWarning : D.statusMissing}
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {section.tips.map((tip, i) => (
                  <p key={i} className="text-sm text-soft">{tip}</p>
                ))}
              </div>
              {"selector" in section && section.selector && (
                <p className="mt-2 text-xs text-faint">{D.foundSelectorsLabel} {section.selector}</p>
              )}
              {section.record && (
                <code className="mt-2 block break-all rounded bg-panel2 px-2.5 py-2 font-mono text-[11px] text-mute">
                  {D.recordLabel} {section.record}
                </code>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
