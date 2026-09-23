import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { getBillingStatus } from "@/lib/billing";
import { createInstantlyCampaign } from "@/lib/instantly/create-campaign";
import {
  campaignFormValueFromDraft,
  isCampaignDraft,
  type CampaignDraftSettings,
  type CampaignDraftStep,
} from "@/lib/instantly/campaign-draft";

/**
 * Einen Entwurf in einem Zug bei Instantly anlegen und auf Wunsch starten.
 *
 * Anlass (Youssef, 2026-09-23): sieben Entwuerfe aus dem Claude-Zugang
 * standen in der Liste, und fuer jeden hiess es "Pruefen und anlegen"
 * oeffnen, Postfaecher pruefen, anlegen, dann ins Detail, dann starten. Wenn
 * der Entwurf schon Postfaecher, Sequenz und Sendefenster traegt, ist das
 * Formular nur noch ein Umweg.
 *
 * Genau derselbe Weg wie das Formular: der Entwurf wird mit
 * campaignFormValueFromDraft in dieselbe Form gebracht, die das Formular
 * abschickt, und geht durch createInstantlyCampaign, also durch dieselben
 * Empfaenger-Filter, dieselbe Uebernahme der Entwurfszeile und denselben
 * Bericht. Kein zweiter Anlegepfad.
 *
 * Ohne Postfaecher am Entwurf bricht die Route ab: welche Adressen senden,
 * entscheidet ein Mensch, und create_campaign legt bewusst keine an.
 *
 * `activate` startet die Kampagne danach, wie .../activate/route.ts, in
 * derselben Anfrage. Instantly startet nach dem Anlegen nie von selbst.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const body = (await req.json().catch(() => ({}))) as { activate?: boolean };

  // Workspace-Scoping ausdruecklich ueber eq("workspace_id"): RLS regelt nur,
  // auf welche Accounts jemand zugreifen darf, nicht, welcher der eigenen
  // Workspaces gemeint ist (CLAUDE.md).
  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      "id, name, status, instantly_campaign_id, activated_at, mailboxes, days, send_window_start, send_window_end, timezone, daily_limit, open_tracking, link_tracking"
    )
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!campaign || !isCampaignDraft(campaign)) {
    return NextResponse.json({ error: "Kein Entwurf mit dieser ID in diesem Workspace." }, { status: 404 });
  }

  const [{ data: steps }, { data: links }] = await Promise.all([
    supabase
      .from("campaign_steps")
      .select("wait_days, subject, body, variants")
      .eq("campaign_id", id)
      .order("step_order", { ascending: true }),
    supabase.from("campaign_searches").select("search_id").eq("campaign_id", id),
  ]);

  const value = campaignFormValueFromDraft(
    campaign as unknown as CampaignDraftSettings,
    (steps ?? []) as unknown as CampaignDraftStep[],
    {
      name: "",
      mailboxes: [],
      steps: [],
      days: [1, 2, 3, 4, 5],
      from: "09:00",
      to: "17:00",
      timezone: "Europe/Vienna",
      dailyLimit: "50",
      openTracking: false,
      linkTracking: false,
    }
  );
  const searchIds = (links ?? []).map((l) => l.search_id as string);

  if (value.mailboxes.length === 0) {
    return NextResponse.json({ error: "no_mailboxes" }, { status: 400 });
  }
  if (searchIds.length === 0) {
    return NextResponse.json({ error: "no_lead_list" }, { status: 400 });
  }
  if (value.steps.length === 0) {
    return NextResponse.json({ error: "no_sequence" }, { status: 400 });
  }

  const ergebnis = await createInstantlyCampaign(supabase, ctx.apiKey, await getBillingStatus(supabase), {
    workspaceId: ctx.workspace.id,
    name: value.name,
    searchIds,
    mailboxes: value.mailboxes,
    steps: value.steps,
    days: value.days,
    from: value.from,
    to: value.to,
    timezone: value.timezone,
    dailyLimit: Number(value.dailyLimit) || null,
    openTracking: value.openTracking,
    linkTracking: value.linkTracking,
    draftId: id,
  });

  if (!ergebnis.ok) {
    return NextResponse.json(
      {
        error: ergebnis.error,
        ...(ergebnis.instantlyCampaignId ? { instantly_campaign_id: ergebnis.instantlyCampaignId } : {}),
      },
      { status: ergebnis.status }
    );
  }

  let activated = false;
  let activateError: string | null = null;
  if (body.activate === true && ergebnis.instantlyCampaignId) {
    try {
      await instantlyRequest(ctx.apiKey, `/api/v2/campaigns/${ergebnis.instantlyCampaignId}/activate`, {
        method: "POST",
      });
      await supabase
        .from("campaigns")
        .update({ status: "active", activated_at: new Date().toISOString() })
        .eq("id", ergebnis.campaignId)
        .eq("workspace_id", ctx.workspace.id);
      activated = true;
    } catch (e) {
      // Angelegt, aber nicht gestartet: das ist kein Fehler des Anlegens,
      // und die Kampagne steht jetzt als Draft bei Instantly. Der Nutzer
      // startet sie im Detail; der Grund steht in der Antwort.
      activateError = e instanceof InstantlyApiError ? e.message : (e as Error).message;
    }
  }

  return NextResponse.json({
    ok: true,
    campaign_id: ergebnis.campaignId,
    instantly_campaign_id: ergebnis.instantlyCampaignId,
    leads_added: ergebnis.leadsAdded,
    skipped_unverified: ergebnis.skippedUnverified,
    skipped_without_finding: ergebnis.skippedWithoutFinding,
    skipped_without_person_finding: ergebnis.skippedWithoutPersonFinding,
    skipped_person_finding_review: ergebnis.skippedPersonFindingReview,
    activated,
    activate_error: activateError,
  });
}
