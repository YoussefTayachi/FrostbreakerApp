import IcebreakerReview from "./icebreaker-review";

/**
 * Die Pruefschleife fuer die KI-Aufhaenger.
 *
 * Eigene Seite statt eines Reiters im AI-Agent-Tab: dort stehen die VORGABEN
 * (Prompt, Wortgrenze, Verbotswoerter), hier steht das ERGEBNIS. Beides auf
 * eine Seite zu legen haette bedeutet, dass man zum Nachbessern von 700
 * Zeilen jedes Mal an der Prompt-Einstellung vorbeiscrollt, und zum
 * Aendern des Prompts an 700 Zeilen.
 *
 * Die Daten holt die Client-Komponente ueber api/personalization/review; sie
 * werden dort gegen die geltenden Vorgaben nachgerechnet, statt die
 * gespeicherte Markierung zu glauben (siehe lib/personalization/review.ts).
 */
export default function IcebreakerPage() {
  return <IcebreakerReview />;
}
