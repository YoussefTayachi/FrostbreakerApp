"use client";
import { useState } from "react";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { primaryBtnCls, cardCls } from "@/lib/ui";
import type { BillingStatus } from "@/lib/billing";
import { PLANS, type PlanId } from "@/lib/plans";

// PLANS (Preis, Label, Feature-Liste) lebt zentral in lib/billing.ts; vorher
// gab es hier eine zweite, unabhaengige Kopie derselben Daten (Preis-Aenderung
// haette man an zwei Stellen synchron halten muessen). Einzige Quelle der
// Wahrheit jetzt: lib/billing.ts.
const PLAN_ORDER: PlanId[] = ["starter", "agency"];

export default function PricingClient({ status }: { status: BillingStatus | null }) {
  const { t } = useT();
  const { push } = useToast();
  const P = t.pricing;
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  async function startCheckout(plan: PlanId) {
    setLoadingPlan(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || P.errorGeneric);
      window.location.href = data.url;
    } catch (e) {
      push((e as Error).message, "error");
      setLoadingPlan(null);
    }
  }

  const isCurrentPlan = (plan: PlanId) => status?.isActive && status.plan === plan;

  return (
    <div className="fade-up mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{P.title}</h1>
        <p className="mt-1 text-sm text-faint">{P.subtitle}</p>
      </div>

      {/* Unter sm gestapelt, und der empfohlene Plan steht auch gestapelt noch
          heraus: der Ring traegt die Hervorhebung, nicht die Reihenfolge. */}
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const current = isCurrentPlan(id);
          const featured = id === "agency";
          return (
            <div
              key={id}
              className={
                cardCls +
                " relative flex flex-col " +
                (featured ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-surface" : "")
              }
            >
              {featured && (
                <span className="absolute -top-3 right-5 rounded-full bg-sky-600 px-2.5 py-0.5 text-xs font-medium text-white shadow-md sm:right-6">
                  {P.popularBadge}
                </span>
              )}
              <h2 className="text-base font-semibold text-ink">{plan.label}</h2>
              <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-3xl font-semibold tracking-tight text-ink tabular">
                  {plan.monthlyPriceEur} €
                </span>
                <span className="text-sm text-faint">{P.billedMonthly}</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-soft">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-500"
                    >
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                    <span className="leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>
              {current ? (
                <span className="mt-6 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-300">
                  {P.currentPlanBadge}
                </span>
              ) : (
                <button
                  onClick={() => startCheckout(id)}
                  disabled={loadingPlan !== null}
                  className={primaryBtnCls + " mt-6 w-full"}
                >
                  {loadingPlan === id ? P.redirecting : P.cta}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className={cardCls}>
        <h2 className="text-base font-semibold text-ink">{P.faqHeading}</h2>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-ink">{P.faqTrial}</p>
            <p className="mt-1 text-sm leading-relaxed text-faint">{P.faqTrialAnswer}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-ink">{P.faqByok}</p>
            <p className="mt-1 text-sm leading-relaxed text-faint">{P.faqByokAnswer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
