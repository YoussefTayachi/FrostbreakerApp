// Gemeinsame Tailwind-Klassen fuer Formularelemente, bisher in fast jeder
// Datei mit einem Formular einzeln dupliziert (settings/page.tsx,
// instantly-mailboxes.tsx, instantly-campaign-builder.tsx, ...). An einer
// Stelle halten, damit ein Design-Anpassung (Farbe, Radius, Fokus-Ring) nicht
// in einem Dutzend Dateien synchron gehalten werden muss.
//
// Die Werte hinter rounded-lg, text-sm und shadow-sm stehen in globals.css
// (@theme): 12px Radius, 15px Schrift, weicher Schatten.

export const inputCls =
  "rounded-lg border border-edge2 bg-field px-3.5 py-2.5 text-sm text-ink " +
  "placeholder-mute outline-none transition-[border-color,box-shadow] duration-150 " +
  "focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15";

// Rueckmeldung beim Druecken, nicht erst beim Loslassen: active:scale ist
// die eine Zeile, die einen Knopf greifbar macht.
export const primaryBtnCls =
  "rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm " +
  "transition-[background-color,transform,box-shadow] duration-150 hover:bg-sky-500 " +
  "active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";

export const secondaryBtnCls =
  "rounded-lg border border-edge2 bg-panel px-4 py-2.5 text-sm font-medium text-ink shadow-sm " +
  "transition-[background-color,transform,border-color] duration-150 hover:bg-chip " +
  "active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";

/* Kleine Variante fuer Zeilenaktionen (Aufhaenger-Freigabe, Listen): gleiche
   Form, weniger Flaeche. Statt !important-Ueberschreibungen an der Stelle. */
export const primaryBtnSmCls = primaryBtnCls.replace("px-5 py-2.5 text-sm", "px-3 py-1.5 text-xs");
export const secondaryBtnSmCls = secondaryBtnCls.replace("px-4 py-2.5 text-sm", "px-3 py-1.5 text-xs");

export const dangerBtnCls =
  "rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 " +
  "transition-[background-color,transform] duration-150 hover:bg-red-50 active:scale-[0.98] " +
  "disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10";

/* p-4 auf dem Handy statt p-6: die 48 Pixel Innenrand, die p-6 links und
   rechts kostet, sind auf einem 375er Bildschirm ein Siebtel der Breite --
   und die fehlt jeder Karte, die eine Tabelle, ein Textfeld oder eine
   Knopfreihe enthaelt. Ab sm wieder p-6, dort ist die Luft der Punkt. */
export const cardCls = "rounded-xl border border-edge/70 bg-panel p-4 shadow-sm sm:p-6";

/** Badge-Farben je nach lokalem Kampagnen-Status (siehe lib/instantly/campaigns.ts LocalCampaignStatus). */
export const STATUS_BADGE_CLS: Record<string, string> = {
  draft: "border-edge2 bg-chip text-faint",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  completed: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  error: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};
