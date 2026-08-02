"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useT } from "./language-provider";

/**
 * Freie Zeitraumauswahl fuers Dashboard.
 *
 * Die festen Knoepfe (7/14/30/90 Tage) beantworten "die letzten X Tage", aber
 * nicht "dieser Monat" oder "die Woche der Kampagne". Genau danach wird
 * gefragt, wenn man wissen will, was eine bestimmte Aussendung gebracht hat.
 *
 * Der Zustand liegt in der URL, nicht in React: das Dashboard ist eine Server
 * Component, die ihre Zahlen selbst laedt -- ein Client-State koennte sie
 * nicht neu berechnen. Nebeneffekt: der Zeitraum bleibt teilbar und
 * ueberlebt einen Reload.
 *
 * Uebernommen wird erst, wenn BEIDE Enden gesetzt sind. Ein halb ausgefuelltes
 * Feld soll die Anzeige nicht schon umstellen, sonst springt sie waehrend der
 * Eingabe auf einen Zeitraum, den niemand gemeint hat.
 */
export default function DateRangePicker() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useT();
  const D = t.dashboard;
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  const aktiv = Boolean(params.get("from") && params.get("to"));

  function anwenden(neuFrom: string, neuTo: string) {
    setFrom(neuFrom);
    setTo(neuTo);
    if (!neuFrom || !neuTo) return;
    // Verdrehte Eingabe still korrigieren statt eine Fehlermeldung zu zeigen:
    // gemeint ist offensichtlich der Zeitraum dazwischen.
    const [a, b] = neuFrom <= neuTo ? [neuFrom, neuTo] : [neuTo, neuFrom];
    router.push(`/?from=${a}&to=${b}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => anwenden(e.target.value, to)}
        aria-label={D.rangeFrom}
        className="rounded-lg border border-edge2 bg-transparent px-2 py-1 text-xs text-soft"
      />
      <span className="text-xs text-mute">–</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => anwenden(from, e.target.value)}
        aria-label={D.rangeTo}
        className="rounded-lg border border-edge2 bg-transparent px-2 py-1 text-xs text-soft"
      />
      {aktiv && (
        <button
          onClick={() => {
            setFrom("");
            setTo("");
            router.push("/");
          }}
          className="rounded-lg border border-edge2 px-2 py-1 text-xs text-faint transition-colors hover:text-soft"
        >
          {D.rangeReset}
        </button>
      )}
    </div>
  );
}
