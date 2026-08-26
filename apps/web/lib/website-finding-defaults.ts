// Muss inhaltlich mit apps/worker/worker/pipelines/website_finding.py
// (DEFAULT_FINDING_PROMPT_DE / _EN, FINDING_MAX_WORDS) uebereinstimmen: der
// Worker erzeugt damit, das Formular im AI-Agent-Tab zeigt es an, und die
// Pruefliste rechnet damit nach.
//
// Die Bindung gilt in BEIDE Richtungen: website_finding.py verweist an den
// entsprechenden Stellen hierher zurueck. Genau wie bei
// lib/personalization-defaults.ts und personalize.py, und aus demselben Grund:
// wer einen der Texte aendert und nur eine Seite anfasst, zeigt dem Nutzer
// einen Prompt an, mit dem der Worker nicht arbeitet. Beim Icebreaker war das
// der Grund, warum ein gemeldeter Sprachfehler so schwer zu sehen war.
//
// Die Texte sind WOERTLICH uebernommen, nicht nachformuliert. Auch die
// gemischten Anfuehrungszeichen („Du" statt „Du“) stehen so im Worker.

export const DEFAULT_FINDING_PROMPT_DE = `Deine Aufgabe ist es, aus einem geprüften Mangel der Website eines Unternehmens einen einzelnen Satz für eine Cold-Email zu formulieren.
Regeln für den Satz:
- Nenne ausschließlich den einen Mangel, der dir übergeben wurde, und die dazugehörige Folge. Erfinde keinen zweiten Mangel, keine Zahlen und keine Prozentwerte.
- Der Mangel ist gemessen, nicht vermutet: Schreibe ihn als Tatsache, ohne Abschwächung wie „vielleicht" oder „unter Umständen".
- Erwähne NICHT, woher du das weißt: kein „Ich habe gesehen", kein „Mir ist aufgefallen", kein Werkzeug, kein Test, keine Prüfung. Nenne einfach den Mangel.
- Baue KEINEN Namen, keine Begrüßung und keine Verabschiedung ein.
- Beschreibe oder verkaufe deine eigene Leistung NICHT. Der Satz benennt das Problem, nicht die Lösung.
- Tonfall: sachlich, direkt und ohne Fachjargon, aber ohne Dramatik, Vorwurf oder Alarm.
- Schreibe in der „Du"-Form, nicht in der „Sie"-Form.
- Der Satz wird an einer beliebigen Stelle in die Mail eingesetzt und muss dort für sich allein stehen: er beginnt mit einem Großbuchstaben und endet mit einem Punkt.

Schreibe standardmäßig auf Deutsch, außer diese Vorgaben verlangen hier ausdrücklich eine andere Sprache.`;

export const DEFAULT_FINDING_PROMPT_EN = `Your task is to turn one verified flaw on a company's website into a single sentence for a cold email.
Rules for the sentence:
- Name only the one flaw you were given and its stated consequence. Do not invent a second flaw, any numbers or any percentages.
- The flaw was measured, not guessed: state it as a fact, without hedging like "maybe" or "possibly".
- Do NOT mention how you know: no "I saw", no "I noticed", no tool, no test, no audit. Just state the flaw.
- Do NOT include any name, greeting or sign-off.
- Do NOT describe or pitch your own service. The sentence names the problem, not the solution.
- Tone: plain, direct and free of jargon, but without drama, blame or alarm.
- Always write in the informal "you" form.
- The sentence is dropped into the email at an arbitrary position and has to stand on its own there: it starts with a capital letter and ends with a full stop.

Write in English by default, unless these instructions explicitly require another language.`;

/**
 * Der Standardtext in der AUSGABESPRACHE des Workspaces.
 *
 * Gegenstueck zu default_prompt() in website_finding.py. Die Sprache kommt aus
 * workspaces.personalization_language und NICHT aus der Sprache der
 * Oberflaeche: eine deutsche Ansicht und amerikanische Zielkunden sind der
 * Normalfall (siehe outputLang in app/ai-agent/page.tsx).
 */
export function getDefaultFindingPrompt(lang: "de" | "en"): string {
  return lang === "en" ? DEFAULT_FINDING_PROMPT_EN : DEFAULT_FINDING_PROMPT_DE;
}

/**
 * Die Wortgrenze des Befundsatzes.
 *
 * Gegenstueck zu FINDING_MAX_WORDS in
 * apps/worker/worker/pipelines/website_finding.py; die beiden muessen
 * uebereinstimmen, sonst meldet die Pruefliste Verstoesse, die beim Erzeugen
 * keine waren.
 *
 * Die Zahl ist dort gesetzt, nicht gemessen: Mangel und Folge in einem Satz.
 * Zeigt die Pruefliste reihenweise Verstoesse, gehoert sie erhoeht (und der
 * Grund daneben), so wie es bei DEFAULT_MAX_WORDS am 2026-08-13 passiert ist.
 *
 * BEWUSST KEINE VIERTE WORKSPACE-EINSTELLUNG (Migration 0103, Abschnitt 4):
 * Sprache und verbotene Zeichen sind Eigenschaften des Workspaces und gelten
 * fuer beide Saetze, die Laenge ist eine Eigenschaft DIESER Textsorte. Sie zu
 * verdoppeln hiesse, dem Nutzer vier Felder hinzustellen, von denen drei immer
 * gleich stehen muessen. Deshalb steht sie hier neben den Texten, die
 * ebenfalls aus dem Worker gespiegelt sind, und nicht im Formular.
 *
 * Stand bis zum 2026-08-24 in lib/personalization/review.ts und ist hierher
 * gewandert, damit alles, was aus website_finding.py gespiegelt wird, an einer
 * Stelle liegt. review.ts reicht sie unveraendert weiter.
 */
export const FINDING_MAX_WORDS = 20;

/**
 * Die Wortgrenze fuer einen VON HAND geschriebenen Befund (MCP).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIESELBE SPALTE ZWEI GRENZEN HAT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Weil sie zwei Textsorten traegt, und das ist keine Vermutung. Am 2026-08-26
 * in der Produktionsdatenbank nachgezaehlt: von den 20 Leads mit einem Befund
 * trug KEIN EINZIGER die Ein-Satz-Form des Workers. Alle lagen zwischen 100
 * und 143 Woertern, weil dort der Rumpf der Initial-Mail steht, den der
 * website-finding-Skill mit drei belegten Maengeln schreibt.
 *
 * Der Worker erzeugt weiterhin einen Satz und wird weiterhin an
 * FINDING_MAX_WORDS gemessen. Wer von Hand schreibt, hat drei Maengel mit
 * Folge unterzubringen, und das geht unter zwanzig Woertern nicht ohne
 * Verlust. Haette set_lead_website_finding an den zwanzig gemessen, waere
 * JEDER von Hand geschriebene Text in der Pruefliste gelandet -- also genau
 * die Arbeit entstanden, die das Werkzeug sparen soll.
 *
 * 160 statt 143: der hoechste gemessene Wert plus Luft. Die Grenze faengt
 * weiterhin den Fall ab, in dem ein Modell einen ganzen Pruefbericht
 * hineinschreibt, und darum geht es hier. Verbotene Woerter und Ausgabesprache
 * werden bei BEIDEN Formen gleich geprueft: die sind Eigenschaften des
 * Workspaces und gelten fuer jeden Satz, der in eine Mail geraet.
 */
export const MANUAL_FINDING_MAX_WORDS = 160;
