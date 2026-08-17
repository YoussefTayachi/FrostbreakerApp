"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { cardCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import type { BillingStatus, LeadUsage } from "@/lib/billing";

const PLAN_LABEL_KEY: Record<string, "planTrial" | "planStarter" | "planAgency"> = {
  trial: "planTrial",
  starter: "planStarter",
  agency: "planAgency",
};
const STATUS_LABEL_KEY: Record<string, "statusTrialing" | "statusActive" | "statusPastDue" | "statusCanceled" | "statusIncomplete"> = {
  trialing: "statusTrialing",
  active: "statusActive",
  past_due: "statusPastDue",
  canceled: "statusCanceled",
  incomplete: "statusIncomplete",
};
const STATUS_DOT: Record<string, string> = {
  trialing: "bg-sky-400",
  active: "bg-emerald-400",
  past_due: "bg-amber-400",
  canceled: "bg-red-400",
  incomplete: "bg-red-400",
};

export default function BillingSection() {
  const { t } = useT();
  const { push } = useToast();
  const B = t.billing;
  const [status, setStatus] = useState<BillingStatus | null | undefined>(undefined);
  const [usage, setUsage] = useState<LeadUsage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
    fetch("/api/billing/lead-usage")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  async function openPortal() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || B.errorGeneric);
      window.location.href = data.url;
    } catch (e) {
      push((e as Error).message, "error");
      setBusy(false);
    }
  }

  if (status === undefined) {
    return <div className={cardCls}><p className="text-sm text-faint">{B.loading}</p></div>;
  }
  if (status === null) {
    return <div className={cardCls}><p className="text-sm text-faint">{B.errorGeneric}</p></div>;
  }

  const planLabel = B[PLAN_LABEL_KEY[status.plan] ?? "planTrial"];
  const statusLabel = B[STATUS_LABEL_KEY[status.status] ?? "statusIncomplete"];

  return (
    <div className={cardCls}>
      <h2 className="font-medium text-ink">{B.heading}</h2>
      <p className="mb-4 mt-1 text-sm text-faint">{B.description}</p>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-edge/60 bg-surface/60 px-4 py-3.5">
        <div>
          <p className="font-medium text-ink">{planLabel}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
            <span className={"h-1.5 w-1.5 rounded-full " + (STATUS_DOT[status.status] ?? "bg-faint")} />
            {statusLabel}
            {status.status === "trialing" && status.trialDaysLeft !== null && (
              <span>
                {" "}· {status.trialDaysLeft} {B.trialDaysLeftSuffix}
              </span>
            )}
            {status.status === "trialing" && status.trialDaysLeft === 0 && !status.isActive && (
              <span className="text-red-500"> · {B.trialExpired}</span>
            )}
          </p>
        </div>
        {status.plan === "trial" || !status.isActive ? (
          <Link href="/pricing" className={primaryBtnCls}>{B.upgradeButton}</Link>
        ) : (
          <button onClick={openPortal} disabled={busy} className={secondaryBtnCls}>
            {B.manageButton}
          </button>
        )}
      </div>

      {usage && (
        <div className="mt-3 rounded-lg border border-edge/60 bg-surface/60 px-4 py-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink">
              {usage.scope === "trial" ? B.leadUsageHeadingTrial : B.leadUsageHeading}
            </span>
            <span className="text-faint">
              {usage.cap === null ? B.leadUsageUnlimited : B.leadUsageLabel(usage.used, usage.cap)}
            </span>
          </div>
          {usage.cap !== null && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chip">
                <div
                  className={
                    "h-full rounded-full transition-all " +
                    (usage.used >= usage.cap ? "bg-red-500" : usage.used / usage.cap > 0.8 ? "bg-amber-500" : "bg-sky-500")
                  }
                  style={{ width: `${Math.min(100, (usage.used / usage.cap) * 100)}%` }}
                />
              </div>
              {usage.used >= usage.cap && (
                <p className="mt-2 text-xs text-red-500">
                  {usage.scope === "trial" ? B.leadUsageCapReachedTrial : B.leadUsageCapReached}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
