import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_CUSTOM_FIELDS,
  type FieldFillFrom,
  type OfferFieldDefRow,
} from "@/lib/copy/offer-custom-fields";

/** Die Spalten, die aus offer_field_defs gelesen werden. Ein Literal, kein
 *  Zusammenbau: Supabase leitet die Feldtypen aus dem String ab (gleiche Falle
 *  wie bei OFFER_COLUMNS in lib/offers.ts). */
export const FIELD_DEF_COLUMNS = "id, key, label, instruction, fill_from, sort_order";

/**
 * Die eigenen Feld-Definitionen dieses Workspaces.
 *
 * Einzige Stelle, die offer_field_defs fuer die Prompt-Erzeugung liest, damit
 * der Workspace-Filter nicht in vier Routen einzeln richtig sein muss: RLS
 * regelt, auf welche Accounts jemand zugreifen darf, nicht, welcher der
 * eigenen Workspaces gemeint ist (siehe CLAUDE.md).
 *
 * Der Deckel steht auch hier, nicht nur im Formular: eine von Hand angelegte
 * neunte Zeile darf keinen Prompt verlaengern.
 */
export async function loadFieldDefs(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<OfferFieldDefRow[]> {
  const { data } = await supabase
    .from("offer_field_defs")
    .select(FIELD_DEF_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .limit(MAX_CUSTOM_FIELDS);
  return ((data ?? []) as unknown as OfferFieldDefRow[]).map((d) => ({
    ...d,
    fill_from: d.fill_from as FieldFillFrom,
  }));
}
