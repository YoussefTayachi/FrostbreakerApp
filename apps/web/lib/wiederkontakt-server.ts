/**
 * Wiederkontakt, der Teil mit Datenbank: Wartende laden, eine Woche als
 * eigene Liste plus Entwurf anlegen, Kontakte aus Instantlys Historie
 * nachtragen. Aufgerufen von app/api/wiederkontakt (mit Sitzung) und vom
 * Wochen-Cron app/api/cron/wiederkontakt (Service-Role); beide reichen ihren
 * Supabase-Client herein, damit hier keine zweite Wahrheit entsteht.
 *
 * Workspace-Scoping ausdruecklich ueber eq("workspace_id"): RLS regelt nur,
 * auf welche Accounts jemand zugreifen darf (CLAUDE.md).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReturnDate, toIsoDate } from "./crm/ooo-date";
import { bucketName, groupByWeek, reengageSteps, senderOfMailbox, type Sender, type WaitingContact } from "./wiederkontakt";

export type WaitingRow = WaitingContact & {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  business_id: string;
  business_name: string | null;
  campaign_name: string | null;
};

/**
 * Alle Kontakte, die auf Abwesenheit stehen und noch nie eine
 * Wiederkontakt-Kopie bekommen haben, samt dem Postfach der letzten Mail.
 */
export async function loadWaiting(supabase: SupabaseClient, workspaceId: string): Promise<WaitingRow[]> {
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, email, business_id, ooo_until, ooo_estimated, businesses(name)")
    .eq("workspace_id", workspaceId)
    .eq("outreach_status", "out_of_office")
    .not("ooo_until", "is", null)
    .is("reengaged_at", null)
    .order("ooo_until", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  const rows = (contacts ?? []) as unknown as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    business_id: string;
    ooo_until: string;
    ooo_estimated: boolean;
    businesses: { name: string | null } | { name: string | null }[] | null;
  }[];
  if (rows.length === 0) return [];

  // Das Postfach der letzten Mail je Kontakt, dazu der Kampagnenname.
  const ids = rows.map((r) => r.id);
  const { data: msgs } = await supabase
    .from("messages")
    .select("contact_id, eaccount, created_at, campaign_id")
    .eq("workspace_id", workspaceId)
    .in("contact_id", ids)
    .order("created_at", { ascending: false })
    .limit(5000);
  const eaccountOf = new Map<string, { eaccount: string | null; campaign_id: string | null }>();
  for (const m of (msgs ?? []) as { contact_id: string; eaccount: string | null; campaign_id: string | null }[]) {
    if (!eaccountOf.has(m.contact_id)) eaccountOf.set(m.contact_id, { eaccount: m.eaccount, campaign_id: m.campaign_id });
  }
  const campaignIds = [...new Set([...eaccountOf.values()].map((v) => v.campaign_id).filter(Boolean))] as string[];
  const nameOf = new Map<string, string>();
  if (campaignIds.length) {
    const { data: camps } = await supabase.from("campaigns").select("id, name").in("id", campaignIds);
    for (const c of (camps ?? []) as { id: string; name: string }[]) nameOf.set(c.id, c.name);
  }
  return rows.map((r) => {
    const b = Array.isArray(r.businesses) ? r.businesses[0] : r.businesses;
    const m = eaccountOf.get(r.id);
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      business_id: r.business_id,
      business_name: b?.name ?? null,
      ooo_until: r.ooo_until,
      ooo_estimated: r.ooo_estimated,
      eaccount: m?.eaccount ?? null,
      campaign_name: m?.campaign_id ? (nameOf.get(m.campaign_id) ?? null) : null,
    };
  });
}

/** Die Postfaecher des Absenders: aus der juengsten Kampagne dieses Absenders im Workspace. */
async function mailboxesFor(supabase: SupabaseClient, workspaceId: string, sender: Sender): Promise<string[]> {
  const { data } = await supabase
    .from("campaigns")
    .select("mailboxes, name, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  const wanted = sender === "berat" ? /\|\s*Berat\b/ : /\|\s*Ramy\b/;
  for (const c of (data ?? []) as { mailboxes: string[] | null; name: string }[]) {
    if (wanted.test(c.name) && c.mailboxes?.length) return c.mailboxes;
  }
  return [];
}

/** Spalten, die von der Firma in die Kopie wandern. */
const BUSINESS_COPY = "name, website, address, phone_national, phone_international, company_summary, personalization, website_finding";
/** Spalten, die vom Kontakt in die Kopie wandern. */
const CONTACT_COPY =
  "source, email_type, email, first_name, last_name, full_name, title, seniority, department, linkedin, custom, person_finding, person_snippets, person_finding_source, person_finding_status";

export type BucketResult = { search_id: string; campaign_id: string; name: string; copied: number; existed: boolean };

/**
 * Eine Woche als eigene Lead-Liste plus Kampagnenentwurf.
 *
 * Kopieren statt umhaengen: Kampagnen haengen an Listen, eine Liste kann nur
 * einmal bei Instantly angelegt werden (HTTP 409), und die Originalzeile
 * soll ihre Geschichte behalten. Idempotent ueber den Namen: ein zweiter
 * Aufruf fuer dieselbe Woche und denselben Absender legt nichts Neues an.
 */
export async function createBucket(
  supabase: SupabaseClient,
  workspaceId: string,
  week: string,
  sender: Sender,
  contactIds: string[]
): Promise<BucketResult> {
  const name = bucketName(week, sender);
  const { data: vorhanden } = await supabase
    .from("searches")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", name)
    .is("deleted_at", null)
    .limit(1);
  if (vorhanden?.[0]) {
    const { data: camp } = await supabase.from("campaigns").select("id").eq("search_id", vorhanden[0].id).limit(1);
    return { search_id: vorhanden[0].id, campaign_id: camp?.[0]?.id ?? "", name, copied: 0, existed: true };
  }

  const { data: search, error: sErr } = await supabase
    .from("searches")
    .insert({
      workspace_id: workspaceId,
      name,
      source: "reengage",
      query: `wiederkontakt · ${week} · ${sender}`,
      location: "United States",
      max_results: contactIds.length,
      target_email_count: contactIds.length,
      schedule: "none",
      status: "completed",
      filters: { reengage: true, week, sender, skip_personalize: true },
    })
    .select("id")
    .single();
  if (sErr || !search) throw new Error(sErr?.message ?? "Liste nicht angelegt");

  let copied = 0;
  for (const contactId of contactIds) {
    const { data: original } = await supabase
      .from("contacts")
      .select(`id, business_id, ${CONTACT_COPY}, businesses(${BUSINESS_COPY})`)
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!original) continue;
    const o = original as unknown as Record<string, unknown> & { businesses: Record<string, unknown> | Record<string, unknown>[] | null };
    const b = (Array.isArray(o.businesses) ? o.businesses[0] : o.businesses) ?? {};
    const { data: biz, error: bErr } = await supabase
      .from("businesses")
      .insert({ ...b, workspace_id: workspaceId, search_id: search.id })
      .select("id")
      .single();
    if (bErr || !biz) continue;
    const kontakt: Record<string, unknown> = {};
    for (const col of CONTACT_COPY.split(",").map((s) => s.trim())) kontakt[col] = o[col] ?? null;
    const { error: cErr } = await supabase.from("contacts").insert({
      ...kontakt,
      workspace_id: workspaceId,
      business_id: biz.id,
      is_primary: true,
      outreach_status: "new",
      person_finding_needs_review: false,
      reengaged_from_contact_id: contactId,
    });
    if (cErr) {
      console.error("wiederkontakt: Kopie", contactId, cErr.message);
      continue;
    }
    await supabase.from("contacts").update({ reengaged_at: new Date().toISOString() }).eq("id", contactId);
    copied++;
  }

  const mailboxes = await mailboxesFor(supabase, workspaceId, sender);
  const { data: campaign, error: kErr } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: workspaceId,
      name,
      status: "draft",
      search_id: search.id,
      mailboxes,
      days: [1, 2, 3, 4, 5],
      send_window_start: "08:00",
      send_window_end: "17:00",
      timezone: "America/Detroit",
      daily_limit: 300,
      open_tracking: false,
      link_tracking: false,
    })
    .select("id")
    .single();
  if (kErr || !campaign) throw new Error(kErr?.message ?? "Entwurf nicht angelegt");
  await supabase.from("campaign_searches").insert({ campaign_id: campaign.id, search_id: search.id });
  await supabase.from("campaign_steps").insert(
    reengageSteps(sender).map((s) => ({
      campaign_id: campaign.id,
      step_order: s.step_order,
      wait_days: s.wait_days,
      subject: s.subject,
      body: s.body,
      variants: [{ subject: s.subject, body: s.body }, ...s.variants],
    }))
  );
  return { search_id: search.id, campaign_id: campaign.id, name, copied, existed: false };
}

/** Die Gruppen der laufenden Woche anlegen (Cron, jeden Montag). */
export async function createCurrentWeek(supabase: SupabaseClient, workspaceId: string, today: Date): Promise<BucketResult[]> {
  const waiting = await loadWaiting(supabase, workspaceId);
  const buckets = groupByWeek(waiting, today);
  const current = buckets.length ? buckets[0].week : null;
  const out: BucketResult[] = [];
  for (const b of buckets) {
    if (b.week !== current) continue;
    out.push(await createBucket(supabase, workspaceId, b.week, b.sender, b.contacts.map((c) => c.id)));
  }
  return out;
}

/**
 * Ein Kontakt fuer eine Abwesenheitsnotiz, die zu keinem Kontakt gehoert:
 * Leads aus Instantlys aelteren Kampagnen, die in Frostbreaker nie
 * angelegt wurden (161 von 165 im retaiyn-Workspace am 2026-09-25). Liste
 * "Instantly-Historie", eine Firma je Domain, Vorname aus der Adresse, wenn
 * sie einen hergibt, sonst "there" (die Copy sagt "Hey there,").
 */
export async function ensureHistoryContact(
  supabase: SupabaseClient,
  workspaceId: string,
  email: string
): Promise<{ id: string; outreach_status: string } | null> {
  const adresse = email.trim().toLowerCase();
  const domain = adresse.split("@")[1];
  if (!domain) return null;
  const { data: bestehend } = await supabase
    .from("contacts")
    .select("id, outreach_status")
    .eq("workspace_id", workspaceId)
    .ilike("email", adresse)
    .limit(1);
  if (bestehend?.[0]) return bestehend[0];

  const listName = "Instantly-Historie";
  let { data: liste } = await supabase
    .from("searches")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("source", "instantly_history")
    .is("deleted_at", null)
    .limit(1);
  if (!liste?.[0]) {
    const { data: neu } = await supabase
      .from("searches")
      .insert({
        workspace_id: workspaceId,
        name: listName,
        source: "instantly_history",
        query: "instantly history",
        location: "",
        max_results: 0,
        schedule: "none",
        status: "completed",
        filters: { skip_personalize: true },
      })
      .select("id");
    liste = neu;
  }
  const searchId = liste?.[0]?.id;
  if (!searchId) return null;

  let { data: firma } = await supabase
    .from("businesses")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("search_id", searchId)
    .ilike("website", `%${domain}%`)
    .limit(1);
  if (!firma?.[0]) {
    const { data: neu } = await supabase
      .from("businesses")
      .insert({ workspace_id: workspaceId, search_id: searchId, name: domain, website: `https://${domain}` })
      .select("id");
    firma = neu;
  }
  const businessId = firma?.[0]?.id;
  if (!businessId) return null;

  const local = adresse.split("@")[0];
  const teil = local.split(/[._-]/)[0];
  const vorname = /^[a-z]{3,}$/.test(teil) && !/^(info|hello|hi|team|office|contact|support|sales|admin|mail)$/.test(teil)
    ? teil[0].toUpperCase() + teil.slice(1)
    : "there";
  const { data: kontakt, error: kErr } = await supabase
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      business_id: businessId,
      email: adresse,
      first_name: vorname,
      full_name: vorname,
      is_primary: true,
      // contacts.source kennt nur hunter, ai_websearch, apollo, manual und
      // prospeo (CHECK); ohne Wert scheiterte am 2026-09-25 jede dieser 149
      // Zeilen stumm am NOT NULL.
      source: "manual",
      outreach_status: "contacted",
    })
    .select("id, outreach_status")
    .single();
  if (kErr) console.error("wiederkontakt: Historie-Kontakt", adresse, kErr.message);
  return kontakt ?? null;
}

/**
 * Rueckwirkend: alle Abwesenheitsantworten im Workspace einmal durch die
 * Datumserkennung, Kontakte anlegen, wo keine sind. Laeuft einmal nach
 * Migration 0123 und bei Bedarf wieder; idempotent.
 */
export async function backfillOutOfOffice(supabase: SupabaseClient, workspaceId: string): Promise<{ messages: number; contacts: number; created: number }> {
  const { data: msgs } = await supabase
    .from("messages")
    .select("id, contact_id, from_email, subject, body, sent_at, created_at")
    .eq("workspace_id", workspaceId)
    .eq("direction", "inbound")
    .eq("ai_interest", "out_of_office")
    .order("created_at", { ascending: true })
    .limit(5000);
  let contacts = 0;
  let created = 0;
  const gesehen = new Set<string>();
  for (const m of (msgs ?? []) as { id: string; contact_id: string | null; from_email: string | null; subject: string | null; body: string | null; sent_at: string | null; created_at: string }[]) {
    let contact: { id: string; outreach_status: string } | null = null;
    if (m.contact_id) {
      const { data } = await supabase.from("contacts").select("id, outreach_status").eq("id", m.contact_id).maybeSingle();
      contact = data ?? null;
    } else if (m.from_email) {
      const vorher = await supabase.from("contacts").select("id").eq("workspace_id", workspaceId).ilike("email", m.from_email.trim()).limit(1);
      contact = await ensureHistoryContact(supabase, workspaceId, m.from_email);
      if (contact && !vorher.data?.[0]) created++;
      if (contact) await supabase.from("messages").update({ contact_id: contact.id }).eq("id", m.id);
    }
    if (!contact || gesehen.has(contact.id)) continue;
    gesehen.add(contact.id);
    const received = new Date(m.sent_at ?? m.created_at);
    const r = parseReturnDate(m.subject, m.body, received);
    const err = await markOutOfOffice(supabase, contact, { until: toIsoDate(r.date), estimated: r.estimated, seenAt: received.toISOString() });
    if (!err) contacts++;
  }
  return { messages: (msgs ?? []).length, contacts, created };
}

const RANK: Record<string, number> = { new: 0, contacted: 1, out_of_office: 1, not_interested: 1, replied: 2, lead: 3, meeting_booked: 4, customer: 5 };

/**
 * Den Kontakt auf Abwesenheit setzen, ohne einen echten Fortschritt zu
 * ueberschreiben: wer schon Lead oder weiter ist, bleibt es, bekommt aber
 * das Rueckkehrdatum. 'replied' faellt auf 'out_of_office' zurueck, wenn
 * die Antwort nur die Abwesenheitsnotiz war (der Sync setzte das vor
 * Migration 0123 so).
 */
export async function markOutOfOffice(
  supabase: SupabaseClient,
  contact: { id: string; outreach_status: string },
  ooo: { until: string; estimated: boolean; seenAt: string }
): Promise<string | null> {
  const patch: Record<string, unknown> = { ooo_until: ooo.until, ooo_estimated: ooo.estimated, ooo_seen_at: ooo.seenAt };
  if ((RANK[contact.outreach_status] ?? 0) <= RANK.replied && contact.outreach_status !== "not_interested") {
    patch.outreach_status = "out_of_office";
  }
  const { error } = await supabase.from("contacts").update(patch).eq("id", contact.id);
  return error ? error.message : null;
}

export { senderOfMailbox };
