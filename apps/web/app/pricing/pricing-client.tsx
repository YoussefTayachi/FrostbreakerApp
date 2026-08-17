"use client";
import { useState } from "react";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { primaryBtnCls, cardCls } from "@/lib/ui";
import type { BillingStatus } from "@/lib/billing";
import { PLANS, type PlanId } from "@/lib/plans";

// PLANS (Preis, Label, Feature-Liste) lebt zentral in lib/billing.ts -- vorher
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
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{P.title}</h1>
        <p className="mt-1 text-sm text-faint">{P.subtitle}</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const current = isCurrentPlan(id);
          return (
            <div
              key={id}
              className={
                cardCls +
                " relative flex flex-col " +
                (id === "agency" ? "border-sky-500/50" : "")
              }
            >
              {id === "agency" && (
                <span className="absolute -top-3 right-6 rounded-full bg-sky-500 px-2.5 py-0.5 text-xs font-medium text-white shadow">
                  {P.popularBadge}
                </span>
              )}
              <h2 className="font-medium text-ink">{plan.label}</h2>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold text-ink">{plan.monthlyPriceEur} €</span>
                <span className="text-sm text-faint">{P.billedMonthly}</span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-soft">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-emerald-500">✓</span>
                    {f}
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
                  className={primaryBtnCls + " mt-6"}
                >
                  {loadingPlan === id ? P.redirecting : P.cta}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className={cardCls}>
        <h2 className="font-medium text-ink">{P.faqHeading}</h2>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="font-medium text-soft">{P.faqTrial}</p>
            <p className="text-faint">{P.faqTrialAnswer}</p>
          </div>
          <div>
            <p className="font-medium text-soft">{P.faqByok}</p>
            <p className="text-faint">{P.faqByokAnswer}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
