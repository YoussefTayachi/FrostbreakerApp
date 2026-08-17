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
