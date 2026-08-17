"use client";
import { useEffect, useState } from "react";
// formatDate aus lib/format-time, NICHT aus lib/i18n/lang: letzteres
// importiert next/headers, und ein Wert-Import daraus laesst den
// Produktions-Build scheitern ("You're importing a component that needs
// next/headers"). Der Typ darf von dort kommen, Typen werden beim
// Uebersetzen entfernt.
import { formatDate } from "@/lib/format-time";
import type { Lang } from "@/lib/i18n/lang";

/**
 * Ein Zeitstempel in der Zeitzone des BETRACHTERS.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DIESE KOMPONENTE GIBT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * formatDate ruft toLocaleString auf, und das nimmt die Zeitzone des
 * Prozesses, in dem es laeuft. In einer Server-Komponente ist das Vercel --
 * also UTC, fuer jeden Nutzer auf der Welt.
 *
 * Am 2026-08-09 hat ein Kunde um 21:58 seiner Zeit eine Suche gestartet und
 * darueber "August 9, 2026 at 7:58 PM" gelesen. Zwei Stunden Abweichung sind
 * gerade dort teuer, wo jemand herausfinden will, ob etwas noch laeuft oder
 * schon fertig war.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DER SERVERWERT TROTZDEM ZUERST GERENDERT WIRD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der Server kennt die Zeitzone des Browsers nicht. Wuerde hier zuerst nichts
 * stehen, bliebe die Zeile bis zum ersten Effekt leer und spraenge dann --
 * und React wuerde einen Hydration-Fehler melden, weil Server- und
 * Client-Fassung sich unterscheiden. Deshalb: erst der UTC-Wert vom Server,
 * unmittelbar nach dem Einhaengen die Ortszeit. Beide Fassungen stimmen
 * ueberein, solange der Zustand noch der Anfangswert ist.
 */
export default function LocalTime({
  iso,
  lang,
  serverFormatted,
  opts,
}: {
  iso: string;
  lang: Lang;
  /** Wie der Server denselben Zeitpunkt formatiert hat — der Anfangswert. */
  serverFormatted: string;
  opts?: Intl.DateTimeFormatOptions;
}) {
  const [text, setText] = useState(serverFormatted);

  useEffect(() => {
    setText(formatDate(iso, lang, opts));
    // opts ist ein Objektliteral und waere bei jedem Rendern neu — es hier
    // nicht mitzuueberwachen ist Absicht, sonst laeuft der Effekt endlos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, lang]);

  return <>{text}</>;
}
