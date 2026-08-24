import IcebreakerReview from "./icebreaker-review";

/**
 * Die Pruefschleife fuer die erzeugten Texte: Aufhaenger UND Website-Befund.
 *
 * Eigene Seite statt eines Reiters im AI-Agent-Tab: dort stehen die VORGABEN
 * (Prompts, Wortgrenze, Verbotswoerter), hier steht das ERGEBNIS. Beides auf
 * eine Seite zu legen haette bedeutet, dass man zum Nachbessern von 700
 * Zeilen jedes Mal an der Prompt-Einstellung vorbeiscrollt, und zum
 * Aendern des Prompts an 700 Zeilen.
 *
 * Seit dem 2026-08-24 liegen beide Textsorten hier, umschaltbar in der
 * Client-Komponente (Migration 0103). KEINE zweite Seite fuer den Befund: es
 * ist dieselbe Arbeit an derselben Sorte Text, mit denselben drei
 * Handgriffen. Zwei Seiten wuerden bei der naechsten Aenderung an einer
 * Stelle nachgezogen und an der anderen vergessen.
 *
 * Der Pfad heisst weiter /icebreaker: der Aufhaenger ist der Hauptfall (er
 * geht an jeden Lead), und ein Umbenennen wuerde jeden gespeicherten Link und
 * die Verweise aus dem Torwart brechen, ohne dass jemand etwas davon haette.
 *
 * Die Daten holt die Client-Komponente ueber api/personalization/review; sie
 * werden dort gegen die geltenden Vorgaben nachgerechnet, statt die
 * gespeicherte Markierung zu glauben (siehe lib/personalization/review.ts).
 */
export default function IcebreakerPage() {
  return <IcebreakerReview />;
}
