import type { Lang } from "./types";

// Gemeinsame Textzerlegung fuer alle drei Pruefungen. Bewusst an einer Stelle:
// Lesbarkeit (durchschnittliche Satzlaenge) und KI-Klang (Varianz der
// Satzlaengen) rechnen beide auf Saetzen -- zwei eigene Implementierungen
// wuerden sich frueher oder spaeter still uneinig darueber, wie viele Saetze
// derselbe Text hat, und das Panel zeigt dann widerspruechliche Zahlen.

export type Span = { text: string; start: number; end: number };

/**
 * Instantly-Platzhalter neutralisieren: `{{firstName}}` ist beim Versand ein
 * kurzer, normaler Name -- als Rohtoken wuerde es die Wort-/Silbenstatistik
 * verzerren (13 Zeichen, keine Vokalgruppen im Sinne der Formel). Ersetzt wird
 * laengengleich (Platzhalterwort + Leerzeichen), damit alle Zeichen-Offsets
 * weiterhin auf den Originaltext passen und spaeteres Inline-Highlighting
 * nicht daneben liegt.
 */
export function normalizeVariables(text: string): string {
  return text.replace(/\{\{\s*[\w.]+\s*\}\}/g, (match) => {
    const filler = "Name";
    return filler.length >= match.length
      ? filler.slice(0, match.length)
      : filler + " ".repeat(match.length - filler.length);
  });
}

// Abkuerzungen, nach denen ein Punkt keinen Satz beendet. Einzelbuchstaben
// ("z. B.", "e. g.", Initialen) werden generisch abgefangen, hier stehen nur
// die mehrbuchstabigen Faelle.
const ABBREVIATIONS: Record<Lang, Set<string>> = {
  de: new Set([
    "bzw", "ca", "ggf", "inkl", "evtl", "usw", "vgl", "nr", "str", "dr", "prof",
    "mio", "mrd", "abb", "bspw", "sog", "tel", "mwst", "gmbh", "co", "vs",
  ]),
  en: new Set([
    "etc", "vs", "mr", "mrs", "ms", "dr", "prof", "inc", "ltd", "co", "jr", "sr",
    "fig", "approx", "dept", "est", "min", "max",
  ]),
};

/**
 * Satzsegmentierung per Heuristik. Zeilenumbrueche zaehlen als Satzgrenze:
 * In E-Mail-Text sind Umbrueche gesetzt, nicht umgebrochen (Anrede, Gruss,
 * Aufzaehlungen stehen oft ganz ohne Satzzeichen) -- ohne diese Regel wuerde
 * "Hallo Name," mit dem folgenden Absatz zu einem Riesensatz verschmelzen und
 * jede Lesbarkeitszahl waere Unsinn.
 */
export function splitSentences(text: string, lang: Lang): Span[] {
  const abbr = ABBREVIATIONS[lang];
  const out: Span[] = [];
  let start = 0;

  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) out.push({ text: trimmed, start: from + leading, end: from + leading + trimmed.length });
  };

  const re = /[.!?]+|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;

    if (m[0][0] !== "\n") {
      // Mitten in Zahl oder Domain ("3.5", "example.com") ist kein Satzende.
      const next = text[end];
      if (next !== undefined && !/[\s"'»«)\]]/.test(next)) continue;
      if (m[0] === ".") {
        const token = (text.slice(0, m.index).match(/[\p{L}]+$/u)?.[0] ?? "").toLowerCase();
        if (token.length === 1 || abbr.has(token)) continue;
      }
    }

    push(start, end);
    start = end;
  }
  push(start, text.length);

  return out;
}

/** Woerter inkl. Offsets. Bindestriche und Apostrophe bleiben Wortbestandteil. */
export function splitWords(text: string): Span[] {
  const out: Span[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Silbenzaehlung per Vokalgruppen -- die uebliche Naeherung, auf der auch die
 * Flesch-Implementierungen der gaengigen Bibliotheken beruhen. Fuer Deutsch
 * genuegt das Zaehlen der Vokalgruppen (Diphthonge wie "ei"/"eu" fallen dabei
 * korrekt zu einer Silbe zusammen), fuer Englisch kommt die Korrektur fuer
 * stummes End-e dazu.
 */
export function countSyllables(word: string, lang: Lang): number {
  const w = word.toLowerCase().replace(/[^a-zäöüáàâéèêíìîóòôúùûñçß]/g, "");
  if (!w) return 0;

  const source =
    lang === "de" ? w : w.replace(/(?:[^laeiouy]es|[cgtd]ed|[^laeiouy]e)$/, "");
  const groups = source.match(lang === "de" ? /[aeiouyäöü]+/g : /[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type PhraseHit = Span & { phrase: string };

/**
 * Sucht eine Wortliste im Text, ohne Ruecksicht auf Gross-/Kleinschreibung und
 * mit Wortgrenzen. Bewusst nicht `\b`: das kennt nur ASCII, "über" oder
 * "grüße" wuerden damit nie sauber matchen. Laengere Eintraege gewinnen und
 * unterdruecken ueberlappende kuerzere, damit "risk-free" nicht zusaetzlich
 * als "free" gezaehlt wird und den Score doppelt belastet.
 */
export function findPhrases(text: string, phrases: readonly string[]): PhraseHit[] {
  const hits: PhraseHit[] = [];
  const byLength = [...phrases].sort((a, b) => b.length - a.length);

  for (const phrase of byLength) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, "giu");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ phrase, text: m[0], start, end });
    }
  }

  return hits.sort((a, b) => a.start - b.start);
}
