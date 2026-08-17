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
];

export type OptOutMatch = {
  /** Steht in dieser Antwort eine Abmeldebitte? */
  optOut: boolean;
  /** Die getroffene Stelle, fuer die Begruendung in der Sperrliste und zum Nachvollziehen. */
  phrase: string | null;
};

/**
 * Prueft den selbst geschriebenen Teil einer Antwort auf eine Abmeldebitte.
 *
 * Gibt die Fundstelle mit zurueck: eine automatisch gesperrte Adresse soll
 * nachvollziehbar sein, ohne dass man die Originalmail heraussuchen muss.
 */
export function detectOptOut(body: string): OptOutMatch {
  const own = stripQuotedReply(body ?? "");
  if (!own) return { optOut: false, phrase: null };
  for (const pattern of OPT_OUT_PATTERNS) {
    const match = pattern.exec(own);
    if (match) return { optOut: true, phrase: match[0].trim() };
  }
  return { optOut: false, phrase: null };
}
