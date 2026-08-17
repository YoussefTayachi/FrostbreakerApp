// Muss inhaltlich mit apps/worker/worker/pipelines/personalize.py (DEFAULT_*) uebereinstimmen:
// beide Seiten (Worker-Produktion, Web-Live-Test) sollen mit denselben Vorgaben rechnen.

export const DEFAULT_PROMPT_DE = `Deine Aufgabe ist es, einen einzelnen, vertrieblich messerscharfen Aufhänger (Icebreaker) für eine Cold-Email zu generieren, der beweist, dass du die Welt des potenziellen Kunden tatsächlich verstehst.
Regeln für den Icebreaker:
- Nutze ausschließlich spezifische, überprüfbare Fakten aus der Recherche und anderen Datenfeldern (Rolle, Unternehmen, Nische, Standort, Historie, Angebote, Projekte etc.).
- Tonalität: direkt, selbstbewusst, geschäftsmäßig. Eine gewisse Schärfe ist völlig in Ordnung. Kein Slang, kein Hype.
- Erwähne NICHT LinkedIn, Google, „Ich habe gesehen", „Mir ist aufgefallen", „Ich habe gefunden" oder andere Verweise auf deinen Rechercheprozess. Nenne einfach direkt den Fakt.
- Baue KEINEN Namen des potenziellen Kunden, deinen eigenen Namen, Begrüßungen oder Verabschiedungen in den Icebreaker ein.
- Schreibe NIEMALS "—, --,-", also etwa "— dachte ich melde mich mal".
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
- Do NOT ever type:"—, --,-" like: "— thought I'd reach out".
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

const LANGUAGE_NAMES: Record<string, string> = { de: "German", en: "English" };

/**
 * Muss mit constraint_block() in personalize.py uebereinstimmen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DIESE FUNKTION HIER GEBEN MUSS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der Live-Test im AI-Agent-Tab schickte bis zum 2026-08-09 nur den reinen
 * Systemprompt an das Modell, ohne diesen Block. Er pruefte damit etwas
 * anderes, als spaeter tatsaechlich lief, und zwar an der empfindlichsten
 * Stelle: die Wortgrenze stand im Test gar nicht im Prompt, sondern wurde nur
 * hinterher bemaengelt.
 *
 * Beim gemeldeten Sprachfehler war das der Grund, warum die Sache so
 * verwirrend aussah: der Live-Test bekam den im Formular ANGEZEIGTEN
 * (englischen) Prompt direkt geschickt und lieferte Englisch; der Worker las
 * die Datenbank, fand dort null und nahm Deutsch. Zwei Wege, zwei Sprachen,
 * dieselbe Schaltflaeche.
 *
 * Auf Englisch formuliert, unabhaengig von der Zielsprache: das Modell befolgt
 * Formvorgaben in Englisch verlaesslicher.
 */
export function constraintBlock(
  maxWords: number,
  bannedWords: string[],
  language: "de" | "en"
): string {
  const lines = [
    "",
    "",
    "HARD LIMITS (these override anything above):",
    `- Write the icebreaker in ${LANGUAGE_NAMES[language] ?? "German"}. ` +
      "This overrides any language used in the instructions above.",
    `- Maximum ${maxWords} words. Count them before you answer. ` +
      "Going over is the single most common failure here.",
  ];
  const chars = bannedWords.map((w) => w.trim()).filter(Boolean);
  if (chars.length > 0) lines.push("- Never use these characters: " + chars.join(" "));
  lines.push(
    "- Any example phrasings above are examples, NOT templates. Never reuse " +
      "one word for word; end differently every time.",
    "- Output the line itself only: no quotes, no label, no preamble."
  );
  return lines.join("\n");
}

// Rueckwaertskompatibler Alias, falls irgendwo noch ohne Sprachauswahl importiert wird.
export const DEFAULT_PROMPT = DEFAULT_PROMPT_DE;

/**
 * Wie lang ein Aufhaenger hoechstens sein darf.
 *
 * Am 2026-08-13 von 22 auf 35 gehoben, und zwar an gemessenen Zahlen: von 737
 * erzeugten Aufhaengern fielen 439 durch, fast alle mit "33 statt max. 22
 * Woerter". Das Modell hat die Grenze also nicht knapp verfehlt, sondern
 * durchgaengig, und der Grund steht im Standardprompt selbst: er verlangt
 * einen konkreten Fakt UND den Anschluss "deswegen melde ich mich". Beides
 * zusammen ist in 22 Woertern nicht zu sagen.
 *
 * Eine Grenze, die drei von fuenf Ergebnissen als Fehler markiert, ist keine
 * Qualitaetssicherung mehr, sondern Rauschen: der Nutzer sieht 439 rote
 * Zeilen und hoert auf hinzusehen. Damit faellt auch der echte Fehler nicht
 * mehr auf.
 *
 * ACHTUNG bei Aenderungen: dieselbe Zahl begrenzt ueber {{personalization}}
 * auch die LinkedIn-Vorlage, und die hat nur 300 Zeichen (siehe
 * lib/copy/linkedin-prompt.ts). 35 Woerter sind dort mit rund 210 Zeichen
 * veranschlagt; fuer den eigenen Satz bleibt entsprechend wenig.
 */
export const DEFAULT_MAX_WORDS = 35;

// Gedankenstriche statt der frueheren Lob-Woerter ("Respekt", "bewundern",
// "stolz", ...). Der Grund ist derselbe wie beim Prompt-Zusatz oben: ein
// Gedankenstrich mitten im Satz ist inzwischen das deutlichste Erkennungs-
// zeichen fuer einen KI-geschriebenen Text und faellt Empfaengern sofort auf.
// Die Lob-Woerter fing der Prompt ohnehin schon ueber "Vermeide vages Lob" ab.
//
// Uebernommen aus dem Template, mit dem in der Praxis gearbeitet wird; damit
// die Voreinstellung das ist, was tatsaechlich funktioniert, statt etwas, das
// jeder Nutzer erst haendisch ersetzen muss.
export const DEFAULT_BANNED_WORDS = ["—", "–", "--", "-"];

export const SOURCE_VALUES = ["company_summary", "website_text", "both"] as const;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Steht das verbotene Zeichen wirklich stoerend im Text?
 *
 * Fuer normale Woerter ein simpler Teilstring-Treffer. Fuer Satzzeichen gilt
 * dieselbe Unterscheidung wie im Worker: ein Bindestrich INNERHALB eines
 * Wortes ("third-party", "NSF-certified") verbindet ein zusammengesetztes Wort
 * und ist kein Verstoss; gemeint sind nur Striche, die Satzteile abtrennen.
 *
 * Ohne diese Unterscheidung meldete der Live-Test jede Zeile mit einem
 * zusammengesetzten Wort als fehlerhaft, sobald "-" auf der Verbotsliste
 * stand, und der Worker markierte sie als pruefbeduerftig: an zwei echten
 * Suchen betraf das 66 von 69 Zeilen.
 */
function isBannedHit(text: string, banned: string): boolean {
  if (!isPunctuationOnly(banned)) return text.toLowerCase().includes(banned.toLowerCase());
  if (!DASHES_ALSO_VALID_INSIDE_WORDS.has(banned)) return text.includes(banned);
  let from = 0;
  for (;;) {
    const at = text.indexOf(banned, from);
    if (at === -1) return false;
    const before = at > 0 ? text[at - 1] : " ";
    const after = at + banned.length < text.length ? text[at + banned.length] : " ";
    const inWord = /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after);
    if (!inWord) return true;
    from = at + banned.length;
  }
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
  const hits = bannedWords.filter((w) => w.trim() && isBannedHit(text, w.trim()));
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
// apps/worker/worker/pipelines/personalize.py uebereinstimmen: GPT haelt
// sich an ein verbotenes Satzzeichen (v.a. Gedankenstriche) auch nach einem
// expliziten Korrektur-Hinweis zuverlaessig NICHT, das ist eine bekannte
// Modell-Eigenart, kein Prompting-Problem. Fuer banned_words-Eintraege, die
// ausschliesslich aus Satzzeichen bestehen, wird deshalb hart nachbearbeitet
// statt sich weiter aufs Modell zu verlassen. Normale verbotene Woerter
// bleiben aussen vor; die ersatzlos zu streichen wuerde den Satz oft kaputt
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
