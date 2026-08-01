// Sowohl die KI-Recherche (find_decisionmaker, beliebig viele Personen) als
// auch Hunters Domain-Search (bis zu 5 Personen, nur Maps-Modus) finden
// bewusst mehrere moegliche Ansprechpartner pro Firma, um die Chance auf einen
// echten Entscheider zu maximieren. Beim Kampagnen-Versand darf davon aber nur
// EINE Person tatsaechlich angeschrieben werden -- alle Mitarbeitenden
// anzuschreiben waere Spam und schadet der Zustellbarkeit. Diese Rangliste
// waehlt pro Firma die ranghoechste Person nach Jobtitel.
// Reihenfolge ist hier Pruef-Reihenfolge, nicht Rang-Reihenfolge: "Vice
// President" enthaelt das Wort "president" und muss deshalb VOR dem
// allgemeinen President/Owner/CEO-Muster geprueft werden, sonst wuerde ein VP
// faelschlich als Rang 0 (Geschaeftsfuehrer-Ebene) statt Rang 1 eingestuft.
//
// Die deutschen Praefixe (gruender/geschaeftsfuehr) stehen bewusst OHNE
// abschliessendes \b in einem eigenen Muster: JS-Regex behandelt "\w" als rein
// ASCII, "ä"/"ü" zaehlen also nicht als Wortzeichen. Ein abschliessendes \b
// nach "geschäftsführ" wuerde deshalb an der Flexionsendung ("führer",
// "führerin") scheitern, weil beide Seiten dort "\w"-Zeichen sind (kein Sprung
// von Wort- zu Nicht-Wortzeichen).
const TITLE_RANK: { pattern: RegExp; rank: number }[] = [
  { pattern: /\b(vice president|\bvp\b|evp|svp|cfo|coo|cto|cmo|chief \w+ officer)\b/i, rank: 1 },
  { pattern: /\b(owner|founder|inhaber|ceo|chief executive|president|managing director|partner)\b/i, rank: 0 },
  { pattern: /gründer|gruender|geschäftsführ|geschaeftsfuehr/i, rank: 0 },
  { pattern: /\b(director|head of|leiter)\b/i, rank: 2 },
  { pattern: /\bmanager\b/i, rank: 3 },
];

/**
 * Verifizierungs-Status, bei denen ein Versand der Absender-Reputation aktiv
 * schadet -- unabhaengig davon, ob Hunter oder NeverBounce ihn gesetzt hat:
 *
 *   invalid    Postfach existiert nachweislich nicht -> garantierter Bounce
 *   disposable Wegwerf-Adresse -> haeufig Spamtrap, nie ein echter Empfaenger
 *
 * Bewusst NICHT gefiltert:
 *   catchall/accept_all  Domain nimmt alles an, zaehlt nicht als Bounce
 *   unknown              Server hat nicht eindeutig geantwortet (oft nur ein
 *                        Timeout) -- ein Ausschluss waere hier eine Wette
 *                        gegen den Lead, keine belegte Aussage
 *   null                 noch nicht geprueft; wer nie verifiziert, soll nicht
 *                        stillschweigend eine leere Kampagne bekommen
 *
 * Bis hierhin filterte die Kampagnen-Erstellung nur Sperrliste und "kein
 * Interesse" -- das Verifizierungsergebnis blieb ungenutzt, obwohl es genau
 * dafuer erhoben wird.
 */
const UNSENDABLE_STATUS = new Set(["invalid", "disposable"]);

export function isSendableEmail(status: string | null | undefined): boolean {
  return !status || !UNSENDABLE_STATUS.has(status);
}

/** Trennt in versendbar und "wuerde bouncen", damit der Aufrufer die
 *  aussortierte Menge benennen kann statt sie stillschweigend zu schlucken. */
export function splitBySendability<T extends { email_verification_status: string | null }>(
  contacts: T[]
): { sendable: T[]; unsendable: T[] } {
  const sendable: T[] = [];
  const unsendable: T[] = [];
  for (const c of contacts) {
    (isSendableEmail(c.email_verification_status) ? sendable : unsendable).push(c);
  }
  return { sendable, unsendable };
}

export function rankContactTitle(title: string | null | undefined): number {
  if (!title) return 5;
  for (const { pattern, rank } of TITLE_RANK) {
    if (pattern.test(title)) return rank;
  }
  return 4;
}

/**
 * Reduziert eine Kontaktliste auf maximal eine Person pro Firma. Ist bei einer
 * Firma ein Kontakt manuell als is_primary markiert (Nutzer hat ihn im
 * Leads-Drawer explizit ausgewaehlt), gewinnt dieser immer -- unabhaengig vom
 * Titel. Sonst entscheidet weiterhin rankContactTitle, bei Gleichstand
 * gewinnt die zuerst uebergebene Person (stabil). Kontakte ohne business_id
 * bleiben unveraendert erhalten (kann bei Aufrufern vorkommen, die das Feld
 * nicht laden).
 */
export function pickPrimaryContactPerBusiness<
  T extends { business_id?: string | null; title?: string | null; is_primary?: boolean | null },
>(contacts: T[]): T[] {
  const withBusiness = contacts.filter((c) => c.business_id);
  const withoutBusiness = contacts.filter((c) => !c.business_id);

  const best = new Map<string, T>();
  for (const c of withBusiness) {
    const key = c.business_id as string;
    const current = best.get(key);
    if (!current) {
      best.set(key, c);
      continue;
    }
    if (c.is_primary && !current.is_primary) {
      best.set(key, c);
    } else if (!c.is_primary && current.is_primary) {
      // current bleibt manuell ausgewaehlter Gewinner
    } else if (rankContactTitle(c.title) < rankContactTitle(current.title)) {
      best.set(key, c);
    }
  }

  return [...best.values(), ...withoutBusiness];
}
