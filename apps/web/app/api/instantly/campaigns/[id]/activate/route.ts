import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { loadOwnedCampaign } from "@/lib/instantly/campaigns";

/**
 * Startet eine Draft-Kampagne oder setzt eine pausierte fort; Instantly
 * nutzt denselben Endpoint fuer beides (POST .../activate). Instantly-Kampagnen
 * werden nach dem Anlegen NIE automatisch aktiv (Status bleibt "Draft", es
 * wird nichts versendet), deshalb ist das hier bewusst ein eigener, expliziter
 * Schritt mit Bestaetigung im Frontend, statt automatisch nach dem Erstellen
 * zu aktivieren.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const local = await loadOwnedCampaign(supabase, ctx.workspace.id, id);
  if (!local || !local.instantly_campaign_id) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  try {
    await instantlyRequest(ctx.apiKey, `/api/v2/campaigns/${local.instantly_campaign_id}/activate`, { method: "POST" });
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  await supabase
    .from("campaigns")
    .update({ status: "active", activated_at: local.activated_at ?? new Date().toISOString() })
    .eq("id", local.id);

  return NextResponse.json({ ok: true });
}
