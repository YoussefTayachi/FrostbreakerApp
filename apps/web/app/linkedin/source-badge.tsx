"use client";
import { useT } from "../language-provider";

/**
 * Woher die Kontakte einer Liste stammen. Nicht Deko: die Quelle sagt voraus,
 * was man vorfindet, und das aendert die Ansprache.
 *
 *   apollo:    Firmendatenbank, praktisch immer mit E-Mail-Adresse, oft mit
 *              Firmenbeschreibung (daher der hohe Icebreaker-Anteil)
 *   maps:      Google Maps, lokale Betriebe, haeufig ohne persoenliche Adresse
 *   corporate: Hunter-Domainsuche, gemischt
 *
 * Die Werte entsprechen searches.source (Migration 0051). Unbekannte Werte
 * werden woertlich angezeigt statt verschluckt: eine neue Quelle soll
 * auffallen, nicht stillschweigend als "sonstiges" durchlaufen.
 */
const TONE: Record<string, string> = {
  apollo: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  maps: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  corporate: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export default function SourceBadge({ source }: { source: string | null }) {
  const { t } = useT();
  if (!source) return null;
  const label = t.linkedin.sourceLabels[source] ?? source;
  return (
    <span
      className={
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium " +
        (TONE[source] ?? "bg-chip text-mute")
      }
    >
      {label}
    </span>
  );
}
