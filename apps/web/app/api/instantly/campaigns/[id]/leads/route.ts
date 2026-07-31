import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { loadOwnedCampaign } from "@/lib/instantly/campaigns";

/**
 * Fuegt Kontakte hinzu, die seit dem Erstellen (oder dem letzten Aufruf hier)
 * neu zur verknuepften Suche dazugekommen sind -- relevant bei woechentlichem/
 * taeglichem Lead-Abo einer Suche, wo die urspruengliche Kampagnen-Erstellung
 * nur einen Schnappschuss der Kontakte zu dem Zeitpunkt aufgenommen hat.
 * campaign_leads ist die lokale Quelle fuer "schon hinzugefuegt" (Instantlys
 * eigenes Dedupe-Verhalten bei doppeltem /leads/add ist nicht dokumentiert
 * genug, um sich blind darauf zu verlassen).
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

  const { data: linkedSearches } = await supabase
    .from("campaign_searches")
    .select("search_id")
    .eq("campaign_id", local.id);
  const searchIds = (linkedSearches ?? []).map((r) => r.search_id);
  if (searchIds.length === 0) {
    return NextResponse.json({ error: "Diese Kampagne hat keine verknuepfte Suche." }, { status: 400 });
  }

  const [{ data: contacts }, { data: alreadyAdded }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, email, first_name, last_name, businesses!inner(name, personalization, search_id)")
      .eq("workspace_id", ctx.workspace.id)
      .in("businesses.search_id", searchIds)
      .not("email", "is", null)
      .limit(5000),
    supabase.from("campaign_leads").select("contact_id").eq("campaign_id", local.id),
  ]);

  type ContactRow = {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    businesses: { name: string | null; personalization: string | null } | null;
  };

  const addedIds = new Set((alreadyAdded ?? []).map((r) => r.contact_id));
  const newRows = ((contacts ?? []) as unknown as ContactRow[]).filter((c) => !!c.email && !addedIds.has(c.id));

  if (newRows.length === 0) {
    return NextResponse.json({ ok: true, added: 0 });
  }

  const leads = newRows.map((c) => ({
    email: c.email as string,
    first_name: c.first_name || undefined,
    last_name: c.last_name || undefined,
    company_name: c.businesses?.name || undefined,
    personalization: c.businesses?.personalization || undefined,
  }));

  try {
    for (let i = 0; i < leads.length; i += 1000) {
      const chunk = leads.slice(i, i + 1000);
      await instantlyRequest(ctx.apiKey, "/api/v2/leads/add", {
        method: "POST",
        body: JSON.stringify({ campaign_id: local.instantly_campaign_id, leads: chunk }),
      });
    }
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  await supabase.from("campaign_leads").upsert(
    newRows.map((c) => ({ campaign_id: local.id, contact_id: c.id })),
    { onConflict: "campaign_id,contact_id", ignoreDuplicates: true }
  );

  return NextResponse.json({ ok: true, added: newRows.length });
}
