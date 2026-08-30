// Gemeinsame Tailwind-Klassen fuer Formularelemente, bisher in fast jeder
// Datei mit einem Formular einzeln dupliziert (settings/page.tsx,
// instantly-mailboxes.tsx, instantly-campaign-builder.tsx, ...). An einer
// Stelle halten, damit ein Design-Anpassung (Farbe, Radius, Fokus-Ring) nicht
// in einem Dutzend Dateien synchron gehalten werden muss.
export const inputCls =
  "rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink " +
  "placeholder-mute outline-none transition-colors focus:border-sky-500";

export const primaryBtnCls =
  "rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg " +
  "shadow-sky-600/25 transition-all hover:bg-sky-500 disabled:opacity-50";

export const secondaryBtnCls =
  "rounded-lg border border-edge2 px-3.5 py-2 text-sm font-medium text-soft transition-colors " +
  "hover:border-sky-500 hover:text-sky-600 disabled:opacity-50 dark:hover:text-sky-400";

export const dangerBtnCls =
  "rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors " +
  "hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10";

/* p-4 auf dem Handy statt p-6: die 48 Pixel Innenrand, die p-6 links und
   rechts kostet, sind auf einem 375er Bildschirm ein Siebtel der Breite --
   und die fehlt jeder Karte, die eine Tabelle, ein Textfeld oder eine
   Knopfreihe enthaelt. Ab sm wieder p-6, dort ist die Luft der Punkt. */
export const cardCls = "rounded-lg border border-edge/60 bg-panel p-4 sm:p-6";

/** Badge-Farben je nach lokalem Kampagnen-Status (siehe lib/instantly/campaigns.ts LocalCampaignStatus). */
export const STATUS_BADGE_CLS: Record<string, string> = {
  draft: "border-edge2 bg-chip text-faint",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  completed: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  error: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
