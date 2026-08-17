/**
 * Erkennung automatischer Antworten (Abwesenheit, Urlaub, verzoegerte Antwort).
 *
 * Warum das eine eigene Kategorie braucht: Die KI-Einstufung kannte nur
 * 'interested', 'not_interested' und 'question'. Eine Abwesenheitsnotiz passt
 * in keine davon und landete deshalb bei 'not_interested'. Gemessen am
 * 2026-08-03 traf das beide vorhandenen Auto-Antworten:
 *
 *   "Automatic reply: after-hours product questions"       -> not_interested
 *   "BA SLOW TO RESPOND Re: customer support costs"        -> not_interested
 *
 * Das ist inhaltlich falsch und praktisch teuer. Wer im Urlaub ist, hat nicht
 * abgelehnt; man kann ihn in zwei Wochen wieder anschreiben. Als
 * "kein Interesse" gefuehrt faellt er dagegen dauerhaft aus jeder kuenftigen
 * Kampagne heraus (api/instantly/campaigns schliesst diesen Status aus).
 *
 * WARUM MUSTER STATT KI:
 * Auto-Antworten kuendigen sich im Betreff an, und zwar in einer ueberschaubaren
 * Zahl von Formulierungen. Ein Mustervergleich ist dabei nicht nur billiger als
 * ein Modellaufruf, sondern auch verlaesslicher, und er spart den Aufruf ganz,
 * statt ihn nur zu korrigieren. Die KI bleibt fuer alles zustaendig, was sich
 * nicht am Muster erkennen laesst.
 */

/**
 * Formulierungen im BETREFF. Bewusst hier und nicht im Text: viele
 * Abwesenheitsnotizen enthalten im Fliesstext Wendungen wie "I am currently
 * out of the office", aber genauso schreibt jemand "we are out of budget" in
 * einer echten Absage. Der Betreff ist die verlaesslichere Stelle.
 */
const SUBJECT_PATTERNS: RegExp[] = [
  /\bauto[\s-]?repl(y|ied)\b/i,
  /\bautomatic(al)?\s+repl(y|ie)/i,
  /\bautomatische?\s+antwort/i,
  /\bout\s+of\s+(the\s+)?office\b/i,
  /\bofficially\s+out\b/i,
  /\babwesen(d|heit)/i,
  /\bnicht\s+im\s+(b[uü]ro|haus)\b/i,
  /\burlaub\b/i,
  /\bvacation\s+(reply|response|auto)/i,
  /\bon\s+(vacation|leave|holiday|parental\s+leave)\b/i,
  /\bmaternity\s+leave\b/i,
  /\bslow\s+to\s+respond\b/i,
  /\bdelay(ed)?\s+(in\s+)?respon(se|ding)\b/i,
  /\bexpect\s+(a\s+)?delay\b/i,
  /\baway\s+from\s+(my\s+)?(desk|email|office)\b/i,
  /\bcurrently\s+(travel|away|unavailable)/i,
  /\btraveling\b/i,
  /\bdo\s+not\s+reply\b/i,
];

/**
 * Kopfzeilen, die eine Auto-Antwort eindeutig ausweisen. Instantly liefert sie
 * uns derzeit nicht mit, deshalb ungenutzt, aber dokumentiert, weil es der
 * technisch saubere Weg waere, falls die Felder je verfuegbar werden:
 *   Auto-Submitted: auto-replied
 *   X-Autoreply / X-Autorespond
 *   Precedence: auto_reply
 */

/**
 * Formulierungen im TEXT, aber nur die eindeutigen. Sie greifen erst, wenn der
 * Betreff nichts hergibt, deshalb bewusst enger gefasst als die Liste oben.
 */
const BODY_PATTERNS: RegExp[] = [
  /\bthis\s+is\s+an\s+auto[\s-]?(matic\s+)?(reply|response|responder)\b/i,
  /\bdies\s+ist\s+eine\s+automatische\s+antwort\b/i,
  /\bi\s+am\s+(currently\s+)?out\s+of\s+the\s+office\b/i,
  /\bich\s+bin\s+(derzeit\s+|zurzeit\s+)?nicht\s+im\s+b[uü]ro\b/i,
  /\bwill\s+be\s+(back|returning)\s+(in|on)\b.{0,30}\b(office|desk)?\b/i,
  /\bbin\s+(bis|ab)\s+dem?\s+\d/i,
];

/**
 * Ist das eine automatische Abwesenheitsantwort?
 *
 * Gibt die getroffene Stelle mit zurueck, damit eine Einstufung
 * nachvollziehbar bleibt, ohne die Mail zu oeffnen.
 */
export function detectAutoReply(
  subject: string | null | undefined,
  body: string | null | undefined
): { autoReply: boolean; matched: string | null } {
  const subj = (subject ?? "").trim();
  for (const pattern of SUBJECT_PATTERNS) {
    const m = pattern.exec(subj);
    if (m) return { autoReply: true, matched: m[0].trim() };
  }
  // Nur der Anfang des Textes: eine zitierte Originalmail weiter unten kann
  // dieselben Wendungen enthalten, ohne dass die Antwort selbst automatisch
  // waere. Dieselbe Ueberlegung wie bei der Abmeldeerkennung in opt-out.ts,
  // hier aber ohne vollen Zitat-Schnitt: Auto-Antworten stehen immer oben.
  const head = (body ?? "").slice(0, 500);
  for (const pattern of BODY_PATTERNS) {
    const m = pattern.exec(head);
    if (m) return { autoReply: true, matched: m[0].trim() };
  }
  return { autoReply: false, matched: null };
}
