// Reine Plan-Metadaten (Preis, Label, Feature-Liste) -- bewusst OHNE Stripe-SDK-
// Import. lib/billing.ts importiert "stripe" (server-only, braucht STRIPE_SECRET_KEY),
// pricing-client.tsx & Co. sind aber "use client"-Komponenten -- wuerden sie
// aus lib/billing.ts importieren, landet die komplette Stripe-SDK ungenutzt im
// Client-Bundle (siehe Next.js Build-Output: /pricing sprang von ~2KB auf 28KB,
// als PLANS aus lib/billing.ts kam). Einzige Quelle der Wahrheit fuer
// Plan-Anzeige bleibt trotzdem diese Datei -- lib/billing.ts re-exportiert sie.

export type PlanId = "starter" | "agency";

// Lead-Caps (siehe Migration 0025 und 0029, under_lead_cap()) -- gezaehlt
// werden qualifizierte Leads (email_type = 'personal', nicht info@/office@),
// eine Firma zaehlt einmal auch bei mehreren gefundenen Personen.
// Agentur ist unlimitiert und taucht deshalb hier nicht auf.
export const STARTER_MONTHLY_LEAD_CAP = 5000;

// Eigener, kleinerer Cap fuer die Testphase. Gilt nicht pro Monat, sondern
// fuer den gesamten Trial-Zeitraum ab subscriptions.created_at -- sonst
// haette ein Trial faktisch so viel gedurft wie ein bezahlter Monat.
export const TRIAL_LEAD_CAP = 500;

export const PLANS: Record<
  PlanId,
  { priceEnvVar: string; label: string; priceLabel: string; monthlyPriceEur: number; features: string[] }
> = {
  starter: {
    priceEnvVar: "STRIPE_PRICE_STARTER",
    label: "Starter",
    priceLabel: "99 € / Monat",
    monthlyPriceEur: 99,
    features: [
      "1 Workspace",
      `Bis ${STARTER_MONTHLY_LEAD_CAP.toLocaleString("de-DE")} qualifizierte Leads/Monat (Google Maps + Corporate)`,
      "Nur personenbezogene E-Mails -- keine info@/office@-Treffer",
      "Native Instantly-Kampagnen (BYOK)",
      "KI-Antwortklassifizierung",
      "E-Mail-Support",
    ],
  },
  agency: {
    priceEnvVar: "STRIPE_PRICE_AGENCY",
    label: "Agentur",
    priceLabel: "199 € / Monat",
    monthlyPriceEur: 199,
    features: [
      "Mehrere Workspaces (ein Kunde = ein Workspace)",
      "Unlimitierte qualifizierte Leads",
      "Alles aus Starter",
      "White-Label-Reports mit eigenem Branding",
      "Priority Support",
    ],
  },
};
