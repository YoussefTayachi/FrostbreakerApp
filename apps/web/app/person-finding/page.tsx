import PersonFindingReview from "./person-finding-review";

/**
 * Die Pruefschleife fuer den Personen-Befund (Migrationen 0118, 0119).
 *
 * Eigene Seite neben /icebreaker, nicht ein dritter Reiter dort: die
 * dortige Liste liest aus businesses, dieser Text lebt am Kontakt, und der
 * entscheidende Teil ist hier die Provenienz unter dem Absatz. Die Daten
 * holt die Client-Komponente ueber api/person-finding/review.
 */
export default function PersonFindingPage() {
  return <PersonFindingReview />;
}
