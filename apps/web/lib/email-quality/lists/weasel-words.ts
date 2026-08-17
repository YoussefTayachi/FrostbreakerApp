import type { Lang } from "../types";

// Fuellwoerter, die eine Aussage weich machen ("eigentlich mal kurz") und in
// Kaltakquise besonders teuer sind: sie kosten Zeichen und nehmen dem Satz die
// Verbindlichkeit. Kuratiert nach dem Vorbild der bekannten
// Weasel-Word-Listen (write-good, Hemingway), aber als eigene Liste gefuehrt,
// weil Deutsch ohnehin eine eigene braucht.
const WEASEL_DE = [
  "eigentlich", "irgendwie", "vielleicht", "eventuell", "gewissermassen",
  "gewissermaßen", "sozusagen", "quasi", "relativ", "ziemlich", "recht",
  "einigermassen", "einigermaßen", "im grunde", "im prinzip", "in der regel",
  "tendenziell", "grundsätzlich", "praktisch", "wahrscheinlich", "vermutlich",
  "eher", "etwas", "ein bisschen", "ein wenig", "mal kurz", "einfach mal",
  "unter umständen", "möglicherweise", "eventuel",
] as const;

const WEASEL_EN = [
  "actually", "basically", "literally", "virtually", "essentially",
  "arguably", "somewhat", "rather", "quite", "fairly", "pretty much",
  "sort of", "kind of", "a bit", "a little", "just", "really", "very",
  "maybe", "perhaps", "possibly", "probably", "in general", "more or less",
] as const;

// Verstaerker/Adverbien: im Englischen faengt die "-ly"-Regel das meiste ab,
// im Deutschen gibt es keine vergleichbare Endung (Adverb und Adjektiv sind
// formgleich), also bleibt nur eine kuratierte Liste.
const ADVERBS_DE = [
  "sehr", "wirklich", "total", "extrem", "absolut", "definitiv", "unbedingt",
  "äußerst", "höchst", "besonders", "ausgesprochen", "durchaus", "überaus",
  "enorm", "riesig", "wahnsinnig", "megamäßig", "super",
] as const;

// Woerter auf "-ly", die keine Adverbien sind; ohne diese Ausnahmen wuerde
// jedes "reply" oder "supply" in einer Vertriebsmail angemeckert.
const LY_EXCEPTIONS_EN = new Set([
  "reply", "supply", "apply", "family", "rally", "ally", "bully", "belly",
  "jelly", "italy", "only", "early", "holy", "ugly", "silly", "daily",
  "weekly", "monthly", "yearly", "likely", "friendly", "lovely", "costly",
  "multiply", "imply", "comply", "assembly", "monopoly", "anomaly", "july",
]);

export const WEASEL_WORDS: Record<Lang, readonly string[]> = {
  de: WEASEL_DE,
  en: WEASEL_EN,
};

export const ADVERBS: Record<Lang, readonly string[]> = {
  de: ADVERBS_DE,
  en: [], // Englisch laeuft ueber die "-ly"-Regel, siehe readability.ts
};

export { LY_EXCEPTIONS_EN };
