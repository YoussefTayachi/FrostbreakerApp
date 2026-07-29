import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { getBillingStatus } from "@/lib/billing";
import { filterSuppressed } from "@/lib/suppression";
import { pickPrimaryContactPerBusiness } from "@/lib/contacts";
import {
  buildCampaignSchedule,
  buildCampaignSequence,
  toLocalStatus,
  type SequenceStep,
  type InstantlyCampaign,
} from "@/lib/instantly/campaigns";

type CreateCampaignBody = {
  searchId: string;
  name: string;
  mailboxes: string[];
  steps: SequenceStep[];
  days: number[]; // 0=Sonntag..6=Samstag
  from: string; // "09:00"
  to: string; // "17:00"
  timezone: string; // z.B. "Europe/Vienna"
  dailyLimit?: number;
};

/**
 * Legt eine neue Instantly-Kampagne an (als Draft -- Instantly startet nichts
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
  // 0024) -- hier zusaetzlich auf App-Ebene, weil das Anlegen einer Kampagne
  // ueber diese API-Route laeuft und nicht per Direkt-Insert vom Client.
  const billing = await getBillingStatus(supabase);
  if (!billing?.isActive) {
    return NextResponse.json(
      { error: "Deine Testphase ist abgelaufen. Bitte waehle einen Plan unter /pricing, um neue Kampagnen anzulegen." },
      { status: 402 }
    );
  }

  const body = (await req.json()) as CreateCampaignBody;
  const { searchId, name, mailboxes, steps, days, from, to, timezone, dailyLimit } = body;

  if (!searchId || !name?.trim() || !mailboxes?.length || !steps?.length || !days?.length || !from || !to || !timezone) {
    return NextResponse.json({ error: "Pflichtfelder fehlen" }, { status: 400 });
  }
  if (steps.some((s) => !s.subject?.trim() || !s.body?.trim())) {
    return NextResponse.json({ error: "Jeder Schritt braucht Betreff und Text." }, { status: 400 });
  }

  const { data: search } = await supabase
    .from("searches")
    .select("id, name, query, instantly_campaign_id")
    .eq("id", searchId)
    .eq("workspace_id", workspaceId)
    .single();
  if (!search) return NextResponse.json({ error: "Suche nicht gefunden" }, { status: 404 });
  if (search.instantly_campaign_id) {
    return NextResponse.json(
      { error: "Diese Suche hat bereits eine verknuepfte Kampagne." },
      { status: 409 }
    );
  }

  const [{ data: contacts }, { data: suppression }] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, email, first_name, last_name, title, business_id, outreach_status, businesses!inner(name, website, personalization, search_id)"
      )
      .eq("workspace_id", workspaceId)
      .eq("businesses.search_id", searchId)
      .not("email", "is", null)
      .limit(5000),
    supabase.from("suppression_list").select("email, domain").eq("workspace_id", workspaceId),
  ]);

  type ContactRow = {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    business_id: string | null;
    outreach_status: string;
    businesses: { name: string | null; website: string | null; personalization: string | null } | null;
  };

  // Sicherheitsnetz gegen versehentliches erneutes Anschreiben: Blockliste
  // (suppression_list) UND Kontakte, die per KI-Klassifizierung schon explizit
  // "kein Interesse" geantwortet haben, werden nie in eine neue Kampagne
  // aufgenommen -- unabhaengig davon, aus welcher Suche/wann sie urspruenglich
  // gefunden wurden. Vorher wurden hier ausnahmslos alle Kontakte mit E-Mail
  // uebernommen, auch bereits blockierte/abgelehnte.
  const withEmail = ((contacts ?? []) as unknown as ContactRow[]).filter((c) => !!c.email);
  const notDeclined = withEmail.filter((c) => c.outreach_status !== "not_interested");
  const contactable = filterSuppressed(notDeclined, suppression ?? []);
  // KI-Recherche und Hunter finden bewusst mehrere moegliche Ansprechpartner
  // pro Firma (siehe lib/contacts.ts) -- fuer den tatsaechlichen Versand aber
  // nur die ranghoechste Person je Firma, sonst wuerde jede Mitarbeiterin/jeder
  // Mitarbeiter derselben Firma angeschrieben.
  const rows = pickPrimaryContactPerBusiness(contactable);

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Keine kontaktierbaren Leads in dieser Suche gefunden (alle bereits blockiert oder ohne Interesse)." },
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
        // Ohne dieses Feld ist laut Instantly-Doku bei per API angelegten
        // Kampagnen nicht garantiert, dass Folge-Schritte ausbleiben, sobald
        // ein Lead geantwortet hat (im UI ist "Stop on reply" default an, bei
        // API-Erstellung nicht zuverlaessig geerbt) -- explizit gesetzt statt
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

  // Lokalen Spiegel anlegen -- Fehler hier duerfen die Instantly-Seite nicht
  // rueckgaengig machen (die Kampagne existiert dort bereits echt), daher
  // best-effort mit klarer Fehlermeldung statt Transaktion ueber zwei Systeme.
  const { data: localCampaign, error: campaignInsertError } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: workspaceId,
      search_id: searchId,
      instantly_campaign_id: instantlyCampaign.id,
      name: name.trim(),
      status: toLocalStatus(instantlyCampaign.status),
      send_window_start: from,
      send_window_end: to,
      timezone,
      mailboxes,
      days,
      daily_limit: dailyLimit || null,
    })
    .select("id")
    .single();

  if (campaignInsertError || !localCampaign) {
    return NextResponse.json(
      {
        error:
          "Kampagne wurde bei Instantly angelegt, konnte aber nicht lokal gespeichert werden: " +
          (campaignInsertError?.message ?? "unbekannter Fehler"),
        instantly_campaign_id: instantlyCampaign.id,
      },
      { status: 500 }
    );
  }

  await supabase.from("campaign_steps").insert(
    steps.map((s, i) => ({
      campaign_id: localCampaign.id,
      step_order: i,
      wait_days: s.delayDays ?? 0,
      subject: s.subject,
      body: s.body,
    }))
  );

  await supabase.from("campaign_leads").upsert(
    rows.map((c) => ({ campaign_id: localCampaign.id, contact_id: c.id })),
    { onConflict: "campaign_id,contact_id", ignoreDuplicates: true }
  );

  // searches.instantly_campaign_id bleibt die Quelle, die der Worker (poll_instantly.py)
  // fuer Analytics-Polling und Reply-Verarbeitung liest -- unveraendert.
  await supabase.from("searches").update({ instantly_campaign_id: instantlyCampaign.id }).eq("id", searchId).eq("workspace_id", workspaceId);

  return NextResponse.json({
    ok: true,
    campaign_id: localCampaign.id,
    instantly_campaign_id: instantlyCampaign.id,
    leads_added: leads.length,
  });
}

/**
 * Liste aller Kampagnen dieses Workspaces fuer /instantly/campaigns. Status
 * wird live bei Instantly nachgeladen (kleine, ueberschaubare Anzahl an
 * Kampagnen pro Kunde -- Genauigkeit ist hier wichtiger als ein Request
 * einzusparen, z.B. wenn jemand direkt in Instantly pausiert hat).
 */
export async function GET() {
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, instantly_campaign_id, search_id, mailboxes, daily_limit, created_at, activated_at, searches(name, query, location)")
    .eq("workspace_id", ctx.workspace.id)
    .not("instantly_campaign_id", "is", null)
    .order("created_at", { ascending: false });

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
        return c; // Instantly kurz nicht erreichbar -- lieber den letzten bekannten Stand zeigen als die ganze Liste kippen
      }
    })
  );

  const { data: stats } = await supabase
    .from("instantly_campaign_stats")
    .select("search_id, leads_count, emails_sent_count, open_count, reply_count_unique, bounced_count")
    .eq("workspace_id", ctx.workspace.id);
  const statsBySearch = new Map((stats ?? []).map((s) => [s.search_id, s]));

  return NextResponse.json({
    items: withLiveStatus.map((c) => ({ ...c, stats: statsBySearch.get(c.search_id ?? "") ?? null })),
  });
}
