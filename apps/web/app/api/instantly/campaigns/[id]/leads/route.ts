import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInstantlyContext, instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { loadOwnedCampaign } from "@/lib/instantly/campaigns";
import { pickPrimaryContactPerBusiness, splitByEngagement, splitBySendability } from "@/lib/contacts";
import { filterSuppressed } from "@/lib/suppression";

/**
 * Fuegt Kontakte hinzu, die seit dem Erstellen (oder dem letzten Aufruf hier)
 * neu zur verknuepften Suche dazugekommen sind -- relevant bei woechentlichem/
 * taeglichem Lead-Abo einer Suche, wo die urspruengliche Kampagnen-Erstellung
 * nur einen Schnappschuss der Kontakte zu dem Zeitpunkt aufgenommen hat.
 * campaign_leads ist die lokale Quelle fuer "schon hinzugefuegt" (Instantlys
 * eigenes Dedupe-Verhalten bei doppeltem /leads/add ist nicht dokumentiert
 * genug, um sich blind darauf zu verlassen).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM HIER DIESELBEN VIER FILTER STEHEN WIE BEIM ANLEGEN
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis zum 2026-08-09 pruefte dieser Pfad einzig die E-Mail-Verifizierung. Die
 * Kampagnen-Erstellung pruefte vier Dinge. Das Ergebnis: was beim Anlegen
 * ausgeschlossen wurde, kam eine Woche spaeter ueber das Lead-Abo doch noch
 * raus -- Sperrliste, Absagen und alle vier Mitarbeitenden derselben Firma
 * inklusive. Der Nachreiche-Pfad ist der Pfad, der bei einem Abo am
 * haeufigsten laeuft; er war der ungeschuetzteste.
 *
 * Die Reihenfolge ist dieselbe wie in campaigns/route.ts, und die Regeln
 * selbst stehen in lib/contacts.ts -- damit es keine zweite Wahrheit gibt.
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

  const [{ data: contacts }, { data: alreadyAdded }, { data: suppression }] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, email, first_name, last_name, title, business_id, is_primary, outreach_status, email_verification_status, businesses!inner(name, website, personalization, search_id)"
      )
      .eq("workspace_id", ctx.workspace.id)
      .in("businesses.search_id", searchIds)
      .not("email", "is", null)
      .limit(5000),
    supabase.from("campaign_leads").select("contact_id").eq("campaign_id", local.id),
    supabase.from("suppression_list").select("email, domain").eq("workspace_id", ctx.workspace.id),
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

  const all = (contacts ?? []) as unknown as ContactRow[];
  const addedIds = new Set((alreadyAdded ?? []).map((r) => r.contact_id));
  // Firmen, aus denen bereits jemand in dieser Kampagne steckt. Ohne diese
  // Menge wuerde pickPrimaryContactPerBusiness unten "eine Person je Firma"
  // nur innerhalb der NEUEN Kontakte garantieren -- und damit bei einer Firma,
  // deren Chefin schon angeschrieben ist, zusaetzlich den Vertriebsleiter
  // aufnehmen. Fuer die Empfaengerin sieht das aus, als wuerde die Firma
  // durchtelefoniert.
  const coveredBusinesses = new Set(
    all.filter((c) => addedIds.has(c.id) && c.business_id).map((c) => c.business_id as string)
  );

  const fresh = all.filter(
    (c) => !!c.email && !addedIds.has(c.id) && !(c.business_id && coveredBusinesses.has(c.business_id))
  );
  // Wer bereits reagiert hat, bekommt keine Kalt-Mail mehr -- kanalunabhaengig.
  // Das ist die Stelle, an der eine LinkedIn-Antwort den Mailversand stoppt:
  // sie setzt outreach_status auf 'replied', und der faellt hier raus.
  const { contactable, engaged } = splitByEngagement(fresh);
  // Gleiche Regel wie beim Anlegen der Kampagne: ungueltige Adressen duerfen
  // auch beim Nachreichen nicht in den Versand rutschen.
  const { sendable, unsendable } = splitBySendability(
    filterSuppressed(contactable, suppression ?? [])
  );
  const newRows = pickPrimaryContactPerBusiness(sendable);

  if (newRows.length === 0) {
    return NextResponse.json({
      ok: true,
      added: 0,
      skipped_unverified: unsendable.length,
      skipped_engaged: engaged.length,
    });
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

  return NextResponse.json({
    ok: true,
    added: newRows.length,
    skipped_unverified: unsendable.length,
    skipped_engaged: engaged.length,
  });
}

/** Instantlys Lead-Objekt, nur die Felder, die wir hier tatsaechlich lesen. */
type InstantlyLead = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  /** Gesetzt, sobald die erste Mail rausging. Das verlaesslichste "kontaktiert"-Signal. */
  timestamp_last_contact?: string | null;
  email_open_count?: number | null;
  email_click_count?: number | null;
  email_reply_count?: number | null;
  /** Instantlys Zahlencode. Negativ = Bounce/Abmeldung, siehe LEAD_STATUS unten. */
  status?: number | null;
};

/**
 * Instantlys numerischer Lead-Status.
 *
 * Am 2026-08-04 gegen echte Daten geprueft: die interessanten Faelle sind die
 * negativen. Fuer "kontaktiert ja/nein" wird bewusst NICHT dieser Code
 * herangezogen, sondern timestamp_last_contact -- der ist eindeutig, waehrend
 * status auch waehrend einer laufenden Sequenz auf 1 steht.
 */
const LEAD_BOUNCED = -1;
const LEAD_UNSUBSCRIBED = -2;

/** Eine Seite ist bei Instantly auf 100 gedeckelt. */
const PAGE_SIZE = 100;
/**
 * Obergrenze fuer einen Aufruf. Bei 260 Leads sind das drei Seiten; die
 * Deckelung ist die Bremse gegen eine versehentlich riesige Kampagne, nicht
 * gegen den Normalfall. Wird sie erreicht, sagt die Antwort das ausdruecklich
 * -- eine stumm gekuerzte Liste sieht aus wie eine vollstaendige.
 */
const MAX_PAGES = 20;

/**
 * Der Stand je Lead, direkt von Instantly.
 *
 * BEWUSST NICHT aus unseren eigenen Daten. contacts.outreach_status wird nur
 * dann auf "kontaktiert" gesetzt, wenn der Inbox-Sync eine ausgehende Mail
 * gesehen hat -- und der holt nur, was seit seinem Wasserstand entstanden ist.
 * Gemessen am 2026-08-04: Instantly meldet fuer eine Kampagne 45 kontaktierte
 * Leads, unsere Daten kannten 10. Eine Ansicht, die zeigen soll "wer wurde
 * schon angeschrieben", darf nicht auf einer Quelle stehen, die nachweislich
 * untertreibt.
 *
 * Live abgefragt statt zwischengespeichert: die Seite wird gelegentlich
 * geoeffnet, die Zahlen sind dann garantiert aktuell, und es braucht keine
 * weitere Tabelle, die selbst wieder veralten kann.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await requireInstantlyContext(supabase);
  if ("error" in ctx) return ctx.error;

  const local = await loadOwnedCampaign(supabase, ctx.workspace.id, id);
  if (!local || !local.instantly_campaign_id) {
    return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  }

  const leads: InstantlyLead[] = [];
  let startingAfter: string | undefined;
  let truncated = false;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const body: Record<string, unknown> = {
        campaign: local.instantly_campaign_id,
        limit: PAGE_SIZE,
      };
      if (startingAfter) body.starting_after = startingAfter;

      const data = await instantlyRequest<{ items?: InstantlyLead[]; next_starting_after?: string }>(
        ctx.apiKey,
        "/api/v2/leads/list",
        { method: "POST", body: JSON.stringify(body) }
      );
      const items = data.items ?? [];
      leads.push(...items);
      startingAfter = data.next_starting_after;
      if (!startingAfter || items.length === 0) break;
      if (page === MAX_PAGES - 1) truncated = true;
    }
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }

  return NextResponse.json({
    truncated,
    items: leads.map((lead) => ({
      id: lead.id,
      email: lead.email ?? null,
      name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null,
      company: lead.company_name ?? null,
      contacted_at: lead.timestamp_last_contact ?? null,
      opens: lead.email_open_count ?? 0,
      clicks: lead.email_click_count ?? 0,
      replies: lead.email_reply_count ?? 0,
      bounced: lead.status === LEAD_BOUNCED,
      unsubscribed: lead.status === LEAD_UNSUBSCRIBED,
    })),
  });
}
