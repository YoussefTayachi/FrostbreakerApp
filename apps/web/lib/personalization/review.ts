/**
 * Die gespeicherten Icebreaker gegen die HEUTIGEN Regeln nachrechnen.
 *
 * WARUM NICHT EINFACH businesses.personalization_needs_review LESEN
 *
 * Weil dieses Feld festhaelt, was zum ZEITPUNKT DER ERZEUGUNG galt, und die
 * Regeln sich seither geaendert haben. Am 2026-08-02 wurde korrigiert, dass
 * ein Bindestrich INNERHALB eines Wortes ("third-party", "NSF-certified")
 * faelschlich als verbotenes Satzzeichen zaehlte -- an zwei Suchen betraf das
 * 66 von 69 Zeilen. Jede davon traegt bis heute die Markierung, obwohl sie
 * nach den geltenden Regeln in Ordnung ist.
 *
 * Gemessen am 2026-08-04 ueber alle 1032 erzeugten Zeilen:
 *
 *   markiert, zu lang nach heutigen Regeln       705
 *   markiert gesamt                              766
 *   NICHT markiert, aber heute auffaellig         31 (zu lang)
 *
 * Die letzte Zeile ist der Grund, warum hier neu gerechnet und nicht nur
 * gefiltert wird: es gibt Zeilen, die nie markiert wurden und trotzdem gegen
 * die aktuellen Vorgaben verstossen -- ein reiner Filter auf das Flag wuerde
 * sie nie zeigen. Eine Pruefliste, die Faelle uebersieht, ist schlimmer als
 * keine, weil sie das Gefuehl vermittelt, man haette alles gesehen.
 *
 * Daraus ergeben sich die drei Zustaende: was heute wirklich auffaellt
 * (failing), was nur noch eine veraltete Markierung traegt (stale, per
 * Sammelaktion abzuhaken), und der Rest (clean).
 *
 * Die Pruefung selbst kommt aus lib/personalization-defaults.ts und ist die
 * gleiche, die der Live-Test im AI-Agent-Tab benutzt. Sie muss inhaltlich mit
 * validate() in apps/worker/worker/pipelines/personalize.py uebereinstimmen --
 * dort entsteht das Flag.
 */
import {
  DEFAULT_BANNED_WORDS,
  DEFAULT_MAX_WORDS,
  validateIcebreaker,
  wordCount,
} from "../personalization-defaults";

/** Die Felder aus public.businesses, die fuer die Bewertung gebraucht werden. */
export type IcebreakerRow = {
  id: string;
  name: string | null;
  personalization: string | null;
  personalization_needs_review: boolean | null;
};

/**
 * failing -- verstoesst gegen die geltenden Vorgaben, muss angefasst werden.
 * stale   -- traegt die Markierung, ist nach heutigen Regeln aber sauber.
 * clean   -- unauffaellig.
 */
export type IcebreakerState = "failing" | "stale" | "clean";

export type IcebreakerVerdict = {
  id: string;
  name: string | null;
  text: string;
  words: number;
  /** Menschenlesbar und in der Sprache der Oberflaeche, siehe validateIcebreaker. */
  problems: string[];
  state: IcebreakerState;
  /** Was in der Datenbank steht -- fuer die Erklaerung "warum steht das hier". */
  wasFlagged: boolean;
};

export type ReviewSettings = {
  maxWords: number;
  bannedWords: string[];
  lang: "de" | "en";
};

/**
 * Die Verbotswoerter des Workspaces aus dem gespeicherten Textfeld lesen.
 *
 * Gespeichert wird eine Zeile wie "—, -, --," -- also mit Leerzeichen und,
 * wie das echte Feld dieses Workspaces zeigt, gern mit einem Komma am Ende.
 * Leere Stuecke muessen dabei rausfallen: ein leerer Eintrag wuerde in der
 * Pruefung als "kommt in jedem Text vor" durchschlagen und JEDE Zeile als
 * fehlerhaft melden.
 *
 * Ohne eigene Vorgabe gilt die Voreinstellung -- dieselbe, mit der der Worker
 * erzeugt hat.
 */
export function parseBannedWords(raw: string | null | undefined): string[] {
  const parts = (raw ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : DEFAULT_BANNED_WORDS;
}

/** Die Vorgaben eines Workspaces in die Form bringen, die hier gebraucht wird. */
export function reviewSettingsFromWorkspace(
  workspace: { personalization_max_words?: number | null; personalization_banned_words?: string | null } | null,
  lang: "de" | "en"
): ReviewSettings {
  return {
    maxWords: workspace?.personalization_max_words ?? DEFAULT_MAX_WORDS,
    bannedWords: parseBannedWords(workspace?.personalization_banned_words),
    lang,
  };
}

export function reviewIcebreaker(row: IcebreakerRow, settings: ReviewSettings): IcebreakerVerdict {
  const text = (row.personalization ?? "").trim();
  const wasFlagged = Boolean(row.personalization_needs_review);
  const problems = text ? validateIcebreaker(text, settings.maxWords, settings.bannedWords, settings.lang) : [];

  return {
    id: row.id,
    name: row.name,
    text,
    words: text ? wordCount(text) : 0,
    problems,
    // Reihenfolge der Pruefung ist die Reihenfolge der Wichtigkeit: ein echter
    // Verstoss bleibt einer, egal ob er damals schon aufgefallen ist.
    state: problems.length > 0 ? "failing" : wasFlagged ? "stale" : "clean",
    wasFlagged,
  };
}

/**
 * Zeilen ohne Text bleiben aussen vor.
 *
 * Eine Firma ohne Icebreaker ist kein Pruef-, sondern ein Erzeugungsfall --
 * sie gehoert in den Torwart vor dem Kampagnenstart ("X Leads ohne Aufhaenger"),
 * nicht in eine Liste, in der man Texte gegeneinander abwaegt.
 */
export function reviewIcebreakers(rows: IcebreakerRow[], settings: ReviewSettings): IcebreakerVerdict[] {
  return rows
    .filter((r) => (r.personalization ?? "").trim().length > 0)
    .map((r) => reviewIcebreaker(r, settings));
}

export type ReviewSummary = Record<IcebreakerState, number> & { total: number };

export function summarizeReview(verdicts: IcebreakerVerdict[]): ReviewSummary {
  return {
    failing: verdicts.filter((v) => v.state === "failing").length,
    stale: verdicts.filter((v) => v.state === "stale").length,
    clean: verdicts.filter((v) => v.state === "clean").length,
    total: verdicts.length,
  };
}

/**
 * Arbeitsreihenfolge: die schlimmsten Ausreisser zuerst.
 *
 * Innerhalb der fehlerhaften nach Wortzahl absteigend -- wer 45 Woerter bei
 * erlaubten 22 hat, ist ein anderer Fall als wer 23 hat, und der erste ist
 * die Zeile, bei der sich das Nachbessern lohnt.
 */
export function sortVerdicts(verdicts: IcebreakerVerdict[]): IcebreakerVerdict[] {
  const rank: Record<IcebreakerState, number> = { failing: 0, stale: 1, clean: 2 };
  return [...verdicts].sort((a, b) => {
    const diff = rank[a.state] - rank[b.state];
    if (diff !== 0) return diff;
    return b.words - a.words;
  });
}
