// Muss inhaltlich mit apps/worker/worker/pipelines/person_finding.py
// uebereinstimmen (PERSON_FINDING_MAX_WORDS, PERSON_BANNED_EN, PERSON_BANNED_DE):
// der Worker erzeugt und prueft damit, der Torwart rechnet damit, und die
// Kontakt-Prueflliste prueft einen von Hand geschriebenen Absatz dagegen.
//
// Die Bindung gilt in beide Richtungen und wird von
// person-finding-defaults.test.ts erzwungen, das den Python-Quelltext einliest.
// Dieselbe Bauart wie lib/website-finding-defaults.ts, aus demselben Grund:
// zwei Fassungen derselben Zahl weichen auseinander, ohne dass es jemand
// sieht, und die Pruefliste meldet dann Verstoesse, die beim Erzeugen keine
// waren.

/**
 * Die Wortgrenze des Absatzes.
 *
 * Gegenstueck zu PERSON_FINDING_MAX_WORDS im Worker. 120 seit dem 2026-09-22
 * als Deckel gegen Absurdes, nicht als Ziel: Regel von Youssef, die Wortzahl
 * hat keine Prioritaet, solange der Absatz nicht laecherlich lang wird (150
 * und mehr). Lesbar, relevant, echte Schmerzpunkte, Wert fuer den Leser.
 * Die erste Mail mit diesem Absatz darf deshalb 150 Woerter haben
 * (FIRST_MAIL_MAX_WORDS_WITH_PERSON_FINDING in campaign-readiness.ts).
 */
export const PERSON_FINDING_MAX_WORDS = 120;

/**
 * Die eigene Verbotsliste dieses Textes, je Sprache.
 *
 * Nicht die Workspace-Liste: die verbietet im retaiyn-Workspace "I saw" und
 * "I noticed", und dieser Absatz MUSS seine Herkunft nennen. Aus der
 * Workspace-Liste werden nur die reinen Satzzeichen (Striche) uebernommen,
 * siehe personBannedWords. Woertlich aus dem Worker abgeschrieben.
 */
export const PERSON_BANNED_EN: readonly string[] = [
  "i think",
  "i believe",
  "i feel",
  "probably",
  "perhaps",
  "maybe",
  "would",
  "could",
  "might",
  "it seems",
  "seems",
  "may be",
  "may not",
  "likely",
  "i suspect",
  "a bit",
  "kind of",
  "sort of",
  "just wanted to",
  "love",
  "impressive",
  "passionate",
  "congrats",
  "congratulations",
  "huge fan",
  "reaching out",
  "that's why i",
  "that’s why i",
];

export const PERSON_BANNED_DE: readonly string[] = [
  "ich denke",
  "ich glaube",
  "vielleicht",
  "eventuell",
  "koennte",
  "könnte",
  "koennten",
  "könnten",
  "wuerde",
  "würde",
  "wuerden",
  "würden",
  "wahrscheinlich",
  "moeglicherweise",
  "möglicherweise",
  "vermutlich",
  "ein bisschen",
  "wollte nur",
  "beeindruckend",
  "glueckwunsch",
  "glückwunsch",
  "grosser fan",
  "großer fan",
  "deswegen melde ich",
  "deshalb melde ich",
];

/** Besteht der Eintrag nur aus Satzzeichen? Gegenstueck zu
 *  personalize._is_punctuation_only. */
function isPunctuationOnly(word: string): boolean {
  return word.length > 0 && !/[\p{L}\p{N}]/u.test(word);
}

/**
 * Die wirksame Verbotsliste des Absatzes: Striche aus der Workspace-Liste
 * plus die eigene Liste der Sprache. Gegenstueck zu person_banned_words im
 * Worker.
 */
export function personBannedWords(workspaceBanned: readonly string[], lang: "de" | "en"): string[] {
  const striche = workspaceBanned.map((w) => w.trim()).filter((w) => isPunctuationOnly(w));
  return [...striche, ...(lang === "en" ? PERSON_BANNED_EN : PERSON_BANNED_DE)];
}
