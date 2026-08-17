import type { AiSoundingResult, EmailContent, Lang, QualityIssue, RiskLevel } from "./types";
import { AI_PHRASES } from "./lists/ai-phrases";
import { findPhrases, mean, normalizeVariables, splitSentences, splitWords, stdev } from "./text-utils";

// "Klingt nach KI"-Heuristik. Ausdruecklich KEIN statistischer Detektor: hier
// werden bekannte Modell-Floskeln gesucht und geprueft, wie gleichfoermig die
// Satzlaengen sind. Beides sind Stilindizien, keine Beweise: Werkzeuge wie
// ZeroGPT arbeiten mit Sprachmodell-Perplexitaet und liegen selbst damit
// regelmaessig daneben. Die UI muss das entsprechend deutlich sagen (siehe den
// Disclaimer in dict.ts), sonst schafft die Zahl mehr Schaden als Nutzen.

/**
 * Unter dieser Satzzahl wird die Gleichfoermigkeit gar nicht erst bewertet.
 * Eine gute Kaltakquise-Mail besteht oft aus drei Saetzen; die Streuung
 * daraus zu berechnen wuerde vor allem Rauschen produzieren und ausgerechnet
 * die kurzen, guten Mails faelschlich anschwaerzen.
 */
const MIN_SENTENCES_FOR_BURSTINESS = 4;

const POINTS_PER_PHRASE = 15;
const MAX_PHRASE_POINTS = 60;

/** Variationskoeffizient der Satzlaengen: darunter gilt der Text als auffaellig gleichfoermig. */
const BURSTINESS_THRESHOLDS = { veryUniform: 0.2, uniform: 0.3 };
const BURSTINESS_PENALTY = { veryUniform: 35, uniform: 20 };

const BAND_THRESHOLDS = { medium: 25, high: 55 };

function bandFor(score: number): RiskLevel {
  if (score >= BAND_THRESHOLDS.high) return "high";
  if (score >= BAND_THRESHOLDS.medium) return "medium";
  return "low";
}

export function checkAiSounding(content: EmailContent, lang: Lang): AiSoundingResult {
  const issues: QualityIssue[] = [];
  let score = 0;

  const fields = [
    { field: "subject" as const, raw: content.subject, text: normalizeVariables(content.subject) },
    { field: "body" as const, raw: content.body, text: normalizeVariables(content.body) },
  ];

  let phrasePoints = 0;
  for (const { field, raw, text } of fields) {
    for (const hit of findPhrases(text, AI_PHRASES[lang])) {
      phrasePoints += POINTS_PER_PHRASE;
      issues.push({
        category: "ai-phrase",
        severity: "warning",
        field,
        snippet: raw.slice(hit.start, hit.end),
        offset: { start: hit.start, end: hit.end },
        meta: { phrase: hit.text },
      });
    }
  }
  score += Math.min(MAX_PHRASE_POINTS, phrasePoints);

  const bodyText = normalizeVariables(content.body);
  const sentences = splitSentences(bodyText, lang);
  let burstiness: number | null = null;

  if (sentences.length >= MIN_SENTENCES_FOR_BURSTINESS) {
    const lengths = sentences.map((s) => splitWords(s.text).length).filter((n) => n > 0);
    const avg = mean(lengths);
    if (avg > 0) {
      burstiness = Math.round((stdev(lengths) / avg) * 100) / 100;
      const penalty =
        burstiness < BURSTINESS_THRESHOLDS.veryUniform
          ? BURSTINESS_PENALTY.veryUniform
          : burstiness < BURSTINESS_THRESHOLDS.uniform
            ? BURSTINESS_PENALTY.uniform
            : 0;
      if (penalty > 0) {
        score += penalty;
        issues.push({
          category: "low-burstiness",
          severity: "info",
          field: "body",
          snippet: "",
          offset: null,
          meta: { burstiness },
        });
      }
    }
  }

  return {
    lang,
    score: Math.min(100, Math.round(score)),
    band: bandFor(Math.min(100, score)),
    burstiness,
    issues,
  };
}
