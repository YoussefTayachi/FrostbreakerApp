import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { campaignStats, type StatsRow } from "@/lib/instantly/campaign-stats";
import { getBillingStatus } from "@/lib/billing";
import { filterSuppressed } from "@/lib/suppression";
import { pickPrimaryContactPerBusiness, splitByEngagement, splitBySendability } from "@/lib/contacts";
import {
  buildCampaignSchedule,
  buildCampaignSequence,
  toLocalStatus,
  primaryVariant,
  type SequenceStep,
  type InstantlyCampaign,
} from "@/lib/instantly/campaigns";
import { isCampaignDraft, planDraftTakeover, type CampaignDraftRow } from "@/lib/instantly/campaign-draft";

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

/** Die Spalten, an denen haengt, ob eine Kampagne noch ein Entwurf ist
 *  (lib/instantly/campaign-draft.ts). */
const DRAFT_COLUMNS = "id, name, status, instantly_campaign_id, activated_at";

/**
 * Legt eine neue Instantly-Kampagne an (als Draft; Instantly startet nichts
 * automatisch, siehe Kommentar bei .../activate/route.ts), speichert einen
 * lokalen Spiegel in public.campaigns/campaign_steps und fuegt alle Kontakte
 * der uebergebenen Suche mit E-Mail-Adresse als Leads hinzu.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;
  const workspaceId = ctx.workspace.id;

  // Gleiche Sperre wie fuer neue Suchen (RLS auf public.searches, Migration
  // 0024), hier zusaetzlich auf App-Ebene, weil das Anlegen einer Kampagne
  // ueber diese API-Route laeuft und nicht per Direkt-Insert vom Client.
  const billing = await getBillingStatus(supabase);
  if (!billing?.isActive) {
    return NextResponse.json(
      { error: "Deine Testphase ist abgelaufen. Bitte waehle einen Plan unter /pricing, um neue Kampagnen anzulegen." },
      { status: 402 }
    );
  }

  const body = (await req.json()) as CreateCampaignBody;
  const { searchIds, name, mailboxes, steps, days, from, to, timezone, dailyLimit } = body;
  // Ausdruecklich mitgeschickt, nicht Instantlys Vorgabe uebernommen: der
  // Zaehlpixel steht dort auf "an" und kostet Zustellbarkeit. Wer ihn will,
  // soll ihn einschalten; wer nichts einstellt, sendet ohne (Migration 0071).
  const openTracking = body.openTracking === true;
  const linkTracking = body.linkTracking === true;

  if (!searchIds?.length || !name?.trim() || !mailboxes?.length || !steps?.length || !days?.length || !from || !to || !timezone) {
    return NextResponse.json({ error: "Pflichtfelder fehlen" }, { status: 400 });
  }
  // Jede Fassung muss vollstaendig sein. Eine halb ausgefuellte Variante
  // wuerde bei Instantly als leere Mail an einen Teil der Empfaenger
  // rausgehen, und zwar an einen zufaellig ausgewaehlten.
  if (steps.some((s) => !s.variants?.length || s.variants.some((v) => !v.subject?.trim() || !v.body?.trim()))) {
    return NextResponse.json({ error: "Jede Variante braucht Betreff und Text." }, { status: 400 });
  }

  const { data: searches } = await supabase
    .from("searches")
    .select("id, name, query, instantly_campaign_id")
    .in("id", searchIds)
    .eq("workspace_id", workspaceId);
  if (!searches || searches.length !== searchIds.length) {
    return NextResponse.json({ error: "Mindestens eine Suche wurde nicht gefunden" }, { status: 404 });
  }
  const alreadyLinked = searches.find((s) => s.instantly_campaign_id);
  if (alreadyLinked) {
    return NextResponse.json(
      { error: `Suche "${alreadyLinked.name ?? alreadyLinked.query}" hat bereits eine verknuepfte Kampagne.` },
      { status: 409 }
    );
  }

  /**
   * ═════════════════════════════════════════════════════════════════════
   * DER ENTWURF, DER HIER FERTIG WIRD
   * ═════════════════════════════════════════════════════════════════════
   *
   * Seit dem MCP-Werkzeug create_campaign (2026-08-22) kann an einer
   * Lead-Liste eine campaigns-Zeile OHNE Instantly-Zwilling haengen. Die
   * Pruefung oben sieht sie nicht: ein Entwurf setzt
   * searches.instantly_campaign_id bewusst nicht.
   *
   * Ohne das Folgende entstuende hier eine ZWEITE Zeile, und die erste bliebe
   * als Karteileiche mit einer Sequenz darin liegen -- anlegen liesse sie sich
   * nie mehr, weil die Suche ab jetzt verknuepft ist (HTTP 409 oben).
   *
   * Deshalb wird die vorhandene Zeile weiterverwendet statt geloescht: die
   * campaign_id, die Claude dem Nutzer genannt hat, bleibt gueltig, und die
   * Protokollzeilen in mcp_write_log (Migration 0101) zeigen weiter auf eine
   * Kampagne, die es gibt.
   */
  const draftId = typeof body.draftId === "string" && body.draftId ? body.draftId : null;
  let requestedDraft: CampaignDraftRow | null = null;
  if (draftId) {
    const { data } = await supabase
      .from("campaigns")
      .select(DRAFT_COLUMNS)
      .eq("id", draftId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) {
      return NextResponse.json(
        { error: "Dieser Entwurf existiert nicht mehr. Lege die Kampagne ohne ihn an." },
        { status: 404 }
      );
    }
    requestedDraft = data as unknown as CampaignDraftRow;
    if (!isCampaignDraft(requestedDraft)) {
      return NextResponse.json(
        {
          error: `"${requestedDraft.name}" ist kein Entwurf mehr, die Kampagne wurde bereits angelegt. Du findest sie unter Instantly > Kampagnen.`,
        },
        { status: 409 }
      );
    }
  }

  // Alles, was ueber campaign_searches an diesen Listen haengt. Die
  // Zwischentabelle traegt keine workspace_id (Migration 0050); der Zaun ist
  // deshalb der Workspace-Filter auf campaigns, nicht die IDs von dort.
  const { data: existingLinks } = await supabase
    .from("campaign_searches")
    .select("campaign_id")
    .in("search_id", searchIds);
  const linkedIds = [...new Set((existingLinks ?? []).map((l) => l.campaign_id as string))];
  let linkedCampaigns: CampaignDraftRow[] = [];
  if (linkedIds.length > 0) {
    const { data } = await supabase
      .from("campaigns")
      .select(DRAFT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("id", linkedIds)
      // Aeltester zuerst: bei zwei Entwuerfen soll immer derselbe gewinnen.
      .order("created_at", { ascending: true });
    linkedCampaigns = (data ?? []) as unknown as CampaignDraftRow[];
  }
  const draftCandidates =
    requestedDraft && !linkedCampaigns.some((c) => c.id === requestedDraft!.id)
      ? [...linkedCampaigns, requestedDraft]
      : linkedCampaigns;
  const draftPlan = planDraftTakeover(draftCandidates, draftId);
  if (draftPlan.blocked) {
    // Dieselbe Auskunft wie oben, nur ueber den anderen Weg gefunden: eine
    // echte Kampagne haengt an dieser Liste, obwohl searches noch nichts davon
    // weiss (etwa weil das Setzen dort einmal fehlgeschlagen ist).
    return NextResponse.json(
      { error: `Diese Lead-Liste speist bereits die Kampagne "${draftPlan.blocked.name}".` },
      { status: 409 }
    );
  }

  const [{ data: contacts }, { data: suppression }, { data: archived }] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, email, first_name, last_name, title, business_id, is_primary, outreach_status, email_verification_status, businesses!inner(name, website, personalization, search_id)"
      )
      .eq("workspace_id", workspaceId)
      .in("businesses.search_id", searchIds)
      .not("email", "is", null)
      .limit(5000),
    supabase.from("suppression_list").select("email, domain").eq("workspace_id", workspaceId),
    // Bereits angeschrieben, Liste inzwischen endgueltig geloescht (Migration
    // 0095). Ohne diese Abfrage koennte dieselbe Adresse ueber eine neu
    // gesuchte Liste ein zweites Mal in eine Kampagne rutschen.
    supabase.from("contact_archive").select("email").eq("workspace_id", workspaceId).not("email", "is", null),
  ]);

  type ContactRow = {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    business_id: string | null;
    is_primary: boolean;
    outreach_status: string;
    email_verification_status: string | null;
    businesses: { name: string | null; website: string | null; personalization: string | null } | null;
  };

  // Sicherheitsnetz gegen versehentliches erneutes Anschreiben: Blockliste
  // (suppression_list) UND Kontakte, die bereits reagiert haben, werden nie in
  // eine neue Kampagne aufgenommen, unabhaengig davon, aus welcher Suche/wann
  // sie urspruenglich gefunden wurden. Vorher wurden hier ausnahmslos alle
  // Kontakte mit E-Mail uebernommen, auch bereits blockierte/abgelehnte.
  const withEmail = ((contacts ?? []) as unknown as ContactRow[]).filter((c) => !!c.email);
  // Bis zum 2026-08-09 stand hier nur 'not_interested'. Wer geantwortet oder
  // einen Termin hatte, landete in jeder neuen Kampagne derselben Suche
  // wieder, inklusive derer, die auf LinkedIn geantwortet hatten. isColdContactable
  // deckt alle vier Faelle ab, siehe lib/contacts.ts.
  const { contactable: notDeclined } = splitByEngagement(withEmail);
  // Das Archiv geht als Sperrliste durch dieselbe Pruefung, bewusst nur mit
  // der Adresse, nicht mit der Domain. Die Domain sperrt der Dublettenschutz
  // im Worker, damit die Firma gar nicht erst erneut gekauft wird; hier waere
  // sie zu grob und wuerde eine bewusst gewaehlte zweite Ansprechpartnerin
  // derselben Firma mit ausschliessen.
  const blocked = [
    ...(suppression ?? []),
    ...((archived ?? []) as { email: string | null }[]).map((a) => ({ email: a.email, domain: null })),
  ];
  // Als ungueltig erkannte Adressen nie versenden: sie bouncen garantiert und
  // beschaedigen die Absender-Reputation der ganzen Domain, nicht nur diese
  // eine Kampagne. Genau dafuer wird vorher verifiziert.
  const { sendable, unsendable } = splitBySendability(filterSuppressed(notDeclined, blocked));
  const contactable = sendable;
  // KI-Recherche und Hunter finden bewusst mehrere moegliche Ansprechpartner
  // pro Firma (siehe lib/contacts.ts), fuer den tatsaechlichen Versand aber
  // nur die ranghoechste Person je Firma, sonst wuerde jede Mitarbeiterin/jeder
  // Mitarbeiter derselben Firma angeschrieben.
  const rows = pickPrimaryContactPerBusiness(contactable);

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          unsendable.length > 0
            ? `Keine versendbaren Leads: alle ${unsendable.length} Adressen sind als ungueltig erkannt, blockiert oder ohne Interesse.`
            : "Keine kontaktierbaren Leads in dieser Suche gefunden (alle bereits blockiert oder ohne Interesse).",
      },
      { status: 400 }
    );
  }
  const leads = rows.map((c) => ({
    email: c.email as string,
    first_name: c.first_name || undefined,
    last_name: c.last_name || undefined,
    company_name: c.businesses?.name || undefined,
    personalization: c.businesses?.personalization || undefined,
  }));

  let instantlyCampaign: InstantlyCampaign;
  try {
    instantlyCampaign = await instantlyRequest<InstantlyCampaign>(ctx.apiKey, "/api/v2/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        campaign_schedule: buildCampaignSchedule({ days, from, to, timezone }),
        sequences: buildCampaignSequence(steps),
        email_list: mailboxes,
        daily_limit: dailyLimit || undefined,
        open_tracking: openTracking,
        link_tracking: linkTracking,
        // Ohne dieses Feld ist laut Instantly-Doku bei per API angelegten
        // Kampagnen nicht garantiert, dass Folge-Schritte ausbleiben, sobald
        // ein Lead geantwortet hat (im UI ist "Stop on reply" default an, bei
        // API-Erstellung nicht zuverlaessig geerbt): explizit gesetzt statt
        // sich auf einen unspezifizierten Default zu verlassen.
        stop_on_reply: true,
      }),
    });

    // Instantly erlaubt max. 1000 Leads pro Aufruf von /leads/add, deshalb in Chargen.
    for (let i = 0; i < leads.length; i += 1000) {
      const chunk = leads.slice(i, i + 1000);
      await instantlyRequest(ctx.apiKey, "/api/v2/leads/add", {
        method: "POST",
        body: JSON.stringify({ campaign_id: instantlyCampaign.id, leads: chunk }),
      });
    }
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  // Lokalen Spiegel anlegen. Fehler hier duerfen die Instantly-Seite nicht
  // rueckgaengig machen (die Kampagne existiert dort bereits echt), daher
  // best-effort mit klarer Fehlermeldung statt Transaktion ueber zwei Systeme.
  const mirror = {
    // Primaere Suche fuer Analytics-Polling (instantly_campaign_stats haengt
    // an genau einer search_id); welche der mehreren Suchen egal, die
    // Kampagnen-Metriken bei Instantly sind ohnehin ueber alle gemeinsam.
    search_id: searchIds[0],
    instantly_campaign_id: instantlyCampaign.id,
    name: name.trim(),
    status: toLocalStatus(instantlyCampaign.status),
    send_window_start: from,
    send_window_end: to,
    timezone,
    mailboxes,
    days,
    daily_limit: dailyLimit || null,
    open_tracking: openTracking,
    link_tracking: linkTracking,
  };

  let localCampaignId: string;
  let mirrorError: string | null = null;
  if (draftPlan.reuse) {
    // Aus dem Entwurf wird die Kampagne: dieselbe Zeile, jetzt mit
    // Instantly-Zwilling. Ab hier ist sie kein Entwurf mehr, und der
    // MCP-Server weist Schreibvorgaenge darauf ab (ladeEntwurf).
    localCampaignId = draftPlan.reuse.id;
    const { error } = await supabase
      .from("campaigns")
      .update(mirror)
      .eq("id", localCampaignId)
      // Beide Bedingungen: die id allein kaeme aus dem Request.
      .eq("workspace_id", workspaceId);
    mirrorError = error?.message ?? null;
    // Verknuepfungen und Schritte werden unten neu geschrieben; im Formular
    // kann inzwischen eine andere Liste angehakt und die Sequenz umgeschrieben
    // worden sein. Was der Entwurf mitbrachte, ist damit erledigt.
    if (!mirrorError) {
      await supabase.from("campaign_searches").delete().eq("campaign_id", localCampaignId);
      await supabase.from("campaign_steps").delete().eq("campaign_id", localCampaignId);
    }
  } else {
    const { data: localCampaign, error } = await supabase
      .from("campaigns")
      .insert({ workspace_id: workspaceId, ...mirror })
      .select("id")
      .single();
    mirrorError = error?.message ?? (localCampaign ? null : "unbekannter Fehler");
    localCampaignId = localCampaign?.id ?? "";
  }

  if (mirrorError) {
    return NextResponse.json(
      {
        error: "Kampagne wurde bei Instantly angelegt, konnte aber nicht lokal gespeichert werden: " + mirrorError,
        instantly_campaign_id: instantlyCampaign.id,
      },
      { status: 500 }
    );
  }

  await supabase.from("campaign_steps").insert(
    steps.map((s, i) => ({
      campaign_id: localCampaignId,
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

  await supabase.from("campaign_leads").upsert(
    rows.map((c) => ({ campaign_id: localCampaignId, contact_id: c.id })),
    { onConflict: "campaign_id,contact_id", ignoreDuplicates: true }
  );

  await supabase.from("campaign_searches").insert(
    searchIds.map((id) => ({ campaign_id: localCampaignId, search_id: id }))
  );

  // searches.instantly_campaign_id bleibt die Quelle, die der Sync-Cron
  // (api/cron/instantly-sync) fuer Analytics-Polling und Reply-Verarbeitung
  // liest; jetzt fuer ALLE verknuepften Suchen gesetzt, nicht nur die erste,
  // damit jede von ihnen im UI korrekt als "verknuepft" erscheint.
  await supabase.from("searches").update({ instantly_campaign_id: instantlyCampaign.id }).in("id", searchIds).eq("workspace_id", workspaceId);

  // Weitere Entwuerfe derselben Listen wegraeumen. Sie koennten ab jetzt nie
  // mehr eine Kampagne werden (die Suchen sind verknuepft) und wuerden in der
  // Kampagnenliste als Zeile stehen bleiben, die nichts mehr tun kann.
  // "delete" laeuft auf campaigns und nimmt campaign_steps/campaign_searches
  // per on delete cascade mit (Migration 0001/0050).
  if (draftPlan.obsolete.length > 0) {
    await supabase
      .from("campaigns")
      .delete()
      .in("id", draftPlan.obsolete.map((d) => d.id))
      .eq("workspace_id", workspaceId);
  }

  return NextResponse.json({
    ok: true,
    campaign_id: localCampaignId,
    // Damit das Formular weiss, dass sein Entwurf aufgegangen ist -- und der
    // Bericht in der Konsole/im Support nachvollziehbar bleibt.
    from_draft: draftPlan.reuse?.id ?? null,
    discarded_drafts: draftPlan.obsolete.length,
    instantly_campaign_id: instantlyCampaign.id,
    // Aussortierte ungueltige Adressen mitgeben statt sie stillschweigend zu
    // schlucken: der Nutzer soll sehen, dass die Verifizierung gewirkt hat.
    skipped_unverified: unsendable.length,
    leads_added: leads.length,
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
