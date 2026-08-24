/**
 * Die gespeicherten Icebreaker gegen die HEUTIGEN Regeln nachrechnen.
 *
 * WARUM NICHT EINFACH businesses.personalization_needs_review LESEN
 *
 * Weil dieses Feld festhaelt, was zum ZEITPUNKT DER ERZEUGUNG galt, und die
 * Regeln sich seither geaendert haben. Am 2026-08-02 wurde korrigiert, dass
 * ein Bindestrich INNERHALB eines Wortes ("third-party", "NSF-certified")
 * faelschlich als verbotenes Satzzeichen zaehlte; an zwei Suchen betraf das
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
 * die aktuellen Vorgaben verstossen; ein reiner Filter auf das Flag wuerde
 * sie nie zeigen. Eine Pruefliste, die Faelle uebersieht, ist schlimmer als
 * keine, weil sie das Gefuehl vermittelt, man haette alles gesehen.
 *
 * Daraus ergeben sich die drei Zustaende: was heute wirklich auffaellt
 * (failing), was nur noch eine veraltete Markierung traegt (stale, per
 * Sammelaktion abzuhaken), und der Rest (clean).
 *
 * Die Pruefung selbst kommt aus lib/personalization-defaults.ts und ist die
 * gleiche, die der Live-Test im AI-Agent-Tab benutzt. Sie muss inhaltlich mit
 * validate() in apps/worker/worker/pipelines/personalize.py uebereinstimmen:
 * dort entsteht das Flag.
 *
 * Seit dem 2026-08-24 bewertet dieselbe Logik auch den Website-Befund
 * (Migration 0103). Was daran anders ist, steht bei ReviewKind.
 */
import {
  DEFAULT_BANNED_WORDS,
  DEFAULT_MAX_WORDS,
  validateIcebreaker,
  wordCount,
} from "../personalization-defaults";
import { FINDING_MAX_WORDS } from "../website-finding-defaults";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ZWEI TEXTSORTEN, EINE BEWERTUNG
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Seit Migration 0103 gibt es pro Lead zwei erzeugte Saetze: den Icebreaker
 * (businesses.personalization) und den Website-Befund
 * (businesses.website_finding). Beide gehen durch dieselbe Wortzaehlung und
 * dieselbe Zeichen-Verbotsliste, beide bekommen vom Worker eine Markierung,
 * wenn zwei Versuche daran scheitern. Eine zweite Fassung dieser Datei fuer
 * den Befund wuerde bei der naechsten Regelaenderung an einer Stelle
 * nachgezogen und an der anderen vergessen.
 *
 * Genau ZWEI Unterschiede, beide unten im Code benannt:
 *   1. die Wortgrenze (Einstellung vs. feste 20, siehe FINDING_MAX_WORDS)
 *   2. leer ist beim Befund ein richtiges Ergebnis, kein Mangel
 */
export type ReviewKind = "icebreaker" | "finding";

/**
 * Die Wortgrenze des Befundsatzes.
 *
 * Steht seit dem 2026-08-24 in lib/website-finding-defaults.ts, zusammen mit
 * den Standardtexten, die ebenfalls aus website_finding.py gespiegelt sind:
 * ein Test dort haelt beide Seiten zeichengenau zusammen. Hier nur
 * weitergereicht, damit bestehende Importe aus dieser Datei unveraendert
 * bleiben und niemand die Zahl ein zweites Mal hinschreibt.
 */
export { FINDING_MAX_WORDS };

/** Die Felder aus public.businesses, die fuer die Bewertung gebraucht werden. */
export type IcebreakerRow = {
  id: string;
  name: string | null;
  personalization: string | null;
  personalization_needs_review: boolean | null;
};

/** Dieselbe Zeile, um die Spalten des Website-Befunds erweitert. Beide Paare
 *  optional, weil eine Abfrage immer nur eine Textsorte laedt. */
export type ReviewRow = Partial<IcebreakerRow> & {
  id: string;
  name: string | null;
  website_finding?: string | null;
  website_finding_needs_review?: boolean | null;
};

/**
 * Spalten- und Funktionsnamen je Textsorte, an einer Stelle.
 *
 * Die Route baut daraus ihre Abfragen; ohne diese Tabelle stuende
 * "website_finding_needs_review" dort fuenfmal einzeln getippt.
 */
export type ReviewFieldNames = {
  text: "personalization" | "website_finding";
  flag: "personalization_needs_review" | "website_finding_needs_review";
  /** Die Datenbankfunktion fuer "nochmal erzeugen" (Migrationen 0084 / 0104). */
  requeue: "requeue_personalization" | "requeue_website_finding";
};

export const REVIEW_FIELDS: Record<ReviewKind, ReviewFieldNames> = {
  icebreaker: {
    text: "personalization",
    flag: "personalization_needs_review",
    requeue: "requeue_personalization",
  },
  finding: {
    text: "website_finding",
    flag: "website_finding_needs_review",
    requeue: "requeue_website_finding",
  },
};

/** Aus einem Parameter der Route eine Textsorte machen. Ohne Angabe bleibt
 *  alles beim Icebreaker, damit bestehende Aufrufe unveraendert wirken. */
export function parseReviewKind(raw: string | null | undefined): ReviewKind {
  return raw === "finding" ? "finding" : "icebreaker";
}

/**
 * failing: verstoesst gegen die geltenden Vorgaben, muss angefasst werden.
 * stale:   traegt die Markierung, ist nach heutigen Regeln aber sauber.
 * clean:   unauffaellig.
 *
 * BEWUSST NICHT ERWEITERT: die Pruefliste der Icebreaker zaehlt diese drei
 * Zustaende einzeln auf (app/icebreaker/icebreaker-review.tsx, Record ueber
 * diesen Typ). Ein vierter Wert hier waere kein Zugewinn, sondern ein Fall,
 * den diese Ansicht nicht darstellen kann.
 */
export type IcebreakerState = "failing" | "stale" | "clean";

/**
 * Der Befund kennt einen vierten Zustand: es gibt keinen.
 *
 * Kein Mangel, sondern ein haeufiges, richtiges Ergebnis (keine Website,
 * Seite nicht erreichbar, keine der acht Pruefungen schlaegt an, siehe
 * worker/pipelines/website_finding.py).
 *
 * WARUM DAS NICHT WIE BEIM ICEBREAKER "clean" ODER "stale" HEISSEN KANN:
 * reviewIcebreaker gibt einer leeren Zeile heute clean (oder stale, wenn die
 * Markierung steht). Fuer den Icebreaker ist das folgenlos, weil eine leere
 * Zeile die Pruefliste gar nicht erreicht -- sie ist dort ein Erzeugungsfall
 * fuer den Torwart. Beim Befund wuerde "clean" behaupten, ein Text habe die
 * Pruefung bestanden, wo es keinen Text gibt, und "stale" wuerde jemanden
 * einladen, eine Markierung an einer leeren Zeile abzuraeumen. Deshalb ein
 * eigener Zustand, und er schlaegt die Markierung: der Worker markiert nur,
 * was er geschrieben hat, beides zusammen ist ein Widerspruch.
 */
export type ReviewState = IcebreakerState | "empty";

export type ReviewVerdict = {
  id: string;
  name: string | null;
  text: string;
  words: number;
  /** Menschenlesbar und in der Sprache der Oberflaeche, siehe validateIcebreaker. */
  problems: string[];
  state: ReviewState;
  /** Was in der Datenbank steht, fuer die Erklaerung "warum steht das hier". */
  wasFlagged: boolean;
};

/** Das Urteil ueber einen Icebreaker: dieselbe Form, nur ohne "empty". */
export type IcebreakerVerdict = Omit<ReviewVerdict, "state"> & { state: IcebreakerState };

export type ReviewSettings = {
  maxWords: number;
  bannedWords: string[];
  lang: "de" | "en";
};

/**
 * Die Verbotswoerter des Workspaces aus dem gespeicherten Textfeld lesen.
 *
 * Gespeichert wird eine Zeile wie "—, -, --," — also mit Leerzeichen und,
 * wie das echte Feld dieses Workspaces zeigt, gern mit einem Komma am Ende.
 * Leere Stuecke muessen dabei rausfallen: ein leerer Eintrag wuerde in der
 * Pruefung als "kommt in jedem Text vor" durchschlagen und JEDE Zeile als
 * fehlerhaft melden.
 *
 * Ohne eigene Vorgabe gilt die Voreinstellung, dieselbe, mit der der Worker
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

/**
 * Die Wortgrenze dieser Textsorte.
 *
 * Der Icebreaker nimmt die Einstellung des Workspaces
 * (personalization_max_words), der Befund seine feste Grenze. Steht hier als
 * eigene Funktion, weil die Route dieselbe Zahl auch anzeigen muss und sie
 * sonst zweimal entschieden wuerde.
 */
export function maxWordsFor(kind: ReviewKind, settings: ReviewSettings): number {
  return kind === "finding" ? FINDING_MAX_WORDS : settings.maxWords;
}

/** Einen der beiden Texte einer Zeile bewerten. */
export function reviewText(row: ReviewRow, settings: ReviewSettings, kind: ReviewKind): ReviewVerdict {
  const f = REVIEW_FIELDS[kind];
  const text = (row[f.text] ?? "").trim();
  const wasFlagged = Boolean(row[f.flag]);
  const problems = text
    ? validateIcebreaker(text, maxWordsFor(kind, settings), settings.bannedWords, settings.lang)
    : [];

  return {
    id: row.id,
    name: row.name,
    text,
    words: text ? wordCount(text) : 0,
    problems,
    // Reihenfolge der Pruefung ist die Reihenfolge der Wichtigkeit: ein echter
    // Verstoss bleibt einer, egal ob er damals schon aufgefallen ist.
    //
    // "empty" gibt es nur beim Befund, siehe ReviewState. Beim Icebreaker
    // bleibt es bei clean/stale, damit die bestehende Pruefliste unveraendert
    // arbeitet.
    state:
      problems.length > 0
        ? "failing"
        : !text && kind === "finding"
          ? "empty"
          : wasFlagged
            ? "stale"
            : "clean",
    wasFlagged,
  };
}

export function reviewIcebreaker(row: IcebreakerRow, settings: ReviewSettings): IcebreakerVerdict {
  // Die Verengung ist keine Annahme, sondern die Bedingung oben: bei
  // kind = "icebreaker" entsteht "empty" nicht.
  return reviewText(row, settings, "icebreaker") as IcebreakerVerdict;
}

/**
 * Zeilen ohne Text bleiben aussen vor.
 *
 * Eine Firma ohne Icebreaker ist kein Pruef-, sondern ein Erzeugungsfall:
 * sie gehoert in den Torwart vor dem Kampagnenstart ("X Leads ohne Aufhaenger"),
 * nicht in eine Liste, in der man Texte gegeneinander abwaegt.
 *
 * Fuer den Befund gilt dasselbe, aber aus dem anderen Grund: dort ist "kein
 * Text" ein fertiges, richtiges Ergebnis und nichts, was jemand abarbeiten
 * koennte. In einer Liste, in der man Texte gegeneinander abwaegt, waeren
 * diese Zeilen nur Rauschen -- und sie waeren die Mehrheit. Wer sie zaehlen
 * will, fragt den Torwart vor dem Kampagnenstart; wer eine einzelne Zeile
 * beurteilen will, bekommt von reviewText den Zustand "empty".
 */
export function reviewTexts(
  rows: ReviewRow[],
  settings: ReviewSettings,
  kind: ReviewKind
): ReviewVerdict[] {
  const f = REVIEW_FIELDS[kind];
  return rows
    .filter((r) => (r[f.text] ?? "").trim().length > 0)
    .map((r) => reviewText(r, settings, kind));
}

export function reviewIcebreakers(rows: IcebreakerRow[], settings: ReviewSettings): IcebreakerVerdict[] {
  return reviewTexts(rows, settings, "icebreaker") as IcebreakerVerdict[];
}

/**
 * Nur die drei Zustaende der Pruefliste. "empty" fehlt hier bewusst: aus
 * reviewTexts kommt es nicht (leere Zeilen sind vorher raus), und ein Feld,
 * das immer 0 waere, wuerde in der Anzeige eine Kategorie vortaeuschen, die
 * niemand abarbeiten kann.
 */
export type ReviewSummary = Record<IcebreakerState, number> & { total: number };

export function summarizeReview(verdicts: ReviewVerdict[]): ReviewSummary {
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
 * Innerhalb der fehlerhaften nach Wortzahl absteigend: wer 45 Woerter bei
 * erlaubten 22 hat, ist ein anderer Fall als wer 23 hat, und der erste ist
 * die Zeile, bei der sich das Nachbessern lohnt.
 */
export function sortVerdicts<T extends ReviewVerdict>(verdicts: T[]): T[] {
  // "empty" ganz nach hinten: da ist nichts zu tun, es steht nur zur
  // Kenntnis da.
  const rank: Record<ReviewState, number> = { failing: 0, stale: 1, clean: 2, empty: 3 };
  return [...verdicts].sort((a, b) => {
    const diff = rank[a.state] - rank[b.state];
    if (diff !== 0) return diff;
    return b.words - a.words;
  });
}
