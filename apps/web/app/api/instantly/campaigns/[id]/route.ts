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
  primaryVariant,
  type SequenceStep,
  type StepVariant,
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

  /**
   * ALLE verknuepften Suchen, nicht nur campaigns.search_id.
   *
   * Seit Migration 0050 kann eine Kampagne aus mehreren Suchen gespeist
   * werden; search_id ist davon nur noch die erste. Diese Seite las
   * ausschliesslich sie, was bei der ersten Kampagne mit fuenf Suchen
   * sichtbar wurde: "406 von 98 verfuegbaren Leads hinzugefuegt". Die 406
   * stimmten, die 98 waren eine von fuenf Listen.
   *
   * Dieselbe Korrektur wie in api/instantly/campaigns fuer die Uebersicht --
   * dort fiel es zuerst auf, hier stand sie noch aus.
   */
  const { data: links } = await supabase
    .from("campaign_searches")
    .select("search_id")
    .eq("campaign_id", local.id);
  const searchIds = links?.length
    ? links.map((l) => l.search_id as string)
    : local.search_id
      ? [local.search_id]
      : [];

  const [{ count: leadsAdded }, searches, stats] = await Promise.all([
    supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", local.id),
    searchIds.length
      ? supabase.from("searches").select("id, name, query, location").in("id", searchIds)
      : Promise.resolve({ data: [] }),
    searchIds.length
      ? supabase
          .from("instantly_campaign_stats")
          .select("leads_count, contacted_count, emails_sent_count, open_count, reply_count_unique, bounced_count, unsubscribed_count, completed_count")
          .in("search_id", searchIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Ueber alle Suchen aufaddiert. Instantly fuehrt die Zahlen je Kampagne,
  // gespiegelt werden sie je Suche -- die Summe ist damit die Kampagnenzahl.
  const statRows = (stats.data ?? []) as Record<string, number>[];
  const summedStats = statRows.length
    ? statRows.reduce((sum, row) => {
        for (const key of Object.keys(row)) sum[key] = (sum[key] ?? 0) + (row[key] ?? 0);
        return sum;
      }, {} as Record<string, number>)
    : null;

  let leadsAvailable = 0;
  if (searchIds.length) {
    const { count } = await supabase
      .from("contacts")
      .select("id, businesses!inner(search_id)", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspace.id)
      .in("businesses.search_id", searchIds)
      .not("email", "is", null);
    leadsAvailable = count ?? 0;
  }

  const schedule = scheduleFromInstantly(live);

  // Sicherheitsnetz gegen verschwundene Entwuerfe: die Sequenz kommt bewusst
  // live von Instantly (dort kann sie jemand direkt bearbeitet haben), aber
  // wenn ein Text dort leer ist, gewinnt die lokale Kopie. Sonst zeigt die
  // Oberflaeche ein leeres Feld und ueberschreibt es beim naechsten Speichern
  // auch noch mit Leere -- der Text waere endgueltig weg, obwohl er in
  // campaign_steps noch vollstaendig vorliegt.
  const { data: mirroredSteps } = await supabase
    .from("campaign_steps")
    .select("subject, body, wait_days, variants")
    .eq("campaign_id", local.id)
    .order("step_order");

  /** Die gespiegelten Fassungen eines Schrittes, mit Ruecksfall auf
   *  subject/body fuer Zeilen von vor Migration 0071. */
  function mirroredVariants(i: number): StepVariant[] {
    const row = mirroredSteps?.[i];
    if (!row) return [];
    const stored = row.variants as StepVariant[] | null;
    if (stored?.length) return stored;
    return [{ subject: row.subject ?? "", body: row.body ?? "" }];
  }

  const liveSteps = sequenceFromInstantly(live);
  const steps = liveSteps.map((s, i) => ({
    ...s,
    // Je Variante einzeln: bei zwei Fassungen kann die eine bei Instantly
    // vollstaendig sein und die andere leer, und dann darf nur die leere aus
    // dem Spiegel ergaenzt werden.
    variants: s.variants.map((v, vi) => {
      const mirrored = mirroredVariants(i)[vi];
      return {
        ...v,
        subject: v.subject.trim() ? v.subject : mirrored?.subject ?? v.subject,
        body: v.body.trim() ? v.body : mirrored?.body ?? v.body,
      };
    }),
  }));
  const effectiveSteps =
    steps.length > 0
      ? steps
      : (mirroredSteps ?? []).map((s, i) => ({
          variants: mirroredVariants(i),
          delayDays: s.wait_days,
        }));

  return NextResponse.json({
    id: local.id,
    name: live.name ?? local.name,
    status: liveStatus,
    instantlyCampaignId: local.instantly_campaign_id,
    // Die erste bleibt fuer die Ueberschrift, alle fuer die Aufzaehlung.
    search: (searches.data ?? [])[0] ?? null,
    searches: searches.data ?? [],
    mailboxes: live.email_list ?? local.mailboxes,
    steps: effectiveSteps,
    days: schedule.days,
    from: schedule.from || toHhMm(local.send_window_start),
    to: schedule.to || toHhMm(local.send_window_end),
    timezone: schedule.timezone || local.timezone,
    dailyLimit: live.daily_limit ?? local.daily_limit,
    // Live vor Spiegel: bei Instantly kann jemand direkt umgestellt haben,
    // und was dort gilt, entscheidet ueber jede versendete Mail.
    openTracking: live.open_tracking ?? local.open_tracking,
    linkTracking: live.link_tracking ?? local.link_tracking,
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
  openTracking?: boolean;
  linkTracking?: boolean;
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
  // Ohne Angabe bleibt der gespiegelte Zustand. Null (vor Migration 0071
  // angelegt) wird dabei zu false -- damit steht ab dem ersten Speichern
  // fest, was gilt, statt weiter "unbekannt" zu sein.
  const openTracking = body.openTracking !== undefined ? body.openTracking : local.open_tracking === true;
  const linkTracking = body.linkTracking !== undefined ? body.linkTracking : local.link_tracking === true;

  let steps = body.steps;
  if (!steps || steps.length === 0) {
    const { data: existingSteps } = await supabase
      .from("campaign_steps")
      .select("subject, body, wait_days, variants")
      .eq("campaign_id", local.id)
      .order("step_order");
    // Ruecksfall auf subject/body fuer Schritte, die vor Migration 0071
    // angelegt wurden und deren Nachtrag (noch) nicht gelaufen ist.
    steps = (existingSteps ?? []).map((s) => ({
      variants: (s.variants as StepVariant[] | null)?.length
        ? (s.variants as StepVariant[])
        : [{ subject: s.subject ?? "", body: s.body ?? "" }],
      delayDays: s.wait_days,
    }));
  }
  if (steps.some((s) => !s.variants?.length || s.variants.some((v) => !v.subject?.trim() || !v.body?.trim()))) {
    return NextResponse.json({ error: "Jede Variante braucht Betreff und Text." }, { status: 400 });
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
        open_tracking: openTracking,
        link_tracking: linkTracking,
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
      open_tracking: openTracking,
      link_tracking: linkTracking,
    })
    .eq("id", local.id);

  await supabase.from("campaign_steps").delete().eq("campaign_id", local.id);
  await supabase.from("campaign_steps").insert(
    steps.map((s, i) => ({
      campaign_id: local.id,
      step_order: i,
      wait_days: s.delayDays ?? 0,
      // subject/body fuehren weiterhin Variante A (Migration 0071): alles,
      // was die Spalten heute schon liest, bekommt damit denselben Text wie
      // bisher, und variants haelt die vollstaendige Wahrheit.
      subject: primaryVariant(s).subject,
      body: primaryVariant(s).body,
      variants: s.variants,
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
