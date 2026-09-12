"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";

/**
 * Eine Kampagne aus der Wirkungs-Auswertung ausblenden oder zurueckholen.
 *
 * Kein Loeschen: die Kampagne, ihre messages und ihre Zahlen bleiben alle
 * bestehen, nur die Auswertung schiebt sie in den eingeklappten
 * Archivbereich (Migration 0116). Als Server-Action statt API-Route, weil
 * die Wirkungs-Seite eine Server-Komponente ohne eigenes Client-JS ist und
 * ein <form>-Knopf dafuer voellig reicht.
 *
 * Workspace-Filter ausdruecklich in der Query: RLS regelt nur, WESSEN
 * Kampagnen jemand sieht, nicht welcher seiner Workspaces gemeint ist
 * (siehe CLAUDE.md, haeufigste Fehlerquelle).
 */
export async function setStatsArchived(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const archive = formData.get("archive") === "1";
  if (!campaignId) return;

  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return;

  await supabase
    .from("campaigns")
    .update({ stats_archived_at: archive ? new Date().toISOString() : null })
    .eq("id", campaignId)
    .eq("workspace_id", ws.workspace.id);

  revalidatePath("/wirkung");
}
