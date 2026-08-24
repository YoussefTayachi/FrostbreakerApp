import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest } from "@/lib/instantly";
import { campaignStats, type StatsRow } from "@/lib/instantly/campaign-stats";
import { getBillingStatus } from "@/lib/billing";
import { createInstantlyCampaign } from "@/lib/instantly/create-campaign";
import { toLocalStatus, type SequenceStep, type InstantlyCampaign } from "@/lib/instantly/campaigns";

type CreateCampaignBody = {
  searchIds: string[];
  name: string;
  mailboxes: string[];
  steps: SequenceStep[];
  openTracking?: boolean;
  linkTracking?: boolean;
  days: number[]; // 0=Sonntag..6=Samstag
  from: string; // "09:00"
  to: string; // "17:00"
  timezone: string; // z.B. "Europe/Vienna"
  dailyLimit?: number;
  /** Der Entwurf, der hier fertig wird: eine campaigns-Zeile ohne
   *  Instantly-Zwilling, angelegt ueber den MCP-Server (create_campaign).
   *  Das Formular schickt ihn mit, wenn es ueber ?draft= geoeffnet wurde. */
  draftId?: string;
};

/**
 * Legt eine neue Instantly-Kampagne an (als Draft; Instantly startet nichts
 * automatisch, siehe Kommentar bei .../activate/route.ts), speichert einen
 * lokalen Spiegel in public.campaigns/campaign_steps und fuegt alle Kontakte
 * der uebergebenen Suche mit E-Mail-Adresse als Leads hinzu.
 *
 * Der Ablauf selbst steht in lib/instantly/create-campaign.ts: seit dem
 * MCP-Werkzeug publish_campaign (2026-08-22) gehen ihn zwei Wege, und die
 * vier Empfaenger-Filter darin sind die CAN-SPAM-Zusage. Hier bleibt nur, was
 * an dieser Route haengt: Sitzung, Workspace, Instantly-Schluessel, Abo-Status
 * und die Uebersetzung des Ergebnisses in HTTP.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const body = (await req.json()) as CreateCampaignBody;

  const ergebnis = await createInstantlyCampaign(
    supabase,
    ctx.apiKey,
    // Ueber die Sitzung, denn hier gibt es eine. Der MCP-Server reicht an
    // derselben Stelle getBillingStatusForUser(supabase, user_id aus dem
    // Token) herein -- auth.getUser() waere dort null und die Schranke damit
    // wirkungslos.
    await getBillingStatus(supabase),
    {
      workspaceId: ctx.workspace.id,
      name: body.name ?? "",
      searchIds: body.searchIds ?? [],
      mailboxes: body.mailboxes ?? [],
      steps: body.steps ?? [],
      days: body.days ?? [],
      from: body.from,
      to: body.to,
      timezone: body.timezone,
      dailyLimit: body.dailyLimit || null,
      // Ausdruecklich mitgeschickt, nicht Instantlys Vorgabe uebernommen: der
      // Zaehlpixel steht dort auf "an" und kostet Zustellbarkeit. Wer ihn
      // will, soll ihn einschalten; wer nichts einstellt, sendet ohne
      // (Migration 0071).
      openTracking: body.openTracking === true,
      linkTracking: body.linkTracking === true,
      draftId: body.draftId ?? null,
    }
  );

  if (!ergebnis.ok) {
    return NextResponse.json(
      {
        error: ergebnis.error,
        ...(ergebnis.instantlyCampaignId ? { instantly_campaign_id: ergebnis.instantlyCampaignId } : {}),
      },
      { status: ergebnis.status }
    );
  }

  return NextResponse.json({
    ok: true,
    campaign_id: ergebnis.campaignId,
    // Damit das Formular weiss, dass sein Entwurf aufgegangen ist -- und der
    // Bericht in der Konsole/im Support nachvollziehbar bleibt.
    from_draft: ergebnis.fromDraft,
    discarded_drafts: ergebnis.discardedDrafts,
    instantly_campaign_id: ergebnis.instantlyCampaignId,
    // Aussortierte ungueltige Adressen mitgeben statt sie stillschweigend zu
    // schlucken: der Nutzer soll sehen, dass die Verifizierung gewirkt hat.
    skipped_unverified: ergebnis.skippedUnverified,
    // Aus demselben Grund: benutzt die Sequenz {{websiteFinding}}, bleiben
    // Leads ohne Befund zurueck, und die Zahl gehoert in den Bericht statt in
    // eine Differenz, die niemand nachrechnet.
    skipped_without_finding: ergebnis.skippedWithoutFinding,
    leads_added: ergebnis.leadsAdded,
  });
}

/**
 * Liste aller Kampagnen dieses Workspaces fuer /instantly/campaigns. Status
 * wird live bei Instantly nachgeladen (kleine, ueberschaubare Anzahl an
 * Kampagnen pro Kunde; Genauigkeit ist hier wichtiger als ein Request
 * einzusparen, z.B. wenn jemand direkt in Instantly pausiert hat).
 */
export async function GET() {
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  // searches!campaigns_search_id_fkey statt nur searches: seit
  // campaign_searches (Migration 0050) gibt es ZWEI Wege von campaigns zu
  // searches: die Spalte search_id und die neue Zwischentabelle. PostgREST
  // kann den Einbettungspfad dann nicht mehr waehlen und antwortet mit
  // HTTP 300 ("Multiple Choices"), die Abfrage liefert also gar nichts.
  //
  // Sichtbar wurde das als leere Kampagnenliste bei drei aktiven Kampagnen:
  // der Fehler blieb unbemerkt, weil hier nur data ausgelesen und error
  // verworfen wurde: aus dem Abbruch wurde stillschweigend ein "[]".
  // Deshalb wird der Fehler jetzt gemeldet statt als "keine Kampagnen"
  // ausgegeben: eine leere Liste und eine kaputte Abfrage sehen im Frontend
  // sonst identisch aus.
  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .select(
      "id, name, status, instantly_campaign_id, search_id, mailboxes, daily_limit, created_at, activated_at, searches!campaigns_search_id_fkey(name, query, location)"
    )
    .eq("workspace_id", ctx.workspace.id)
    // MIT den Entwuerfen, die es nur bei uns gibt (MCP-Werkzeug
    // create_campaign). Diese Liste ist der einzige Ort, an dem der Nutzer sie
    // ueberhaupt zu sehen bekommt: ohne sie waere ein in Claude vorbereiteter
    // Entwurf in der App unauffindbar und damit wertlos.
    .order("created_at", { ascending: false });

  if (campaignsError) {
    return NextResponse.json(
      { error: "Kampagnen konnten nicht geladen werden: " + campaignsError.message },
      { status: 500 }
    );
  }

  const rows = campaigns ?? [];

  const withLiveStatus = await Promise.all(
    rows.map(async (c) => {
      if (!c.instantly_campaign_id) return c;
      try {
        const live = await instantlyRequest<InstantlyCampaign>(ctx.apiKey, `/api/v2/campaigns/${c.instantly_campaign_id}`);
        const liveStatus = toLocalStatus(live.status);
        if (liveStatus !== c.status) {
          await supabase.from("campaigns").update({ status: liveStatus }).eq("id", c.id);
        }
        return { ...c, status: liveStatus };
      } catch {
        return c; // Instantly kurz nicht erreichbar, lieber den letzten bekannten Stand zeigen als die ganze Liste kippen
      }
    })
  );

  const [{ data: stats }, { data: links }] = await Promise.all([
    supabase
      .from("instantly_campaign_stats")
      .select(
        "search_id, updated_at, leads_count, contacted_count, emails_sent_count, open_count, reply_count_unique, bounced_count"
      )
      .eq("workspace_id", ctx.workspace.id),
    // Seit Migration 0050 kann eine Kampagne aus MEHREREN Suchen gespeist
    // werden, und jede davon bekommt eine eigene Zeile in
    // instantly_campaign_stats. Welche davon gilt, entscheidet statsFor.
    supabase.from("campaign_searches").select("campaign_id, search_id"),
  ]);

  const statsBySearch = new Map((stats ?? []).map((s) => [s.search_id as string, s]));
  const searchesByCampaign = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = searchesByCampaign.get(link.campaign_id as string) ?? [];
    list.push(link.search_id as string);
    searchesByCampaign.set(link.campaign_id as string, list);
  }

  /**
   * Die Kennzahlen einer Kampagne.
   *
   * Wieso EINE Zeile und nicht die Summe ueber alle verknuepften Suchen,
   * steht mitsamt dem Zahlenbeispiel in lib/instantly/campaign-stats.ts.
   * Kurz: die Tabelle ist nach search_id geschluesselt, ihr Inhalt ist
   * kampagnenweit; wer aufaddiert, multipliziert.
   *
   * Faellt auf campaigns.search_id zurueck, wenn campaign_searches leer ist:
   * Kampagnen von vor Migration 0050 stehen dort nicht drin und haetten
   * sonst gar keine Zahlen.
   */
  function statsFor(campaignId: string, primarySearchId: string | null) {
    const searchIds = searchesByCampaign.get(campaignId) ?? (primarySearchId ? [primarySearchId] : []);
    const rows = searchIds.map((id) => statsBySearch.get(id)).filter(Boolean) as StatsRow[];
    return campaignStats(rows);
  }

  const items = withLiveStatus.map((c) => {
    const istEntwurf = !c.instantly_campaign_id;
    return {
      ...c,
      is_draft: istEntwurf,
      // Ein Entwurf hat nie etwas versendet. Zahlen, die aus einer frueher
      // geloeschten Kampagne derselben Liste stehengeblieben sind, waeren
      // neben ihm gelesen als seine eigenen -- also gar keine.
      stats: istEntwurf ? null : statsFor(c.id, c.search_id ?? null),
    };
  });

  return NextResponse.json({
    // Entwuerfe nach oben: sie sind das Einzige in dieser Liste, das auf eine
    // Handlung wartet, und der Rest ist nach Datum sortiert.
    items: [...items.filter((i) => i.is_draft), ...items.filter((i) => !i.is_draft)],
  });
}
