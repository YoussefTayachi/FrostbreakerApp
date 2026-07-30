// Muss inhaltlich mit apps/worker/worker/pipelines/personalize.py (DEFAULT_*) uebereinstimmen --
// beide Seiten (Worker-Produktion, Web-Live-Test) sollen mit denselben Vorgaben rechnen.

export const DEFAULT_PROMPT_DE = `Deine Aufgabe ist es, einen einzelnen, vertrieblich messerscharfen Aufhänger (Icebreaker) für eine Cold-Email zu generieren, der beweist, dass du die Welt des potenziellen Kunden tatsächlich verstehst.
Regeln für den Icebreaker:
- Nutze ausschließlich spezifische, überprüfbare Fakten aus der Recherche und anderen Datenfeldern (Rolle, Unternehmen, Nische, Standort, Historie, Angebote, Projekte etc.).
- Tonalität: direkt, selbstbewusst, geschäftsmäßig. Eine gewisse Schärfe ist völlig in Ordnung. Kein Slang, kein Hype.
- Erwähne NICHT LinkedIn, Google, „Ich habe gesehen", „Mir ist aufgefallen", „Ich habe gefunden" oder andere Verweise auf deinen Rechercheprozess. Nenne einfach direkt den Fakt.
- Baue KEINEN Namen des potenziellen Kunden, deinen eigenen Namen, Begrüßungen oder Verabschiedungen in den Icebreaker ein.
- Du darfst kommerzielle Interessen, Dynamiken oder Hebelwirkung andeuten (z. B. Mitbewerber überdauern, maßgeschneiderte Lösungen statt Masse wählen, eine Nische verdoppeln, Kapazitäten schützen), aber du darfst deine eigene Dienstleistung oder Lösung NICHT beschreiben oder pitchen.
- Der Satz sollte sich wie eine scharfe Beobachtung anfühlen, die du direkt vor einer ernsthaften Vertriebsfrage äußern würdest.
- Werde konkret. Vermeide vages Lob. Verankere die Aussage in etwas Zeitgebundenem, Ortsgebundenem oder Modellgebundenem (z. B. was sich verändert hat, worauf sie doppelt gesetzt haben, was sie weitergeführt haben, während andere damit aufhörten).
Folge dem Ausgabeformat immer ganz genau.
-Schreibe immer in der "Du" Form und nicht "Sie" Form und lass den Icebreaker persönlich klingen.
-Beende den Icebreaker damit, dass du dich deswegen meldest und nutze verschiedene Varianten zb:"Dachte ich melde mich mal", "Deswegen wollte ich uns connecten", "Deshalb wollte ich dir mal schreiben" etc..

Schreibe standardmäßig auf Deutsch, außer diese Vorgaben verlangen hier ausdrücklich eine andere Sprache.`;

export const DEFAULT_PROMPT_EN = `Your task is to generate a single, commercially razor-sharp opening line (icebreaker) for a cold email that proves you genuinely understand the prospect's world.
Rules for the icebreaker:
- Use only specific, verifiable facts from the research and other data fields (role, company, niche, location, history, offerings, projects, etc.).
- Tone: direct, confident, business-like. A bit of edge is completely fine. No slang, no hype.
- Do NOT mention LinkedIn, Google, "I saw", "I noticed", "I found", or any other reference to your research process. Just state the fact directly.
- Do NOT include the prospect's name, your own name, greetings, or sign-offs.
- You may hint at commercial interest, dynamics, or leverage (e.g. outlasting competitors, choosing tailored solutions over mass-market ones, doubling down on a niche, protecting capacity), but you must NOT describe or pitch your own service or solution.
- The sentence should feel like a sharp observation you'd make right before a serious sales question.
- Be specific. Avoid vague praise. Anchor the statement in something time-bound, location-bound, or model-bound (e.g. what changed, what they doubled down on, what they kept going while others stopped).
Follow the output format exactly every time.
-Always write in the informal "you" form and make the icebreaker sound personal.
-End the icebreaker by implying that's why you're reaching out, using varied phrasing, e.g.: "Thought I'd reach out", "That's why I wanted to connect", "That's why I wanted to drop you a line", etc.

Write in English by default, unless these instructions explicitly require another language.`;

export function getDefaultPrompt(lang: "de" | "en"): string {
  return lang === "en" ? DEFAULT_PROMPT_EN : DEFAULT_PROMPT_DE;
}

// Rueckwaertskompatibler Alias, falls irgendwo noch ohne Sprachauswahl importiert wird.
export const DEFAULT_PROMPT = DEFAULT_PROMPT_DE;

export const DEFAULT_MAX_WORDS = 22;

export const DEFAULT_BANNED_WORDS = [
  "Respekt", "bewundern", "stolz", "Lob", "begeistert",
  "aufgeregt", "inspiriert", "beeindruckt", "geehrt",
];

export const SOURCE_VALUES = ["company_summary", "website_text", "both"] as const;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Labels der Regelverstoesse folgen der UI-Sprache, damit der Live-Test im
// AI-Agent-Tab auch auf Englisch verstaendlich bleibt.
export function validateIcebreaker(
  text: string,
  maxWords: number,
  bannedWords: string[],
  lang: "de" | "en" = "de"
): string[] {
  const problems: string[] = [];
  const n = wordCount(text);
  if (n > maxWords) {
    problems.push(
      lang === "en"
        ? `too long (${n} instead of max. ${maxWords} words)`
        : `zu lang (${n} statt max. ${maxWords} Wörter)`
    );
  }
  const lowered = text.toLowerCase();
  const hits = bannedWords.filter((w) => w.trim() && lowered.includes(w.trim().toLowerCase()));
  if (hits.length) {
    problems.push(
      (lang === "en" ? "contains banned words: " : "enthält verbotene Wörter: ") + hits.join(", ")
    );
  }
  return problems;
}

function isPunctuationOnly(word: string): boolean {
  return word.length > 0 && !/[\p{L}\p{N}]/u.test(word);
}

// Muss inhaltlich mit sanitize_banned_punctuation() in
// apps/worker/worker/pipelines/personalize.py uebereinstimmen -- GPT haelt
// sich an ein verbotenes Satzzeichen (v.a. Gedankenstriche) auch nach einem
// expliziten Korrektur-Hinweis zuverlaessig NICHT, das ist eine bekannte
// Modell-Eigenart, kein Prompting-Problem. Fuer banned_words-Eintraege, die
// ausschliesslich aus Satzzeichen bestehen, wird deshalb hart nachbearbeitet
// statt sich weiter aufs Modell zu verlassen. Normale verbotene Woerter
// bleiben aussen vor -- die ersatzlos zu streichen wuerde den Satz oft kaputt
// machen, das kann nur eine echte Umformulierung (Retry) leisten.
// Striche, die auch WORTINTERN vorkommen duerfen: der normale Bindestrich
// verbindet zusammengesetzte Woerter ("two-decade", "values-driven"). Wird er
// dort durch ein Komma ersetzt, zerlegt das echte Woerter ("a two, decade
// foothold"). Gedankenstriche (— –) und "--" stehen nie innerhalb eines Wortes
// und werden immer ersetzt, auch ohne Leerzeichen ("events—that's why").
const DASHES_ALSO_VALID_INSIDE_WORDS = new Set(["-", "‐"]);

function isAlnum(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

export function sanitizeBannedPunctuation(text: string, bannedWords: string[]): string {
  const punctuationWords = Array.from(
    new Set(bannedWords.map((w) => w.trim()).filter((w) => w && isPunctuationOnly(w)))
    // "--" vor "-", sonst frisst der kurze Treffer den langen an
  ).sort((a, b) => b.length - a.length);

  let result = text;
  for (const token of punctuationWords) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keepInsideWords = DASHES_ALSO_VALID_INSIDE_WORDS.has(token);
    const current = result;
    result = current.replace(new RegExp(`\\s*${escaped}\\s*`, "g"), (match, offset: number) => {
      if (!keepInsideWords) return ", ";
      // Wurde Leerraum mitgefressen, stand der Strich zwischen Satzteilen.
      if (match !== token) return ", ";
      const before = offset > 0 ? current[offset - 1] : " ";
      const after = offset + match.length < current.length ? current[offset + match.length] : " ";
      if (isAlnum(before) && isAlnum(after)) return match; // Bindestrich im Wort
      return ", ";
    });
  }
  result = result.replace(/\s+,/g, ",").replace(/,\s*,+/g, ",");
  return result.replace(/^[\s,]+|[\s,]+$/g, "");
}
