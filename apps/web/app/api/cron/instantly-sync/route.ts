import crypto from "crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { instantlyRequest } from "@/lib/instantly";
import { getApiKey } from "@/lib/api-keys";
import { extractOutputText } from "@/lib/openai";

// Ersetzt den frueheren Python-Worker-Job "poll_instantly" (kampagnen-scoped
// Analytics/Antworten) UND "poll_instantly_inbox" (mailbox-weiter Sync) in einer
// Route: von Supabase pg_cron per pg_net alle 5 Minuten aufgerufen (siehe
// Migration 0041), statt einen Dauerprozess zu betreiben, der nur laeuft, wenn
// jemand ihn lokal startet. Beide Aufgaben sind vom selben Typ ("regelmaessig
// bei Instantly nachschauen") und teilen sich deshalb eine Route statt zwei
// getrennte Implementationen zu pflegen.
export const maxDuration = 60;

const STATUS_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  not_interested: 1,
  replied: 2,
  meeting_booked: 3,
  customer: 4,
};

type InstantlyEmail = {
  id: string;
  lead?: string | null;
  subject?: string | null;
  body?: { text?: string | null } | null;
  timestamp_email?: string | null;
};

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // Laengen muessen zuerst geprueft werden -- timingSafeEqual wirft bei
  // unterschiedlicher Laenge, statt konstant lange False zu liefern.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function classifyReply(openaiKey: string, bodyText: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "Ordne die folgende Antwort auf eine Akquise-E-Mail in genau eine Kategorie ein: " +
              "'interested', 'not_interested' oder 'question'. Antworte nur mit dem Kategorie-Wort, sonst nichts.",
          },
          { role: "user", content: bodyText.slice(0, 2000) },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const label = extractOutputText(await res.json()).trim().toLowerCase();
    const valid = ["interested", "not_interested", "question"];
    return valid.includes(label) ? label : "question";
  } catch {
    return null;
  }
}

/** Sucht einen Kontakt zur Absenderadresse und upserted die Mail immer in
 *  messages -- mit oder ohne Treffer. KI-Klassifizierung und das Hochstufen
 *  des outreach_status bleiben echten CRM-Kontakten vorbehalten (kein
 *  OpenAI-Aufruf fuer Mails ohne Lead-Bezug). Ersetzt sowohl das fruehere
 *  Python-_process_reply (das Mails ohne Treffer verwarf) als auch
 *  _process_email -- es gibt jetzt nur noch dieses eine Verhalten. */
async function processEmail(
  supabase: SupabaseClient,
  workspaceId: string,
  email: InstantlyEmail,
  direction: "inbound" | "outbound",
  eaccount: string,
  openaiKey: string | null
): Promise<void> {
  const leadEmail = (email.lead ?? "").trim().toLowerCase();

  let contact: { id: string; outreach_status: string } | null = null;
  if (leadEmail) {
    const { data } = await supabase
      .from("contacts")
      .select("id, outreach_status")
      .eq("workspace_id", workspaceId)
      .ilike("email", leadEmail)
      .limit(1);
    contact = data?.[0] ?? null;
  }

  const bodyText = email.body?.text ?? "";
  const aiInterest = contact && openaiKey && bodyText ? await classifyReply(openaiKey, bodyText) : null;

  await supabase.from("messages").upsert(
    {
      workspace_id: workspaceId,
      contact_id: contact?.id ?? null,
      from_email: leadEmail || null,
      eaccount,
      direction,
      status: direction === "inbound" ? "received" : "sent",
      subject: email.subject ?? null,
      body: bodyText,
      sent_at: email.timestamp_email ?? null,
      instantly_email_id: email.id,
      ai_interest: aiInterest,
    },
    { onConflict: "workspace_id,instantly_email_id" }
  );

  if (
    contact &&
    direction === "inbound" &&
    (STATUS_RANK[contact.outreach_status] ?? 0) < STATUS_RANK.replied
  ) {
    await supabase.from("contacts").update({ outreach_status: "replied" }).eq("id", contact.id);
  }
}

async function fetchEmails(
  apiKey: string,
  params: Record<string, string>
): Promise<InstantlyEmail[]> {
  const query = new URLSearchParams({ limit: "100", ...params });
  const data = await instantlyRequest<{ items?: InstantlyEmail[] }>(apiKey, `/api/v2/emails?${query}`);
  return data.items ?? [];
}

// Jede Suche kostet 1 Request gegen /api/v2/emails (die 20/min-Grenze) -- bei
// vielen aktiven Kampagnen gleichzeitig faellig sonst dasselbe Problem wie bei
// syncInbox. Kein Rotations-Aufwand noetig: instantly_last_polled_at haengt
// bereits an der einzelnen Suche, nicht am Workspace, wer diesen Tick nicht
// drankommt, bleibt einfach mit seinem alten Stand liegen und ist beim
// naechsten Mal (nach am laengsten unbearbeitet zuerst) wieder faellig.
const CAMPAIGN_REQUEST_BUDGET = 4;

/** Kampagnen-Teil: Analytics-Rollup + kampagnen-scoped Antworten, wie zuvor
 *  poll_instantly.run() im Python-Worker. Weiterhin fuer die CRM-Pipeline-
 *  Stats (ForecastCards etc.) zustaendig -- unabhaengig vom Mailbox-Teil unten. */
async function syncCampaigns(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string,
  openaiKey: string | null
): Promise<{ searches: number; emailsFound: number; errors: string[] }> {
  const { data: searches } = await supabase
    .from("searches")
    .select("id, instantly_campaign_id, instantly_last_polled_at")
    .eq("workspace_id", workspaceId)
    .not("instantly_campaign_id", "is", null)
    .order("instantly_last_polled_at", { ascending: true, nullsFirst: true })
    .limit(CAMPAIGN_REQUEST_BUDGET);

  const errors: string[] = [];
  let emailsFound = 0;

  await Promise.all(
    (searches ?? []).map(async (search) => {
      const campaignId = search.instantly_campaign_id as string;

      const analytics = await instantlyRequest<Record<string, number>[]>(
        apiKey,
        `/api/v2/campaigns/analytics?id=${campaignId}`
      ).catch((e) => {
        errors.push(`analytics ${campaignId}: ${(e as Error).message}`);
        return null;
      });
      if (analytics?.[0]) {
        const a = analytics[0];
        await supabase.from("instantly_campaign_stats").upsert(
          {
            search_id: search.id,
            workspace_id: workspaceId,
            leads_count: a.leads_count ?? 0,
            contacted_count: a.contacted_count ?? 0,
            emails_sent_count: a.emails_sent_count ?? 0,
            open_count: a.open_count ?? 0,
            reply_count: a.reply_count ?? 0,
            reply_count_unique: a.reply_count_unique ?? 0,
            bounced_count: a.bounced_count ?? 0,
            unsubscribed_count: a.unsubscribed_count ?? 0,
            completed_count: a.completed_count ?? 0,
            total_opportunities: a.total_opportunities ?? 0,
            total_opportunity_value: a.total_opportunity_value ?? 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "search_id" }
        );
      }

      const params: Record<string, string> = { campaign_id: campaignId, email_type: "received" };
      if (search.instantly_last_polled_at) params.min_timestamp_created = search.instantly_last_polled_at;
      const emails = await fetchEmails(apiKey, params).catch((e) => {
        errors.push(`emails ${campaignId}: ${(e as Error).message}`);
        return [];
      });
      emailsFound += emails.length;
      for (const email of emails) {
        await processEmail(supabase, workspaceId, email, "inbound", "", openaiKey);
      }

      await supabase
        .from("searches")
        .update({ instantly_last_polled_at: new Date().toISOString() })
        .eq("id", search.id);
    })
  );

  return { searches: searches?.length ?? 0, emailsFound, errors };
}

// Instantly erlaubt max. 20 Requests/Minute auf /api/v2/emails. Ein Workspace
// mit vielen verbundenen Mailboxen (eaccount x {received, sent}) kann das in
// einem einzelnen Tick locker sprengen -- deshalb wird pro Aufruf nur eine
// "Seite" der faelligen Paare bearbeitet, der Rest kommt in einem der naechsten
// 5-Minuten-Ticks dran. BUDGET absichtlich unter 20, damit noch Luft fuer den
// Kampagnen-Teil (syncCampaigns) bleibt, der parallel dazu laeuft.
const INBOX_REQUEST_BUDGET = 15;

/** Mailbox-Teil: postfach-weiter Sync ueber alle verbundenen eaccounts, beide
 *  Richtungen, ohne campaign_id-Filter -- wie zuvor poll_instantly.run_inbox().
 *  Verarbeitet pro Aufruf nur bis zu INBOX_REQUEST_BUDGET (eaccount, Richtung)-
 *  Paare (siehe oben) -- bei vielen Mailboxen dauert ein voller Durchlauf
 *  entsprechend mehrere Ticks, das ist bei einem "alle 5 Minuten"-Sync voellig
 *  ausreichend. instantly_inbox_synced_at wandert erst weiter, wenn ALLE Paare
 *  einmal mit demselben since-Wert drangekommen sind -- sonst wuerden Mailboxen,
 *  die diesen Tick nicht an der Reihe waren, Mails aus der Zwischenzeit verpassen. */
async function syncInbox(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string,
  openaiKey: string | null
): Promise<{ accounts: number; page: string; emailsFound: number; since: string | null; errors: string[] }> {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("instantly_inbox_synced_at")
    .eq("id", workspaceId)
    .single();
  const since = workspace?.instantly_inbox_synced_at ?? undefined;

  const errors: string[] = [];
  const accounts = await instantlyRequest<{ items?: { email?: string }[] }>(
    apiKey,
    "/api/v2/accounts?limit=100"
  ).catch((e) => {
    errors.push(`accounts: ${(e as Error).message}`);
    return { items: [] };
  });

  const directions: { emailType: string; direction: "inbound" | "outbound" }[] = [
    { emailType: "received", direction: "inbound" },
    { emailType: "sent", direction: "outbound" },
  ];

  const allPairs = (accounts.items ?? []).flatMap((account) => {
    const eaccount = account.email;
    if (!eaccount) return [];
    return directions.map((d) => ({ eaccount, ...d }));
  });

  const pageCount = Math.max(1, Math.ceil(allPairs.length / INBOX_REQUEST_BUDGET));
  const tickIndex = Math.floor(Date.now() / (5 * 60 * 1000));
  const page = tickIndex % pageCount;
  const pairs = allPairs.slice(page * INBOX_REQUEST_BUDGET, (page + 1) * INBOX_REQUEST_BUDGET);

  let emailsFound = 0;
  await Promise.all(
    pairs.map(async ({ eaccount, emailType, direction }) => {
      const params: Record<string, string> = { eaccount, email_type: emailType, mode: "emode_all" };
      if (since) params.min_timestamp_created = since;
      const emails = await fetchEmails(apiKey, params).catch((e) => {
        errors.push(`emails ${eaccount}/${emailType}: ${(e as Error).message}`);
        return [];
      });
      emailsFound += emails.length;
      for (const email of emails) {
        await processEmail(supabase, workspaceId, email, direction, eaccount, openaiKey);
      }
    })
  );

  // since erst vorziehen, wenn dieser Tick die letzte Seite eines vollen
  // Zyklus war -- vorher blieben alle Seiten beim selben since-Wert.
  if (page === pageCount - 1) {
    await supabase
      .from("workspaces")
      .update({ instantly_inbox_synced_at: new Date().toISOString() })
      .eq("id", workspaceId);
  }

  return {
    accounts: accounts.items?.length ?? 0,
    page: `${page + 1}/${pageCount}`,
    emailsFound,
    since: since ?? null,
    errors,
  };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    // Absichtlich nur Laengen/Booleans, nie die Werte selbst -- reicht, um
    // "Env-Var fehlt" von "Env-Var gesetzt, aber falscher Wert" zu unterscheiden,
    // ohne das Secret selbst preiszugeben. Nach Diagnose wieder entfernen.
    const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    return NextResponse.json(
      {
        error: "unauthorized",
        debug: {
          secretConfigured: !!process.env.CRON_SECRET,
          secretLength: process.env.CRON_SECRET?.length ?? 0,
          providedLength: provided.length,
        },
      },
      { status: 401 }
    );
  }

  // Ein von aussen (pg_cron) getriggerter Endpoint darf nie mit einem nackten,
  // body-losen 500 antworten -- ohne diesen Rahmen verschluckt Vercel jeden
  // Fehler vor dem ersten await (z.B. fehlende Env-Var in createServiceClient)
  // spurlos, und weder pg_net-Logs noch curl zeigen mehr als "500".
  try {
    const supabase = createServiceClient();

    const { data: keyRows } = await supabase
      .from("api_keys")
      .select("workspace_id")
      .eq("provider", "instantly");
    const workspaceIds = [...new Set((keyRows ?? []).map((r) => r.workspace_id as string))];

    const results = await Promise.all(
      workspaceIds.map(async (workspaceId) => {
        try {
          const apiKey = await getApiKey(supabase, workspaceId, "instantly");
          if (!apiKey) return { workspaceId, status: "skipped: no key" };

          // KI-Klassifizierung ist optional -- fehlt der OpenAI-Key, laeuft der
          // Sync trotzdem, nur ohne ai_interest auf neuen Nachrichten.
          const openaiKey = await getApiKey(supabase, workspaceId, "openai").catch(() => null);

          const [campaigns, inbox] = await Promise.all([
            syncCampaigns(supabase, workspaceId, apiKey, openaiKey),
            syncInbox(supabase, workspaceId, apiKey, openaiKey),
          ]);
          return { workspaceId, status: "ok", campaigns, inbox };
        } catch (e) {
          return { workspaceId, status: "error", message: (e as Error).message };
        }
      })
    );

    return NextResponse.json({ workspaces: results.length, results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
