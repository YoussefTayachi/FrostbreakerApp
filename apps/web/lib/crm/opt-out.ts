/**
 * Erkennung einer Abmeldebitte in einer eingehenden Antwort.
 *
 * Hintergrund: Die Signatur der Kampagnen-Mails endet mit "reply 'stop' and
 * I'll leave you alone" (siehe .claude/skills/cold-email-copy). Diese Zusage
 * wurde bisher nirgends eingeloest: die Sperrliste hatte am 2026-08-03
 * exakt null Eintraege, obwohl mehrere Kampagnen liefen. Wer "stop" antwortet,
 * bekommt beim naechsten Lauf wieder Post. Das ist nicht nur unhoeflich,
 * sondern bei einer ausgesprochenen Zusage auch rechtlich heikel.
 *
 * DIE FALLE, DIE DIESE DATEI VOR ALLEM ABFAENGT:
 * Eine Antwort enthaelt fast immer die zitierte Originalmail. In deren Fuss
 * steht bei Kampagnen-Mails ueblicherweise genau das Wort, nach dem hier
 * gesucht wird ("reply stop", ein Abmeldelink, "unsubscribe"). Eine naive
 * Textsuche wuerde deshalb JEDEN Antwortenden sperren, auch den, der gerade
 * "klingt spannend, wann haben Sie Zeit?" geschrieben hat. Aus einem
 * Sicherheitsnetz wuerde ein Schredder fuer die besten Leads.
 *
 * Deshalb wird zuerst alles ab der ersten Zitatgrenze abgeschnitten und nur
 * der tatsaechlich neu geschriebene Teil geprueft.
 */

/**
 * Zitatgrenzen, ab denen der Text nicht mehr vom Absender stammt.
 *
 * Bewusst breit: lieber einmal zu frueh abschneiden (dann wird eine echte
 * Abmeldung uebersehen und der Nutzer traegt sie von Hand ein) als zu spaet
 * (dann wird ein interessierter Lead automatisch gesperrt). Die Kosten der
 * beiden Fehler sind sehr unterschiedlich.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^>/m, // klassisches Zitatzeichen
  /^-{2,}\s*(original message|urspr[uü]ngliche nachricht|forwarded message)/im,
  /^_{5,}/m, // Outlooks Trennlinie
  /^on .{0,120}\bwrote:/im, // "On Mon, 3 Aug 2026 at 09:12, Max wrote:"
  /^am .{0,120}\bschrieb\b/im, // deutsches Gegenstueck
  /^le .{0,120}\ba [ée]crit/im,
  /^from:\s/im, // weitergeleiteter Kopf
  /^von:\s/im,
  /^sent:\s/im,
  /^gesendet:\s/im,
];

/**
 * Alles ab der ersten Zitatgrenze abschneiden.
 *
 * Exportiert, weil der Schnitt fuer sich testbar sein soll: er ist der
 * eigentlich heikle Teil, nicht die Wortliste.
 */
export function stripQuotedReply(text: string): string {
  if (!text) return "";
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).trim();
}

/**
 * Formulierungen, die eine Abmeldung ausdruecken.
 *
 * Bewusst NUR ausdrueckliche Abmeldebitten, kein "kein Interesse" und kein
 * "passt gerade nicht". Das sind zwei verschiedene Dinge:
 *
 *   Abmeldung      -> "schreib mir nie wieder"  -> Sperrliste, gilt dauerhaft
 *                                                  und ueber alle Kampagnen
 *   kein Interesse -> "diesmal nicht"           -> Kontaktstatus, in einem
 *                                                  halben Jahr evtl. wieder
 *
 * Die zweite Sorte wird an anderer Stelle behandelt (outreach_status), nicht
 * hier. Beides in einen Topf zu werfen wuerde entweder zu viele Leads
 * dauerhaft verbrennen oder eine echte Abmeldung nicht ernst genug nehmen.
 *
 * \b an beiden Enden: ohne Wortgrenze traefe "stop" auch "workshop",
 * "stopped" und "nonstop", und "remove" jedes "removed from the list".
 */
const OPT_OUT_PATTERNS: RegExp[] = [
  // Das Wort aus der eigenen Signatur. Alleinstehend oder als klare Bitte.
  /^\s*stop[\s.!]*$/im,
  /\bplease\s+stop\b/i,
  /\bstop\s+(emailing|contacting|messaging)\b/i,
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove\s+me\b/i,
  /\btake\s+me\s+off\b/i,
  /\bdo\s+not\s+(contact|email)\s+me\b/i,
  /\bdon'?t\s+(contact|email)\s+me\b/i,
  /\bno\s+longer\s+wish\s+to\s+receive\b/i,
  // Deutsch
  /\babmelden\b/i,
  /\babmeldung\b/i,
  /\baustragen\b/i,
  // "(e-?)?" statt "e-?": "Keine weiteren Mails" schreibt kaum jemand mit
  // fuehrendem E, und genau daran scheiterte die erste Fassung.
  /\bkeine\s+(weiteren\s+)?((e-?)?mails?|nachrichten|werbung|post)\b/i,
  /\bnicht\s+mehr\s+(schreiben|kontaktieren|anschreiben)\b/i,
  /\bbitte\s+l[oö]schen\s+sie\s+(meine|unsere)\s+(daten|adresse)\b/i,
  /\bwiderspruch\b/i,
  /**
   * Und in den Sprachen, in die die Kampagnen tatsaechlich gehen.
   *
   * Gemessen am 2026-09-22: "Dar de baja" stand als einziger Satz im Text
   * einer Antwort und blieb folgenlos, weil die Liste nur Englisch und
   * Deutsch kannte. Die Zusage "reply 'stop' and I'll leave you alone" gilt
   * aber unabhaengig davon, in welcher Sprache jemand sie einloest.
   *
   * Bewusst nur die vollstaendigen Wendungen: "baja" allein heisst auf
   * Spanisch auch "niedrig", und ein Wort, das die halbe Liste sperrt, waere
   * genau der Schredder, vor dem der Kopf dieser Datei warnt.
   */
  /\bdar(me|nos)?\s+de\s+baja\b/i, // es
  /\bcancelar\s+(la\s+)?suscripci[oó]n\b/i, // es
  /\bno\s+(quiero|deseo)\s+recibir\s+m[aá]s\b/i, // es
  /\bd[eé]sabonn(er|ez|ement)\b/i, // fr
  /\bme\s+d[eé]sinscrire\b/i, // fr
  /\buitschrijven\b/i, // nl
  /\bafmelden\s+(voor|van)\b/i, // nl
  /\bavregistrera\b/i, // sv
];

export type OptOutMatch = {
  /** Steht in dieser Antwort eine Abmeldebitte? */
  optOut: boolean;
  /** Die getroffene Stelle, fuer die Begruendung in der Sperrliste und zum Nachvollziehen. */
  phrase: string | null;
};

/**
 * Antwort-Vorsilben abschneiden ("Re:", "AW:", "Fwd:", auch mehrfach).
 *
 * Noetig, weil die Abmeldung im Betreff sonst an genau einem Zeichen
 * scheitert: das Muster fuer ein alleinstehendes "stop" verlangt, dass nichts
 * sonst in der Zeile steht, und "Re: STOP" hat genau das.
 */
function stripReplyPrefix(subject: string): string {
  return subject.replace(/^\s*((re|aw|fw|fwd|wg)\s*:\s*)+/i, "").trim();
}

/**
 * Prueft den selbst geschriebenen Teil einer Antwort auf eine Abmeldebitte.
 *
 * DER BETREFF ZAEHLT MIT, und zwar nicht als Beiwerk.
 * Am 2026-09-11 schrieb ein Empfaenger "STOP" in den Betreff und in den Text
 * "Wish you all the best. Website is good for us." Der Text enthaelt keine
 * einzige Abmeldeformel: die Adresse landete nicht auf der Sperrliste,
 * obwohl die Absage im Betreff stand und nicht deutlicher haette sein
 * koennen. Wer das Wort in die Betreffzeile schreibt, meint es genauso
 * ernst wie im Text.
 *
 * Der Betreff wird ungeschnitten geprueft (er hat keine Zitatgrenze), aber
 * ohne "Re:"/"AW:"-Vorsilbe, sonst greift das Muster fuer ein
 * alleinstehendes "stop" nie.
 *
 * Gibt die Fundstelle mit zurueck: eine automatisch gesperrte Adresse soll
 * nachvollziehbar sein, ohne dass man die Originalmail heraussuchen muss.
 */
export function detectOptOut(body: string, subject?: string | null): OptOutMatch {
  const own = stripQuotedReply(body ?? "");
  const subj = stripReplyPrefix(subject ?? "");
  for (const haystack of [own, subj]) {
    if (!haystack) continue;
    for (const pattern of OPT_OUT_PATTERNS) {
      const match = pattern.exec(haystack);
      if (match) return { optOut: true, phrase: match[0].trim() };
    }
  }
  return { optOut: false, phrase: null };
}
