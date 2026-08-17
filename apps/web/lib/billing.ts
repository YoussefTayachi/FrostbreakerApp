import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, STARTER_MONTHLY_LEAD_CAP, TRIAL_LEAD_CAP, type PlanId } from "./plans";

// Zentrale Stelle fuer alles Billing-Bezogene. Abo ist an den Account (auth.uid())
// gebunden, nicht an einen einzelnen Workspace — siehe Migration 0024.
// Plan-Metadaten (Preis/Label/Features) leben in lib/plans.ts, damit
// Client-Komponenten sie importieren koennen, ohne die Stripe-SDK mit
// auszuliefern — hier nur re-exportiert, damit bestehende Importe aus
// lib/billing.ts weiterhin funktionieren.
export { PLANS, STARTER_MONTHLY_LEAD_CAP, TRIAL_LEAD_CAP, type PlanId };

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeSingleton) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY fehlt in den Umgebungsvariablen.");
    stripeSingleton = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });
  }
  return stripeSingleton;
}

export function priceIdFor(plan: PlanId): string {
  const envVar = PLANS[plan].priceEnvVar;
  const value = process.env[envVar];
  if (!value) throw new Error(`${envVar} fehlt in den Umgebungsvariablen.`);
  return value;
}

export function planFromPriceId(priceId: string): PlanId | null {
  for (const [plan, cfg] of Object.entries(PLANS) as [PlanId, (typeof PLANS)[PlanId]][]) {
    if (process.env[cfg.priceEnvVar] === priceId) return plan;
  }
  return null;
}

export type BillingStatus = {
  plan: "trial" | PlanId;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  isActive: boolean;
  trialDaysLeft: number | null;
};

// Liest den Abo-Status des eingeloggten Users. RLS sorgt dafuer, dass nur die
// eigene Zeile lesbar ist (subscriptions_owner_read in 0024).
export async function getBillingStatus(
  supabase: SupabaseClient
): Promise<BillingStatus | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("subscriptions")
    .select("plan, status, trial_ends_at, current_period_end, stripe_customer_id")
    .eq("owner_id", user.id)
    .single();
  if (!data) return null;

  const trialEndsAt = data.trial_ends_at as string | null;
  const isActive =
    data.status === "active" ||
    (data.status === "trialing" && !!trialEndsAt && new Date(trialEndsAt) > new Date());
  const trialDaysLeft =
    data.status === "trialing" && trialEndsAt
      ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
      : null;

  return {
    plan: data.plan,
    status: data.status,
    trialEndsAt,
    currentPeriodEnd: data.current_period_end,
    stripeCustomerId: data.stripe_customer_id,
    isActive,
    trialDaysLeft,
  };
}

// scope unterscheidet, worauf sich "used" bezieht: waehrend der Testphase auf
// den gesamten Trial-Zeitraum, danach auf den laufenden Kalendermonat. Die UI
// braucht das, um nicht faelschlich "diesen Monat" zu beschriften.
export type LeadUsage = { used: number; cap: number | null; scope: "trial" | "month" };

// Fuer die Fortschrittsanzeige in den Einstellungen. cap = null bedeutet
// unlimitiert (Agentur-Plan). Muss zu under_lead_cap() aus Migration 0029
// passen — dort entscheidet dieselbe Fallunterscheidung darueber, ob eine
// neue Suche ueberhaupt angelegt werden darf.
export async function getLeadUsage(supabase: SupabaseClient): Promise<LeadUsage | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan")
    .eq("owner_id", user.id)
    .single();

  if (sub?.plan === "agency") {
    // Ohne Cap braucht die Anzeige keine Zahl — der RPC-Aufruf entfaellt.
    return { used: 0, cap: null, scope: "month" };
  }

  const isTrial = sub?.plan === "trial";
  const { data: used } = await supabase.rpc(
    isTrial ? "my_trial_lead_count" : "my_qualified_lead_count"
  );

  return {
    used: (used as number | null) ?? 0,
    cap: isTrial ? TRIAL_LEAD_CAP : STARTER_MONTHLY_LEAD_CAP,
    scope: isTrial ? "trial" : "month",
  };
}
