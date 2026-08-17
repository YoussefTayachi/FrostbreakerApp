import type { Lang, SpamCategory } from "../types";

// Klassische Spam-Trigger, nach Motiv gruppiert. Kein Filter entscheidet heute
// noch allein an Stichwoertern; in Kombination mit einer kalten Domain und
// vielen Empfaengern kippen sie die Zustellung aber sehr wohl, und genau diese
// Kombination ist bei Kaltakquise der Normalfall. Die Gruppierung nach Motiv
// ist wichtiger als Vollstaendigkeit: sie sagt dem Nutzer, *warum* eine
// Formulierung teuer ist, statt nur Woerter rot zu faerben.

const DE: Record<SpamCategory, readonly string[]> = {
  money: [
    "gratis", "kostenlos", "umsonst", "geschenkt", "sparen sie", "rabatt",
    "sonderangebot", "schnäppchen", "geld zurück", "cashback", "provision",
    "zusatzeinkommen", "nebenverdienst", "investition", "rendite", "kredit",
    "günstigster preis", "bestpreis", "zum nulltarif", "keine kosten",
    "ohne kosten", "risikofrei", "100% kostenlos",
  ],
  urgency: [
    "jetzt handeln", "sofort handeln", "nicht warten", "dringend", "eilt",
    "letzte chance", "nur heute", "nur für kurze zeit", "begrenztes angebot",
    "läuft ab", "endet bald", "sichern sie sich jetzt", "schnell sein",
    "verpassen sie nicht", "nur noch heute", "solange der vorrat reicht",
    "handeln sie jetzt",
  ],
  "exaggerated-claims": [
    "garantiert", "garantie", "100% sicher", "wunder", "sensationell",
    "unglaublich", "einmalig", "revolutionär", "bahnbrechend", "der beste",
    "nummer 1", "marktführer", "explodieren", "verdoppeln sie", "verdreifachen",
    "sofortiger erfolg", "über nacht", "ohne risiko", "kein risiko",
    "todsicher", "unschlagbar",
  ],
  "trust-manipulation": [
    "lieber freund", "liebe freundin", "herzlichen glückwunsch", "gewonnen",
    "sie wurden ausgewählt", "sie sind der gewinner", "kein spam",
    "dies ist keine werbung", "vertraulich", "streng vertraulich",
    "klicken sie hier", "hier klicken", "abmelden", "werbung",
    "ohne verpflichtung", "unverbindlich testen", "exklusiv für sie",
  ],
};

const EN: Record<SpamCategory, readonly string[]> = {
  money: [
    "free", "100% free", "free of charge", "no cost", "no fees", "cash",
    "cash bonus", "extra income", "make money", "earn extra", "double your income",
    "save big", "discount", "lowest price", "best price", "money back",
    "cash back", "refund", "investment", "credit", "loan", "pre-approved",
    "risk-free", "no catch", "$$$",
  ],
  urgency: [
    "act now", "act immediately", "apply now", "buy now", "call now",
    "don't wait", "do not delay", "urgent", "limited time", "limited offer",
    "last chance", "final notice", "expires", "expires today", "today only",
    "while supplies last", "hurry", "instant", "immediately",
  ],
  "exaggerated-claims": [
    "guarantee", "guaranteed", "100% guaranteed", "miracle", "amazing",
    "unbelievable", "incredible", "revolutionary", "breakthrough",
    "once in a lifetime", "the best", "number one", "#1", "world class",
    "explode", "skyrocket", "double your", "triple your", "no risk",
    "risk free", "promise you", "unbeatable",
  ],
  "trust-manipulation": [
    "dear friend", "congratulations", "you have been selected", "you are a winner",
    "winner", "this is not spam", "not spam", "no strings attached",
    "confidential", "strictly confidential", "click here", "click below",
    "open immediately", "unsubscribe", "opt in", "special promotion",
    "exclusively for you", "no obligation",
  ],
};

export const SPAM_WORDS: Record<Lang, Record<SpamCategory, readonly string[]>> = { de: DE, en: EN };

export const SPAM_CATEGORIES: readonly SpamCategory[] = [
  "money",
  "urgency",
  "exaggerated-claims",
  "trust-manipulation",
];
