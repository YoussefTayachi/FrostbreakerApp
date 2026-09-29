/**
 * Die Regeln, nach denen Claude (mit Aside im Browser) Personen recherchiert
 * und die sieben Schnipsel schreibt. Seit 2026-09-29.
 *
 * Ausgeliefert ueber das MCP-Werkzeug get_research_queue, damit jede
 * Sitzung dieselben Regeln sieht, ohne sie im Skill zu kopieren. Geprueft
 * wird im Worker (worker/pipelines/external_findings.py) mit denselben
 * Netzen wie beim OpenAI-Weg (person_finding.validate_snippets und
 * why_unusable). Aendert sich dort eine Regel, gehoert sie hierher.
 *
 * Englisch, weil es Eingabe fuer ein Modell ist (siehe tool-descriptions.ts).
 */
import { PERSON_SNIPPET_MAX_WORDS } from "./person-finding-defaults";

/** Quellenarten, wie sie der Worker kennt (person_finding.SOURCE_KINDS plus company_site). */
export const RESEARCH_SOURCE_KINDS = [
  "own_post",
  "company_post_quote",
  "interview",
  "article",
  "podcast",
  "talk",
  "profile",
  "company_site",
] as const;

/** Blickwinkel, wie sie der Worker kennt (person_finding.ANGLES plus company). */
export const RESEARCH_ANGLES = [
  "statement",
  "pattern",
  "fresh_move",
  "dual_role",
  "side_switch",
  "background",
  "role_vs_size",
  "company",
] as const;

/** Was im Opener woertlich stehen muss, je Quellenart (person_finding.platform_label). */
export const PLATFORM_LABELS_EN: Record<string, string> = {
  own_post: "LinkedIn",
  company_post_quote: "LinkedIn",
  profile: "LinkedIn",
  company_site: "your site",
  podcast: "the <host> podcast",
  interview: "<host> in your interview",
  talk: "<host> in your talk",
  article: "<host>",
};

export const RESEARCH_RULES: string[] = [
  "Research the PERSON first: open their LinkedIn activity (posts and comments they wrote) and any interview, podcast or talk. Fall back to the company website only when the person said nothing usable in the last 12 months.",
  "Pick ONE finding. Rank: something they said themselves (own_post, interview, podcast, talk) over an article about them, over their profile, over the company site.",
  "statement, pattern and fresh_move findings must be at most 12 months old (fresh_move at most 6). Give age_months as a whole number; -1 for the company site.",
  "Never use private topics: health, illness, family, children, pregnancy, grief, mental health, job loss, loneliness, religion, politics. Skip comments, reactions, reposts and quotes of two or three words.",
  "verbatim is the exact sentence as it stands on the page, copied, not paraphrased. For non-LinkedIn sources Frostbreaker loads the page and checks that it is there; an invented or paraphrased quote lands in review.",
  "source_url is the page you read. own_post, company_post_quote and profile must be linkedin.com URLs; interview, podcast and talk must not be.",
  "identity_evidence: one sentence from the source that ties it to this person at this company (name plus company or role). Without it the lead lands in review unless the URL is their own LinkedIn post or profile.",
  "Write in English. No hedges or subjunctives (would, could, might, maybe, probably, seems). No praise or compliments about the person. No em dashes.",
  "Never claim what their setup, emails or Klaviyo account does or lacks; you cannot know it. Promise confidently what we can do instead.",
  "Use no numbers that are not in the source, the known facts or the offer.",
  "Do not name our own brand and do not use the person's name inside the snippets.",
];

export const SNIPPET_GUIDE: Record<string, string> = {
  subjectLine: "Lowercase subject, specific to them, no clickbait.",
  opener:
    "One or two sentences. Starts with where you saw it and names the source word for word (see platform_labels), e.g. 'I just read your LinkedIn post where you said …' or 'I just looked at your site and saw …'. Then, only if there is a straight line to repeat purchases, one short reason why it matters.",
  whatTheySaid:
    "A fragment that completes 'what you said about …'. No leading 'what you said about', no 'posts about'.",
  segments: "Their likely buyer groups, concrete to what they sell. Describe groups, not their current setup.",
  promise: "One sentence: what we build for those groups so buyers come back for the second purchase.",
  ctaTail: "Completes 'with …', e.g. 'the segments I'd build first for <Company>'.",
};

export function researchRulesPayload() {
  return {
    rules: RESEARCH_RULES,
    source_kinds: RESEARCH_SOURCE_KINDS,
    angles: RESEARCH_ANGLES,
    platform_labels: PLATFORM_LABELS_EN,
    snippets: Object.fromEntries(
      Object.entries(SNIPPET_GUIDE).map(([field, guide]) => [
        field,
        { guide, max_words: PERSON_SNIPPET_MAX_WORDS[field] ?? null },
      ])
    ),
  };
}

/** Die Schnipsel, die Claude abliefert; platformWhereIGotIt setzt der Worker aus der Quellenart. */
export const PERSON_RESEARCH_SNIPPETS = ["subjectLine", "opener", "whatTheySaid", "segments", "promise", "ctaTail"] as const;
