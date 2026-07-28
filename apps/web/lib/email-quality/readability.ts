import type { Lang, QualityIssue, ReadabilityBand, ReadabilityResult } from "./types";
import { ADVERBS, LY_EXCEPTIONS_EN, WEASEL_WORDS } from "./lists/weasel-words";
import { countSyllables, findPhrases, normalizeVariables, splitSentences, splitWords } from "./text-utils";

// Lesbarkeitsanalyse im Stil von Hemingway: eine Gesamtnote plus konkrete
// Stellen (lange Saetze, Passiv, Fuellwoerter). Bewusst ohne Bibliothek --
// `write-good` koennte zwar Englisch, kennt aber kein Deutsch, und eine
// zweite, nur halb passende Taxonomie neben der deutschen Liste waere fuer
// zweisprachige Nutzer schlechter als eine einheitliche eigene.

/** Ab dieser Wortzahl gilt ein Satz als schwer, ab der zweiten als sehr schwer. */
const SENTENCE_LIMITS: Record<Lang, { hard: number; veryHard: number }> = {
  // Deutsch laeuft durch Nebensatzbau und Komposita von Haus aus laenger.
  de: { hard: 22, veryHard: 30 },
  en: { hard: 20, veryHard: 25 },
};

const BE_FORMS_EN = ["am", "is", "are", "was", "were", "be", "been", "being"];
const IRREGULAR_PARTICIPLES_EN = new Set([
  "done", "made", "sent", "seen", "given", "taken", "written", "built", "brought",
  "bought", "found", "held", "kept", "left", "lost", "paid", "put", "read", "said",
  "sold", "set", "shown", "spent", "told", "understood", "won", "chosen", "driven",
  "known", "grown", "drawn", "broken", "spoken", "run", "cut", "hit", "let",
]);

const PASSIVE_AUX_DE = [
  "wird", "werden", "werde", "wirst", "werdet", "wurde", "wurden", "wurdest",
  "worden", "würde", "würden",
  // Zustandspassiv ("ist erledigt", "sind optimiert")
  "ist", "sind", "war", "waren",
];

/** Wie viele Woerter nach dem Hilfsverb noch nach dem Partizip gesucht wird. */
const PASSIVE_WINDOW: Record<Lang, number> = {
  // Deutsche Verbklammer stellt das Partizip ans Satzende: "wird Ihnen morgen zugeschickt".
  de: 6,
  en: 4,
};

function isParticipleEn(word: string): boolean {
  const w = word.toLowerCase();
  return IRREGULAR_PARTICIPLES_EN.has(w) || (w.length > 3 && w.endsWith("ed"));
}

// Adjektive, die formal wie ein Partizip aussehen: "ist bekannt", "ist
// erwähnenswert", "ist verfügbar" sind kein Passiv. Die Endungen fangen den
// produktiven Teil ab (-wert/-bar/-sam/-haft/-lich/-ig), der Rest ist eine
// kurze Liste haeufiger Einzelfaelle.
const PARTICIPLE_LOOKALIKE_SUFFIX_DE = /(wert|bar|sam|haft|lich|ig)$/;
const PARTICIPLE_LOOKALIKES_DE = new Set([
  "bekannt", "gesamt", "bereit", "verwandt", "ernst", "erst", "exakt",
  "direkt", "perfekt", "komplett", "konkret", "korrekt", "verschieden",
]);

function isParticipleDe(word: string): boolean {
  const w = word.toLowerCase();
  if (PARTICIPLE_LOOKALIKES_DE.has(w) || PARTICIPLE_LOOKALIKE_SUFFIX_DE.test(w)) return false;
  // "geliefert", "gesendet", "gesehen"
  if (/^ge\p{L}{2,}(t|en)$/u.test(w)) return true;
  // "optimiert", "kalkuliert" -- Fremdverben bilden das Partizip ohne "ge-".
  if (/\p{L}{3,}iert$/u.test(w)) return true;
  // "bestellt", "versendet", "entwickelt". Nur die Endung "t": Partizipien auf
  // "-en" ohne "ge-" ("beschrieben") sind formgleich mit dem Infinitiv
  // ("verkaufen"), und "wird verkaufen" ist Futur, kein Passiv -- lieber ein
  // paar Treffer verpassen als aktive Saetze faelschlich anmeckern.
  if (/^(be|ver|ent|er|zer|emp|miss)\p{L}{2,}t$/u.test(w)) return true;
  return false;
}

type Sentence = { text: string; start: number; end: number };

function findPassive(sentence: Sentence, lang: Lang): { start: number; end: number } | null {
  const words = splitWords(sentence.text);
  const auxList = lang === "de" ? PASSIVE_AUX_DE : BE_FORMS_EN;
  const isParticiple = lang === "de" ? isParticipleDe : isParticipleEn;

  for (let i = 0; i < words.length; i++) {
    if (!auxList.includes(words[i].text.toLowerCase())) continue;
    const limit = Math.min(words.length, i + 1 + PASSIVE_WINDOW[lang]);
    for (let j = i + 1; j < limit; j++) {
      if (isParticiple(words[j].text)) {
        return { start: sentence.start + words[i].start, end: sentence.start + words[j].end };
      }
    }
  }
  return null;
}

function bandFor(score: number): ReadabilityBand {
  if (score >= 80) return "very-easy";
  if (score >= 60) return "easy";
  if (score >= 50) return "medium";
  if (score >= 30) return "difficult";
  return "very-difficult";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const EMPTY: Omit<ReadabilityResult, "lang"> = {
  readingEaseScore: 0,
  gradeLevel: null,
  band: "medium",
  wordCount: 0,
  sentenceCount: 0,
  avgSentenceLength: 0,
  avgSyllablesPerWord: 0,
  passiveRatio: 0,
  issues: [],
};

/**
 * Bewertet den Mailtext. Laeuft nur auf dem Body -- eine Betreffzeile ist zu
 * kurz, als dass satzbasierte Formeln daraus etwas Sinnvolles ableiten
 * koennten.
 */
export function checkReadability(rawBody: string, lang: Lang): ReadabilityResult {
  // Laengengleich normalisiert: Offsets passen weiterhin auf `rawBody`, die
  // zitierten Textstellen kommen deshalb aus dem Original (mit "{{firstName}}").
  const text = normalizeVariables(rawBody);
  const sentences = splitSentences(text, lang);
  const words = splitWords(text);

  if (words.length === 0 || sentences.length === 0) return { lang, ...EMPTY };

  const syllables = words.map((w) => countSyllables(w.text, lang));
  const totalSyllables = syllables.reduce((a, b) => a + b, 0);
  const avgSentenceLength = words.length / sentences.length;
  const avgSyllablesPerWord = totalSyllables / words.length;

  const readingEaseScore = clamp(
    lang === "de"
      ? // Amstad-Anpassung des Flesch-Index fuer Deutsch. Die englischen
        // Konstanten sind auf englische Wortlaengen geeicht und liefern fuer
        // deutsche Komposita systematisch zu harte Werte.
        180 - avgSentenceLength - 58.5 * avgSyllablesPerWord
      : 206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord,
    0,
    100
  );

  let gradeLevel: number;
  if (lang === "de") {
    // Wiener Sachtextformel (erste Variante): die etablierte deutsche
    // Schulstufen-Formel, hier als Zweitwert neben dem 0-100-Score.
    const pct = (n: number) => (n / words.length) * 100;
    const ms = pct(syllables.filter((s) => s >= 3).length);
    const iw = pct(words.filter((w) => w.text.length > 6).length);
    const es = pct(syllables.filter((s) => s === 1).length);
    gradeLevel = 0.1935 * ms + 0.1672 * avgSentenceLength + 0.1297 * iw - 0.0327 * es - 0.875;
  } else {
    gradeLevel = 0.39 * avgSentenceLength + 11.8 * avgSyllablesPerWord - 15.59;
  }

  const issues: QualityIssue[] = [];
  const limits = SENTENCE_LIMITS[lang];
  let passiveCount = 0;

  for (const sentence of sentences) {
    const wordCount = splitWords(sentence.text).length;
    if (wordCount > limits.hard) {
      const veryHard = wordCount > limits.veryHard;
      issues.push({
        category: veryHard ? "very-long-sentence" : "long-sentence",
        severity: veryHard ? "danger" : "warning",
        field: "body",
        snippet: rawBody.slice(sentence.start, sentence.end),
        offset: { start: sentence.start, end: sentence.end },
        meta: { words: wordCount },
      });
    }

    const passive = findPassive(sentence, lang);
    if (passive) {
      passiveCount++;
      issues.push({
        category: "passive",
        severity: "warning",
        field: "body",
        snippet: rawBody.slice(passive.start, passive.end),
        offset: passive,
      });
    }
  }

  for (const hit of findPhrases(text, WEASEL_WORDS[lang])) {
    issues.push({
      category: "weasel",
      severity: "info",
      field: "body",
      snippet: rawBody.slice(hit.start, hit.end),
      offset: { start: hit.start, end: hit.end },
      meta: { word: hit.text },
    });
  }

  const adverbHits =
    lang === "en"
      ? words.filter((w) => {
          const lower = w.text.toLowerCase();
          return lower.length > 4 && lower.endsWith("ly") && !LY_EXCEPTIONS_EN.has(lower);
        })
      : findPhrases(text, ADVERBS[lang]).map((h) => ({ text: h.text, start: h.start, end: h.end }));

  for (const hit of adverbHits) {
    issues.push({
      category: "adverb",
      severity: "info",
      field: "body",
      snippet: rawBody.slice(hit.start, hit.end),
      offset: { start: hit.start, end: hit.end },
      meta: { word: hit.text },
    });
  }

  return {
    lang,
    readingEaseScore: Math.round(readingEaseScore),
    gradeLevel: round(clamp(gradeLevel, 1, 20)),
    band: bandFor(readingEaseScore),
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgSentenceLength: round(avgSentenceLength),
    avgSyllablesPerWord: round(avgSyllablesPerWord, 2),
    passiveRatio: round(passiveCount / sentences.length, 2),
    issues: issues.sort((a, b) => (a.offset?.start ?? 0) - (b.offset?.start ?? 0)),
  };
}
