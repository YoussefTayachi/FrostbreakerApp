import Link from "next/link";

/**
 * Kleiner Verweis von einer Arbeitsseite in den passenden Abschnitt der
 * Anleitung. Absichtlich unauffaellig: wer weiss was er tut, soll es nicht
 * wegklicken muessen; wer nicht weiterkommt, findet die Erklaerung genau dort,
 * wo die Frage entsteht, statt sie im Hilfebereich zusammensuchen zu muessen.
 *
 * Der Anker oeffnet den gemeinten Abschnitt direkt (siehe guide-view.tsx).
 */
export default function HelpLink({ section, label }: { section: string; label: string }) {
  return (
    <Link
      href={"/guide#" + section}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs text-faint transition-colors hover:text-sky-600 dark:hover:text-sky-400"
    >
      {/* Das Fragezeichen in einem eigenen Kreis statt als nacktes Zeichen vor
          dem Text: unterstrichen sah es aus, als gehoere es zum Wort. Die
          Unterstreichung sitzt deshalb am Text und nicht am Link -- eine
          text-decoration des Elternelements zeichnet durch alle Nachkommen
          hindurch und laesst sich vom Kind aus nicht zuruecknehmen. */}
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-2xs"
      >
        ?
      </span>
      <span className="underline decoration-dotted underline-offset-4">{label}</span>
    </Link>
  );
}
