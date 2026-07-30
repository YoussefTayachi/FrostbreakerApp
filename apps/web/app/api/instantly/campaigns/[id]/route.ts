import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import {
  buildCampaignSchedule,
  buildCampaignSequence,
  loadOwnedCampaign,
  sequenceFromInstantly,
  scheduleFromInstantly,
  toLocalStatus,
  type InstantlyCampaign,
  type SequenceStep,
} from "@/lib/instantly/campaigns";

/** Kuerzt Postgres' "HH:MM:SS"-Zeitformat auf "HH:MM" fuer <input type="time">. */
function toHhMm(t: string) {
  return t.slice(0, 5);
}

/**
 * Kampagnen-Detailseite: laedt live von Instantly (Status/Sequenz/Zeitplan
 * koennen sich dort aendern, z.B. wenn jemand direkt in Instantly etwas
 * anpasst), zaehlt aber den lokalen campaign_leads-Bestand fuer "wie viele
 * der verfuegbaren Leads sind schon drin" -- das kennt Instantly so nicht.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const local = await loadOwnedCampaign(supabase, ctx.workspace.id, id);
  if (!local || !local.instantly_campaign_id) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  let live: InstantlyCampaign;
  try {
    live = await instantlyRequest<InstantlyCampaign>(ctx.apiKey, `/api/v2/campaigns/${local.instantly_campaign_id}`);
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  const liveStatus = toLocalStatus(live.status);
  if (liveStatus !== local.status) {
    await supabase.from("campaigns").update({ status: liveStatus }).eq("id", local.id);
  }

  const [{ count: leadsAdded }, search, stats] = await Promise.all([
    supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", local.id),
    local.search_id
      ? supabase.from("searches").select("id, name, query, location").eq("id", local.search_id).single()
      : Promise.resolve({ data: null }),
    local.search_id
      ? supabase
          .from("instantly_campaign_stats")
          .select("leads_count, contacted_count, emails_sent_count, open_count, reply_count_unique, bounced_count, unsubscribed_count, completed_count")
          .eq("search_id", local.search_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let leadsAvailable = 0;
  if (local.search_id) {
    const { count } = await supabase
      .from("contacts")
      .select("id, businesses!inner(search_id)", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .eq("businesses.search_id", local.search_id)
      .not("email", "is", null);
    leadsAvailable = count ?? 0;
  }

  const schedule = scheduleFromInstantly(live);

  return NextResponse.json({
    id: local.id,
    name: live.name ?? local.name,
    status: liveStatus,
    instantlyCampaignId: local.instantly_campaign_id,
    search: search.data,
    mailboxes: live.email_list ?? local.mailboxes,
    steps: sequenceFromInstantly(live),
    days: schedule.days,
    from: schedule.from || toHhMm(local.send_window_start),
    to: schedule.to || toHhMm(local.send_window_end),
    timezone: schedule.timezone || local.timezone,
    dailyLimit: live.daily_limit ?? local.daily_limit,
    activatedAt: local.activated_at,
    createdAt: local.created_at,
    leadsAdded: leadsAdded ?? 0,
    leadsAvailable,
    stats: stats.data ?? null,
  });
}

type UpdateCampaignBody = {
  name?: string;
  mailboxes?: string[];
  steps?: SequenceStep[];
  days?: number[];
  from?: string;
  to?: string;
  timezone?: string;
  dailyLimit?: number | null;
};

/** Bearbeitet Name/Sequenz/Zeitplan/Mailboxen einer bestehenden Kampagne -- der Suchen-Bezug (search_id) ist bewusst nicht editierbar, siehe Kampagnen-Formular. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const local = await loadOwnedCampaign(supabase, ctx.workspace.id, id);
  if (!local || !local.instantly_campaign_id) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  const body = (await req.json()) as UpdateCampaignBody;
  const name = body.name?.trim() || local.name;
  const mailboxes = body.mailboxes?.length ? body.mailboxes : local.mailboxes;
  const days = body.days?.length ? body.days : local.days;
  const from = body.from || toHhMm(local.send_window_start);
  const to = body.to || toHhMm(local.send_window_end);
  const timezone = body.timezone || local.timezone;
  const dailyLimit = body.dailyLimit !== undefined ? body.dailyLimit : local.daily_limit;

  let steps = body.steps;
  if (!steps || steps.length === 0) {
    const { data: existingSteps } = await supabase
      .from("campaign_steps")
      .select("subject, body, wait_days")
      .eq("campaign_id", local.id)
      .order("step_order");
    steps = (existingSteps ?? []).map((s) => ({ subject: s.subject, body: s.body, delayDays: s.wait_days }));
  }
  if (steps.some((s) => !s.subject?.trim() || !s.body?.trim())) {
    return NextResponse.json({ error: "Jeder Schritt braucht Betreff und Text." }, { status: 400 });
  }

  try {
    await instantlyRequest(ctx.apiKey, `/api/v2/campaigns/${local.instantly_campaign_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        campaign_schedule: buildCampaignSchedule({ days, from, to, timezone }),
        sequences: buildCampaignSequence(steps),
        email_list: mailboxes,
        daily_limit: dailyLimit || undefined,
      }),
    });
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  await supabase
    .from("campaigns")
    .update({
      name,
      mailboxes,
      days,
      send_window_start: from,
      send_window_end: to,
      timezone,
      daily_limit: dailyLimit || null,
    })
    .eq("id", local.id);

  await supabase.from("campaign_steps").delete().eq("campaign_id", local.id);
  await supabase.from("campaign_steps").insert(
    steps.map((s, i) => ({
      campaign_id: local.id,
      step_order: i,
      wait_days: s.delayDays ?? 0,
      subject: s.subject,
      body: s.body,
    }))
  );

  return NextResponse.json({ ok: true });
}

/**
 * Loescht eine Kampagne komplett -- lokal und (falls vorhanden) auch bei
 * Instantly. Bewusst tolerant, wenn Instantly die Kampagne schon nicht mehr
 * kennt (z.B. direkt dort geloescht, oder die Anlage ist beim ersten Schritt
 * fehlgeschlagen): das darf das Aufraeumen der lokalen Zeile nicht blockieren,
 * sonst haengt der Nutzer an einer Kampagne fest, deren Detailseite ohnehin
 * nur noch "Kampagne nicht gefunden" zeigt.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const local = await loadOwnedCampaign(supabase, ctx.workspace.id, id);
  if (!local) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  if (local.instantly_campaign_id) {
    try {
      await instantlyRequest(ctx.apiKey, `/api/v2/campaigns/${local.instantly_campaign_id}`, {
        method: "DELETE",
      });
    } catch (e) {
      if (!(e instanceof InstantlyApiError) || e.status !== 404) {
        const status = e instanceof InstantlyApiError ? e.status : 500;
        return NextResponse.json({ error: (e as Error).message }, { status });
      }
    }
  }

  // Ohne das bleibt searches.instantly_campaign_id gesetzt und der POST-Check
  // in api/instantly/campaigns ("Diese Suche hat bereits eine verknuepfte
  // Kampagne") sperrt diese Suche dauerhaft fuer eine neue Kampagne.
  if (local.search_id) {
    await supabase
      .from("searches")
      .update({ instantly_campaign_id: null })
      .eq("id", local.search_id)
      .eq("workspace_id", ctx.workspace.id);
  }

  await supabase.from("campaigns").delete().eq("id", local.id).eq("workspace_id", ctx.workspace.id);

  return NextResponse.json({ ok: true });
}
