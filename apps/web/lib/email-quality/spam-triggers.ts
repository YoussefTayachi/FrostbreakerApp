import type {
  EmailContent,
  EmailField,
  Lang,
  QualityIssue,
  RiskLevel,
  SpamCategory,
  SpamCheckResult,
} from "./types";
import { SPAM_CATEGORIES, SPAM_WORDS } from "./lists/spam-words";
import { findPhrases, normalizeVariables, splitWords } from "./text-utils";

// Spam-Trigger-Pruefung fuer Betreff und Text. Alle Schwellwerte und
// Gewichte stehen bewusst hier oben beisammen: nachjustiert wird nach echten
// Zustellraten, und das soll gehen, ohne die Logik anzufassen.

const CATEGORY_WEIGHTS: Record<SpamCategory, number> = {
  money: 8,
  urgency: 6,
  "exaggerated-claims": 8,
  "trust-manipulation": 10,
};

/** Treffer in der Betreffzeile wiegen schwerer -- Filter schauen dort genauer hin. */
const SUBJECT_MULTIPLIER = 1.5;

const CAPS_RATIO_LIMIT = 0.1;
const SUBJECT_EXCLAMATION_LIMIT = 1;
const BODY_EXCLAMATION_LIMIT = 3;

const PENALTY = { allCaps: 12, exclamation: 8, punctuationCluster: 10 };

const RISK_THRESHOLDS = { medium: 20, high: 50 };

const DANGEROUS_CATEGORIES: readonly SpamCategory[] = ["trust-manipulation"];

function capsWords(text: string): { count: number; total: number; first: string | null } {
  const words = splitWords(text);
  const caps = words.filter((w) => w.text.length >= 3 && w.text === w.text.toUpperCase() && /\p{L}/u.test(w.text));
  return { count: caps.length, total: words.length, first: caps[0]?.text ?? null };
}

function riskLevelFor(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.high) return "high";
  if (score >= RISK_THRESHOLDS.medium) return "medium";
  return "low";
}

/**
 * Prueft Betreff und Text auf klassische Spam-Ausloeser. Anders als die
 * Lesbarkeit laeuft das ausdruecklich auch auf der Betreffzeile: ein
 * "GRATIS!!!" im Betreff kostet mehr Zustellung als derselbe Text im Body.
 */
export function checkSpamTriggers(content: EmailContent, lang: Lang): SpamCheckResult {
  const fields: { field: EmailField; raw: string; text: string }[] = [
    { field: "subject", raw: content.subject, text: normalizeVariables(content.subject) },
    { field: "body", raw: content.body, text: normalizeVariables(content.body) },
  ];

  const issues: QualityIssue[] = [];
  const categoryCounts: Record<SpamCategory, number> = {
    money: 0,
    urgency: 0,
    "exaggerated-claims": 0,
    "trust-manipulation": 0,
  };
  let score = 0;

  for (const { field, raw, text } of fields) {
    if (!text.trim()) continue;
    const multiplier = field === "subject" ? SUBJECT_MULTIPLIER : 1;

    for (const category of SPAM_CATEGORIES) {
      for (const hit of findPhrases(text, SPAM_WORDS[lang][category])) {
        categoryCounts[category]++;
        score += CATEGORY_WEIGHTS[category] * multiplier;
        issues.push({
          category,
          severity: DANGEROUS_CATEGORIES.includes(category) ? "danger" : "warning",
          field,
          snippet: raw.slice(hit.start, hit.end),
          offset: { start: hit.start, end: hit.end },
          meta: { word: hit.text },
        });
      }
    }

    // Grossschreibung: im Betreff faellt schon ein einzelnes Wort auf, im Text
    // erst ein spuerbarer Anteil.
    const caps = capsWords(text);
    const capsHit = field === "subject" ? caps.count > 0 : caps.total > 0 && caps.count / caps.total > CAPS_RATIO_LIMIT;
    if (capsHit) {
      score += PENALTY.allCaps;
      issues.push({
        category: "all-caps",
        severity: "warning",
        field,
        snippet: caps.first ?? "",
        offset: null,
        meta: { count: caps.count },
      });
    }

    const exclamations = (text.match(/!/g) ?? []).length;
    const exclamationLimit = field === "subject" ? SUBJECT_EXCLAMATION_LIMIT : BODY_EXCLAMATION_LIMIT;
    if (exclamations > exclamationLimit) {
      score += PENALTY.exclamation;
      issues.push({
        category: "exclamation",
        severity: "warning",
        field,
        snippet: "",
        offset: null,
        meta: { count: exclamations },
      });
    }

    for (const m of text.matchAll(/[!?]{2,}|\${2,}/g)) {
      score += PENALTY.punctuationCluster;
      issues.push({
        category: "punctuation-cluster",
        severity: "warning",
        field,
        snippet: m[0],
        offset: { start: m.index, end: m.index + m[0].length },
      });
    }
  }

  const bodyCaps = capsWords(normalizeVariables(content.body));
  const riskScore = Math.min(100, Math.round(score));

  return {
    lang,
    riskLevel: riskLevelFor(riskScore),
    riskScore,
    categoryCounts,
    capsRatio: bodyCaps.total > 0 ? Math.round((bodyCaps.count / bodyCaps.total) * 100) / 100 : 0,
    exclamationCount: (content.subject.match(/!/g) ?? []).length + (content.body.match(/!/g) ?? []).length,
    issues,
  };
}
