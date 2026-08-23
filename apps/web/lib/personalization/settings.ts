import {
  DEFAULT_MAX_WORDS,
  getDefaultPrompt,
  SOURCE_VALUES,
} from "@/lib/personalization-defaults";
import { parseBannedWords } from "@/lib/personalization/review";

/**
 * Die WIRKSAMEN Schreibregeln eines Workspaces.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIE ROHSPALTEN NICHT REICHEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Gemessen am 2026-08-23 im Workspace 2d9bb9ae-…: personalization_banned_words
 * ist NULL und personalization_prompt ist leer. Trotzdem zeigt die Oberflaeche
 * dort "— – -- -" als verbotene Zeichen an und der Worker erzeugt gegen den
 * deutschen Standardprompt. Wer die Spalten liest und ausliefert, meldet also
 * "keine verbotenen Woerter" fuer einen Workspace, der genau diese Zeichen
 * verbietet -- und ein Modell, das sich daran haelt, schreibt anschliessend
 * dreissig Verstoesse in die Pruefliste.
 *
 * Diese Datei ist deshalb die eine Stelle, an der aus den Spalten die Werte
 * werden, mit denen tatsaechlich gearbeitet wird. Sie baut ausdruecklich auf
 * dem auf, was es schon gibt (parseBannedWords, getDefaultPrompt,
 * DEFAULT_MAX_WORDS): eine zweite Fassung der Rueckfall-Regeln waere genau der
 * Fehler, den sie beheben soll.
 *
 * DREI STELLEN LOESEN HEUTE DASSELBE AUF, und sie sind sich einig:
 *   - apps/worker/worker/pipelines/personalize.py::load_agent_config (Produktion)
 *   - app/api/personalization/review/route.ts::loadSettings (Pruefliste)
 *   - app/ai-agent/page.tsx (Formular)
 * Diese Datei ist bewusst KEIN Umbau dieser drei, sondern die vierte Nutzung
 * derselben Bausteine, gebraucht vom MCP-Server. Wer hier etwas aendert, muss
 * personalize.py mit ansehen: die beiden Seiten sollen dasselbe rechnen.
 */

export type PersonalizationLanguage = "de" | "en";
export type PersonalizationSource = (typeof SOURCE_VALUES)[number];

/** Woher ein wirksamer Wert stammt. */
export type RuleOrigin = "workspace" | "default";

/**
 * Die Spalten, aus denen sich die Regeln ergeben. Ein Literal, kein
 * Zusammenbau: Supabase leitet die Feldtypen aus dem String ab (dieselbe Falle
 * wie bei OFFER_COLUMNS in lib/offers.ts).
 */
export const WRITING_RULE_COLUMNS =
  "personalization_prompt, personalization_source, personalization_max_words, personalization_banned_words, personalization_language";

export type WorkspaceWritingRow = {
  personalization_prompt?: string | null;
  personalization_source?: string | null;
  personalization_max_words?: number | null;
  personalization_banned_words?: string | null;
  personalization_language?: string | null;
};

export type WritingRules = {
  maxWords: number;
  bannedWords: string[];
  language: PersonalizationLanguage;
  source: PersonalizationSource;
  /** Der Systemprompt, der tatsaechlich an das Modell geht. */
  prompt: string;
  /** Je Wert: stand er in der Spalte oder kam er aus den Standards? */
  origin: {
    maxWords: RuleOrigin;
    bannedWords: RuleOrigin;
    language: RuleOrigin;
    source: RuleOrigin;
    prompt: RuleOrigin;
  };
};

/**
 * WAS "workspace" HIER HEISST, UND WAS NICHT.
 *
 * "workspace" heisst: in der Spalte stand ein brauchbarer Wert, er wurde
 * genommen. "default" heisst: die Spalte war leer oder unbrauchbar, und der
 * Wert kommt aus lib/personalization-defaults.ts.
 *
 * Was es NICHT unterscheidet: ob ein Mensch den Wert bewusst gesetzt hat oder
 * ob er der Spalten-Default aus der Migration ist. personalization_max_words,
 * personalization_source und personalization_language sind "not null" mit
 * Default (Migrationen 0012, 0083, 0094), stehen also immer da; sie melden
 * deshalb praktisch immer "workspace", auch wenn nie jemand daran gedreht hat.
 * Nur personalization_prompt und personalization_banned_words sind nullable
 * und trennen die beiden Faelle wirklich. Eine feinere Auskunft waere erfunden.
 */
export function resolveWritingRules(row: WorkspaceWritingRow | null | undefined): WritingRules {
  const rohSprache = (row?.personalization_language ?? "").trim();
  const sprachtreffer = rohSprache === "de" || rohSprache === "en";
  const language: PersonalizationLanguage = sprachtreffer
    ? (rohSprache as PersonalizationLanguage)
    : "de";

  const rohQuelle = (row?.personalization_source ?? "").trim();
  const quelltreffer = (SOURCE_VALUES as readonly string[]).includes(rohQuelle);
  const source: PersonalizationSource = quelltreffer
    ? (rohQuelle as PersonalizationSource)
    : "company_summary";

  const rohWorte = row?.personalization_max_words;
  const worteGesetzt = typeof rohWorte === "number" && Number.isFinite(rohWorte) && rohWorte > 0;

  /**
   * Der WERT kommt aus parseBannedWords, damit es die Rueckfall-Regel nur
   * einmal gibt. Ob der Rueckfall gegriffen hat, sieht man ihm hinterher aber
   * nicht mehr an -- deshalb daneben dieselbe Zerlegung nur zum Zaehlen. Ein
   * Feld, in dem nur Kommas stehen, ist dabei dasselbe wie ein leeres.
   */
  const rohVerboten = row?.personalization_banned_words ?? "";
  const eigeneVerbote = rohVerboten.split(",").map((w) => w.trim()).filter(Boolean);

  const rohPrompt = (row?.personalization_prompt ?? "").trim();

  return {
    maxWords: worteGesetzt ? rohWorte : DEFAULT_MAX_WORDS,
    bannedWords: parseBannedWords(rohVerboten),
    language,
    source,
    // Ohne eigenen Prompt gilt der Standard IN DER GEWAEHLTEN SPRACHE, nicht
    // fest der deutsche: derselbe Fehler, den Migration 0083 im Worker
    // behoben hat (deutsche Icebreaker fuer einen englischen Workspace).
    prompt: rohPrompt || getDefaultPrompt(language),
    origin: {
      maxWords: worteGesetzt ? "workspace" : "default",
      bannedWords: eigeneVerbote.length > 0 ? "workspace" : "default",
      language: sprachtreffer ? "workspace" : "default",
      source: quelltreffer ? "workspace" : "default",
      prompt: rohPrompt ? "workspace" : "default",
    },
  };
}
