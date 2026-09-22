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
  /\bannual\s+leave\b/i,
  /\bno\s+longer\s+(work|with|at)\b/i,
  /\bleft\s+the\s+(business|company)\b/i,
  /**
   * Die Kuerzestform. Bewusst OHNE /i: kleingeschrieben traefe "ooo" auch
   * "wooo" und "zooom". Gemessen am 2026-09-22 im Posteingang von retaiyn
   * haengen zwei Abwesenheitsnotizen allein daran, dass die Person statt
   * "out of office" nur "OOO" in den Betreff geschrieben hat:
   * "Lily Holden-OOO Re: ..." und "Lisa Nielsen OOO Re: ...".
   */
  /\bOOO\b/,
];

/**
 * Dieselbe Ansage, andere Sprache.
 *
 * Die Betreffzeile schreibt der Mailserver des Empfaengers, und ein
 * spanischer Exchange setzt eben "Respuesta automática:" davor, kein
 * "Automatic reply:". Am 2026-09-22 an 163 eingegangenen Antworten gemessen:
 * sieben Abwesenheitsnotizen auf Spanisch, Niederlaendisch und Schwedisch
 * standen ohne Etikett im Posteingang, obwohl sie die Vorsilbe mitbrachten.
 * Die Liste oben kannte nur Englisch und Deutsch.
 */
const SUBJECT_PATTERNS_I18N: RegExp[] = [
  /\brespuesta\s+autom[aá]tica/i, // es
  /\bautomatisch\s+antwoord/i, // nl
  /\bautomatisk\s+svar/i, // da, no
  /\bautosvar/i, // sv
  /\br[eé]ponse\s+automatique/i, // fr
  /\bmessage\s+d['’]absence/i, // fr
  /\brisposta\s+automatica/i, // it
  /\bresposta\s+autom[aá]tica/i, // pt
  /\bautomaattinen\s+vastaus/i, // fi
  /\bautomatyczna\s+odpowied/i, // pl
  /\bafwezig(heid)?\b/i, // nl
  /\bfuera\s+de\s+la\s+oficina\b/i, // es
  /\bde\s+vacaciones\b/i, // es
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
  /**
   * "the" ist optional, und "I'm" zaehlt wie "I am".
   *
   * An diesem einen Wort scheiterte die Erkennung mehrfach: "I am currently
   * out of office, I will respond on my return" ist dieselbe Aussage wie mit
   * Artikel, und etwa die Haelfte schreibt sie ohne.
   */
  /\bi(\s+am|['’]m)\s+(currently\s+)?out\s+of\s+(the\s+)?office\b/i,
  /\bich\s+bin\s+(derzeit\s+|zurzeit\s+)?nicht\s+im\s+b[uü]ro\b/i,
  /\bwill\s+be\s+(back|returning)\s+(in|on)\b.{0,30}\b(office|desk)?\b/i,
  /\bbin\s+(bis|ab)\s+dem?\s+\d/i,
  /\bon\s+(annual|parental|maternity|sick)\s+leave\b/i,
  /**
   * Der Auto-Responder des Kundendienstes.
   *
   * "Thanks for getting in touch! Please expect a response from our customer
   * service team within two working days." Am 2026-09-22 zweimal im
   * Posteingang. Keine Abwesenheitsnotiz im engeren Sinn, aber ganz sicher
   * keine Antwort eines Menschen, und genau das ist die Frage, die diese
   * Datei beantwortet. Die zugesagte Frist ist das verlaessliche Stueck
   * daran: fuer sich selbst nennt niemand eine Bearbeitungsfrist.
   */
  /\bexpect\s+a\s+(response|reply)\b[\s\S]{0,60}\bwithin\b/i,
  // Spanisch, Niederlaendisch: dieselben Saetze, andere Sprache.
  /\bestar[eé]\s+fuera\s+de\s+la\s+oficina\b/i,
  /\bestoy\s+de\s+vacaciones\b/i,
  /\b(ben\s+ik|ik\s+ben)\s+(momenteel\s+)?afwezig\b/i,
  /\bafwezig\s+wegens\b/i,
  /\bzwangerschaps?\s?verlof\b/i,
  /**
   * "Ich arbeite hier nicht mehr."
   *
   * Passt in keine der vier Kategorien sauber hinein, gehoert aber
   * zweifelsfrei nicht zu "ein Mensch hat geantwortet": es ist eine Formel,
   * und die Person, die die Kampagne meinte, liest die Mail nicht mehr. Bis
   * zum 2026-09-22 standen fuenf solche Mails ohne Etikett im Posteingang.
   *
   * Als 'out_of_office' gefuehrt und nicht als Absage, weil die Firma nicht
   * abgelehnt hat -- meist steht in derselben Mail die Adresse des
   * Nachfolgers, und das ist ein Lead und kein verbrannter Kontakt.
   */
  /\b(recently\s+)?left\s+(my\s+role\s+at|the\s+(business|company))\b/i,
  /\bno\s+longer\s+(work(ing)?\s+(at|for|with)|with|at)\b/i,
  /\bnog\s+longer\s+working\s+at\b/i, // Tippfehler im Original, so gemessen
  /\bnicht\s+mehr\s+(bei|f[uü]r)\s+(uns|der\s+firma)\s+t[aä]tig\b/i,
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
  for (const pattern of [...SUBJECT_PATTERNS, ...SUBJECT_PATTERNS_I18N]) {
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
