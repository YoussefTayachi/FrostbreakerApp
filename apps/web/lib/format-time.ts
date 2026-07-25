import type { Lang } from "@/lib/i18n/lang";

/**
 * Zeitformatierung fuer Client-Komponenten.
 *
 * Bewusst NICHT in lib/i18n/lang.ts: die Datei importiert next/headers und ist
 * damit server-only -- ein "use client"-Modul kann daraus nur Typen importieren.
 * Lag vorher lokal in inbox/page.tsx, wird jetzt zusaetzlich von der Timeline,
 * dem Pipeline-Board und den Aktivitaeten-Widgets genutzt.
 */
const LOCALE: Record<Lang, string> = { de: "de-DE", en: "en-US" };

export function localeOf(lang: Lang): string {
  return LOCALE[lang];
}

/** "vor 5 Minuten", "vor 3 Tagen", ab einer Woche das Datum. */
export function formatRelative(iso: string | null, lang: Lang): string {
  if (!iso) return "";
  const date = new Date(iso);
  const locale = LOCALE[lang];
  const diffMin = Math.round((Date.now() - date.getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  // Zukunft (faellige Aufgaben) genauso behandeln wie Vergangenheit -- das
  // Vorzeichen von diffMin traegt die Richtung, RelativeTimeFormat den Text.
  const abs = Math.abs(diffMin);
  if (abs < 1) return rtf.format(0, "minute");
  if (abs < 60) return rtf.format(-diffMin, "minute");
  if (abs < 60 * 24) return rtf.format(-Math.round(diffMin / 60), "hour");
  if (abs < 60 * 24 * 7) return rtf.format(-Math.round(diffMin / (60 * 24)), "day");
  return date.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

/** Volles Datum mit Uhrzeit, fuer Tooltips und Detailzeilen. */
export function formatDateTime(iso: string | null, lang: Lang): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(LOCALE[lang], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Nur der Tag -- fuer Faelligkeiten und erwartete Abschlussdaten. */
export function formatDay(iso: string | null, lang: Lang): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(LOCALE[lang], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** ISO-Datum (yyyy-mm-dd) fuer <input type="date"> aus einem Timestamp. */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}
