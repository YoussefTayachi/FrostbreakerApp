import Link from "next/link";

/**
 * Kleiner Verweis von einer Arbeitsseite in den passenden Abschnitt der
 * Anleitung. Absichtlich unauffaellig: wer weiss was er tut, soll es nicht
 * wegklicken muessen; wer nicht weiterkommt, findet die Erklaerung genau dort,
 * wo die Frage entsteht -- statt sie im Hilfebereich zusammensuchen zu muessen.
 *
 * Der Anker oeffnet den gemeinten Abschnitt direkt (siehe guide-view.tsx).
 */
export default function HelpLink({ section, label }: { section: string; label: string }) {
  return (
    <Link
      href={"/guide#" + section}
      className="inline-flex items-center gap-1 text-xs text-faint underline decoration-dotted underline-offset-4 transition-colors hover:text-sky-600 dark:hover:text-sky-400"
    >
      <span aria-hidden>?</span>
      {label}
    </Link>
  );
}
