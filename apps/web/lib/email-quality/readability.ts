import type { Lang, QualityIssue, ReadabilityBand, ReadabilityResult } from "./types";
import { ADVERBS, LY_EXCEPTIONS_EN, WEASEL_WORDS } from "./lists/weasel-words";
import { countSyllables, findPhrases, normalizeVariables, splitSentences, splitWords } from "./text-utils";

// Lesbarkeitsanalyse im Stil von Hemingway: eine Gesamtnote plus konkrete
// Stellen (lange Saetze, Passiv, Fuellwoerter). Bewusst ohne Bibliothek:
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
  // "optimiert", "kalkuliert": Fremdverben bilden das Partizip ohne "ge-".
  if (/\p{L}{3,}iert$/u.test(w)) return true;
  // "bestellt", "versendet", "entwickelt". Nur die Endung "t": Partizipien auf
  // "-en" ohne "ge-" ("beschrieben") sind formgleich mit dem Infinitiv
  // ("verkaufen"), und "wird verkaufen" ist Futur, kein Passiv; lieber ein
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

/**
 * Ab wann die Wortwahl selbst schwer wiegt.
 *
 * Deutsch liegt in normaler Prosa hoeher als Englisch (Komposita), deshalb
 * zwei Werte. Beide sind bewusst hoch angesetzt: sie sollen "Die
 * Implementierungsverifikationsmethodik" fangen und nicht "verification".
 */
const HEAVY_SYLLABLES: Record<Lang, number> = { de: 2.4, en: 2.1 };

const BANDS: ReadabilityBand[] = ["very-easy", "easy", "medium", "difficult", "very-difficult"];

/**
 * Die Note kommt aus der SATZLAENGE, nicht aus dem Flesch-Wert.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM UMGESTELLT (2026-08-12)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Gemessen an einer erzeugten Kampagnenmail: 42 Woerter, 4 Saetze, im
 * Schnitt 10,5 Woerter je Satz, NULL gefundene Befunde, und trotzdem ein
 * rotes "Schwer". Der Flesch-Wert lag bei 43, und zwar allein wegen 1,81
 * Silben je Wort: "verification", "automation", "discovery". Die inhaltlich
 * gleiche deutsche Fassung kam auf 7,8 Woerter je Satz und ebenfalls Rot.
 *
 * Ein rotes Abzeichen ueber der Zeile "Nichts zu beanstanden" ist ein
 * Widerspruch, und er ist teurer als er aussieht: wer beim dritten Mal ein
 * unbegruendetes Rot wegklickt, klickt beim vierten Mal auch das begruendete
 * weg. Dieselbe Ueberlegung wie bei der Trennung von Blocker und Warnung in
 * campaign-readiness.ts.
 *
 * Die Silbenzahl ist fuer eine Geschaeftsmail die falsche Zielgroesse. Sie
 * ist nicht handlungsleitend: "Adressprüfung" laesst sich nicht in weniger
 * Silben sagen, es ist schlicht das richtige Wort. Die Satzlaenge dagegen ist
 * genau das, was man aendern kann und soll, und sie ist auch das, was der
 * Kopf des Panels ohnehin anzeigt.
 *
 * Der Kommentar am Dateianfang beruft sich auf Hemingway. Hemingway benotet
 * nach Schulstufe und Satzbau, nicht nach dem Flesch-Wert; Schulstufe 9,9
 * gilt dort als gut. Die Umstellung bringt die Datei mit ihrem eigenen
 * Vorbild in Uebereinstimmung.
 *
 * Flesch-Wert und Schulstufe bleiben im Ergebnis stehen, als Angabe, nicht
 * als Urteil. Sie sind zwischen den Sprachen ohnehin nicht vergleichbar: die
 * Amstad-Fassung und die Wiener Sachtextformel sind anders geeicht als die
 * englischen Originale, dieselbe Aussage bekam je nach Sprache eine andere
 * Note.
 */
function bandFor(
  avgSentenceLength: number,
  longShare: number,
  avgSyllablesPerWord: number,
  lang: Lang
): ReadabilityBand {
  const { hard, veryHard } = SENTENCE_LIMITS[lang];
  let index: number;
  if (avgSentenceLength > veryHard || longShare > 0.5) index = 4;
  else if (avgSentenceLength > hard || longShare > 0.25) index = 3;
  else if (avgSentenceLength > hard * 0.8) index = 2;
  else if (avgSentenceLength > hard * 0.6) index = 1;
  else index = 0;
  // Schwere Wortwahl zieht um genau eine Stufe herunter. Nicht mehr: sie ist
  // ein Hinweis auf den Stil, kein Fehler im Text.
  if (avgSyllablesPerWord > HEAVY_SYLLABLES[lang]) index = Math.min(BANDS.length - 1, index + 1);
  return BANDS[index];
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
 * Bewertet den Mailtext. Laeuft nur auf dem Body: eine Betreffzeile ist zu
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
  let longCount = 0;

  for (const sentence of sentences) {
    const wordCount = splitWords(sentence.text).length;
    if (wordCount > limits.hard) {
      longCount++;
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
    band: bandFor(avgSentenceLength, longCount / sentences.length, avgSyllablesPerWord, lang),
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgSentenceLength: round(avgSentenceLength),
    avgSyllablesPerWord: round(avgSyllablesPerWord, 2),
    passiveRatio: round(passiveCount / sentences.length, 2),
    issues: issues.sort((a, b) => (a.offset?.start ?? 0) - (b.offset?.start ?? 0)),
  };
}
