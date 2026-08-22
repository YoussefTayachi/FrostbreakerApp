/**
 * Verbrauch kostenpflichtiger API-Aufrufe festhalten: die Web-Seite.
 *
 * DAS GEGENSTUECK ZU worker/usage.py, UND WARUM ES DAS BRAUCHT
 *
 * Der Worker haelt jeden zahlungsrelevanten Aufruf fest. Im Web tat das bis
 * zum 2026-08-12 genau EINE Stelle: api/verify-emails. Die drei
 * OpenAI-Aufrufe im Web (der Live-Test im KI-Agenten, die Antwortentwuerfe
 * im Posteingang, die Einstufung eingehender Mails im Minutentakt-Cron)
 * schrieben nichts. Unter "API-Kosten" tauchten sie nicht auf; das Dashboard
 * zeigte sie als nicht existent an.
 *
 * Beim Einstufen faellt das am meisten ins Gewicht: pg_cron ruft die Route
 * jede Minute auf. Das ist kein Nebenposten, das ist eine Dauerlast, die
 * niemand sehen konnte.
 *
 * Die Preise stehen bewusst doppelt: hier und in worker/usage.py. Sie
 * MUESSEN uebereinstimmen; eine gemeinsame Quelle gaebe es nur ueber die
 * Datenbank, und dann haette eine Kostenzeile eine zweite Abfrage noetig.
 * Wer einen Preis aendert, aendert beide Dateien.
 *
 * Wie im Worker gilt: das Festhalten darf nie den eigentlichen Arbeitsschritt
 * kippen. Schlaegt der Schreibvorgang fehl, geht es ohne Kostenzeile weiter.
 * Eine fehlende Zeile ist aergerlich, ein verlorener Entwurf teurer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// Muss mit OPENAI_USD_PER_1M_* in apps/worker/worker/usage.py uebereinstimmen.
// Veroeffentlichte Listenpreise, Stand der letzten Pruefung 2026-08-02.
export const OPENAI_USD_PER_1M_INPUT = 0.4;
export const OPENAI_USD_PER_1M_OUTPUT = 1.6;

export function openaiCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * OPENAI_USD_PER_1M_INPUT +
    (outputTokens / 1_000_000) * OPENAI_USD_PER_1M_OUTPUT
  );
}

// Muss mit ANTHROPIC_USD_PER_1M_* in apps/worker/worker/usage.py
// uebereinstimmen. Listenpreise fuer CLAUDE_MODEL (Claude Opus 5), Stand der
// letzten Pruefung 2026-08-22, nachgesehen auf
// https://platform.claude.com/docs/en/about-claude/pricing.
//
// Cache-Tokens haben eigene Preise, weil Anthropic sie getrennt meldet und
// getrennt abrechnet: Schreiben das 1,25fache, Lesen ein Zehntel des
// Eingangspreises. Der 5-Minuten-Preis, weil lib/anthropic.ts cache_control
// ohne ttl setzt.
export const ANTHROPIC_USD_PER_1M_INPUT = 5.0;
export const ANTHROPIC_USD_PER_1M_OUTPUT = 25.0;
export const ANTHROPIC_USD_PER_1M_CACHE_WRITE = 6.25;
export const ANTHROPIC_USD_PER_1M_CACHE_READ = 0.5;

export function anthropicCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0
): number {
  return (
    (inputTokens / 1_000_000) * ANTHROPIC_USD_PER_1M_INPUT +
    (outputTokens / 1_000_000) * ANTHROPIC_USD_PER_1M_OUTPUT +
    (cacheWriteTokens / 1_000_000) * ANTHROPIC_USD_PER_1M_CACHE_WRITE +
    (cacheReadTokens / 1_000_000) * ANTHROPIC_USD_PER_1M_CACHE_READ
  );
}

/** Was die Responses-API im usage-Feld meldet. */
type ResponsesUsage = { input_tokens?: number; output_tokens?: number };

export function tokensFromResponse(json: unknown): { input: number; output: number } | null {
  const usage = (json as { usage?: ResponsesUsage } | null)?.usage;
  if (!usage) return null;
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input + output <= 0) return null;
  return { input, output };
}

/** Eine Verbrauchszeile schreiben. Wirft nie. */
export async function recordUsage(
  supabase: SupabaseClient,
  row: {
    workspaceId: string;
    provider: string;
    operation: string;
    units: number;
    unitKind: string;
    costUsd?: number | null;
    searchId?: string | null;
  }
): Promise<void> {
  if (row.units <= 0) return;
  try {
    await supabase.from("api_usage").insert({
      workspace_id: row.workspaceId,
      provider: row.provider,
      operation: row.operation,
      units: row.units,
      unit_kind: row.unitKind,
      cost_usd: row.costUsd ?? null,
      search_id: row.searchId ?? null,
    });
  } catch {
    // Bewusst still: siehe Modulkommentar.
  }
}

/**
 * Tokenverbrauch aus einer OpenAI-Antwort uebernehmen.
 *
 * Gezaehlt wird, was die Antwort selbst meldet, nicht was wir geschaetzt
 * haetten; eine Korrekturrunde schlaegt damit korrekt ein zweites Mal zu
 * Buche. Fehlt das usage-Feld, wird nichts geschrieben statt geraten (gleiche
 * Regel wie im Worker: eine ehrliche Luecke statt einer erfundenen Zahl).
 */
export async function recordOpenAiUsage(
  supabase: SupabaseClient,
  workspaceId: string,
  operation: string,
  responseJson: unknown
): Promise<void> {
  const tokens = tokensFromResponse(responseJson);
  if (!tokens) return;
  await recordUsage(supabase, {
    workspaceId,
    provider: "openai",
    operation,
    units: tokens.input + tokens.output,
    unitKind: "tokens",
    costUsd: openaiCostUsd(tokens.input, tokens.output),
  });
}

/** Was die Messages-API im usage-Feld meldet. */
type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export function claudeTokensFromResponse(
  json: unknown
): { input: number; output: number; cacheWrite: number; cacheRead: number } | null {
  const usage = (json as { usage?: ClaudeUsage } | null)?.usage;
  if (!usage) return null;
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const all = [input, output, cacheWrite, cacheRead];
  if (all.some((n) => !Number.isFinite(n))) return null;
  if (input + output + cacheWrite + cacheRead <= 0) return null;
  return { input, output, cacheWrite, cacheRead };
}

/**
 * Tokenverbrauch aus einer Anthropic-Antwort uebernehmen.
 *
 * Gegenstueck zu record_claude() in apps/worker/worker/usage.py, gleiche
 * Regel: gezaehlt wird, was die Antwort meldet, und fehlt das usage-Feld,
 * wird nichts geschrieben statt geraten.
 *
 * Die beiden Cache-Felder muessen mitgezaehlt werden. Anthropic zaehlt sie
 * NEBEN input_tokens, nicht darin (total = cache_read + cache_creation +
 * input_tokens, siehe die Doku zu "Cache-aware ITPM"). Wer sie weglaesst,
 * meldet bei einem gecachten Vorspann fast keinen Verbrauch, obwohl die
 * Tokens abgerechnet werden.
 */
export async function recordClaudeUsage(
  supabase: SupabaseClient,
  workspaceId: string,
  operation: string,
  responseJson: unknown
): Promise<void> {
  const t = claudeTokensFromResponse(responseJson);
  if (!t) return;
  await recordUsage(supabase, {
    workspaceId,
    provider: "anthropic",
    operation,
    units: t.input + t.output + t.cacheWrite + t.cacheRead,
    unitKind: "tokens",
    costUsd: anthropicCostUsd(t.input, t.output, t.cacheWrite, t.cacheRead),
  });
}
