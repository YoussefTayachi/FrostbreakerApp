/**
 * Wie aus einer Antwort eine Einstufung wird, und was davon am Ende gilt.
 *
 * Zwei Dinge, die bisher an zwei Enden auseinanderliefen:
 *
 *   1. WAS DAS MODELL ZU SEHEN BEKOMMT. Es bekam den vollen Mailtext, also
 *      samt der zitierten Originalmail darunter. Am 2026-09-11 gemessen:
 *      Mike Norman antwortete mit Betreff "STOP" und dem Text
 *      "Wish you all the best. Website is good for us." -- eine Absage.
 *      Eingestuft wurde sie als 'interested'. Direkt darunter stand zitiert
 *      unsere eigene Frage "Want the prototype of your homepage before I go?
 *      A yes or no is all I need." Das Modell hat die eigene Werbung
 *      mitgelesen und danach geurteilt. Derselbe Fehler, den opt-out.ts seit
 *      jeher mit stripQuotedReply abfaengt, nur eine Funktion weiter.
 *
 *   2. WAS GILT, WENN DER MENSCH WIDERSPRICHT. Der Posteingang filterte
 *      ausschliesslich ueber messages.ai_interest. Wer im Posteingang von
 *      Hand "Kein Interesse" waehlte, aenderte contacts.outreach_status --
 *      und die Unterhaltung blieb trotzdem unter "Interessiert" stehen. Die
 *      Korrektur wurde gespeichert und dann nirgends angezeigt.
 */
import { stripQuotedReply } from "./opt-out";

/**
 * Der Text, der zur Einstufung an das Modell geht.
 *
 * Betreff mit, denn genau dort steht bei kurzen Absagen die ganze Aussage
 * ("STOP", "No thanks"). Vom Fliesstext nur der selbst geschriebene Teil.
 *
 * Faellt der Schnitt auf leer (eine Antwort, die nur aus dem Zitat besteht,
 * etwa eine Weiterleitung ohne eigenes Wort), wird der volle Text genommen:
 * lieber unscharf einstufen als gar nicht.
 */
export function classificationInput(
  subject: string | null | undefined,
  body: string | null | undefined
): string {
  const own = stripQuotedReply(body ?? "");
  const text = own || (body ?? "").trim();
  const subj = (subject ?? "").trim();
  return [subj ? `Betreff: ${subj}` : "", text].filter(Boolean).join("\n\n").slice(0, 2000);
}

/**
 * Kontaktstufen, die fuer sich schon eine Aussage ueber das Interesse sind.
 *
 * Nur die eindeutigen. 'replied' und 'contacted' stehen bewusst nicht hier:
 * "hat geantwortet" sagt nichts darueber, WIE geantwortet wurde, und wuerde
 * die Einstufung des Modells ueberschreiben, ohne etwas Besseres zu wissen.
 */
const STATUS_TO_INTEREST: Record<string, string> = {
  not_interested: "not_interested",
  lead: "interested",
  meeting_booked: "interested",
  customer: "interested",
};

/**
 * Die Einstufung, die im Posteingang gilt: Mensch vor Modell.
 *
 * Der Kontaktstatus ist das Urteil eines Menschen, ai_interest die Vermutung
 * eines Modells. Wo beide etwas sagen, gewinnt der Status -- und zwar egal,
 * wo er gesetzt wurde: im Posteingang, im Pipeline-Brett, in der Leadliste
 * oder durch ein protokolliertes Telefonat. Deshalb abgeleitet statt beim
 * Umstellen in die Nachricht zurueckgeschrieben: ein Rueckschreiben haette
 * nur den einen Weg abgedeckt, an dem es gerade auffiel.
 *
 * Die Zeile in der Zeitleiste bleibt davon unberuehrt. Dort steht weiter,
 * was das Modell zu DIESER Mail gesagt hat; das ist der Beleg, und Belege
 * schreibt man nicht um.
 */
export function effectiveInterest(
  aiInterest: string | null | undefined,
  outreachStatus: string | null | undefined
): string | null {
  return STATUS_TO_INTEREST[outreachStatus ?? ""] ?? aiInterest ?? null;
}
