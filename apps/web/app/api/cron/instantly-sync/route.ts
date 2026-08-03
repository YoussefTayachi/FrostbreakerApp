import crypto from "crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { instantlyRequest } from "@/lib/instantly";
import { getApiKey } from "@/lib/api-keys";
import { extractOutputText } from "@/lib/openai";
import { sendEmail } from "@/lib/email";
import { detectOptOut } from "@/lib/crm/opt-out";
import { detectAutoReply } from "@/lib/crm/auto-reply";

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
              "'interested', 'not_interested', 'question' oder 'out_of_office'. " +
              "'out_of_office' gilt fuer automatische Abwesenheits- oder Urlaubsantworten -- " +
              "die Person hat dabei NICHT abgelehnt. " +
              "Antworte nur mit dem Kategorie-Wort, sonst nichts.",
          },
          { role: "user", content: bodyText.slice(0, 2000) },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const label = extractOutputText(await res.json()).trim().toLowerCase();
    const valid = ["interested", "not_interested", "question", "out_of_office"];
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
/** Gibt eine Fehlermeldung zurueck statt null, wenn der Upsert fehlschlaegt --
 *  Supabase-js wirft bei einem DB-Fehler NICHT, sondern liefert {error} zurueck,
 *  das ungeprueft zu ignorieren wuerde genau die Art von Bug verstecken, die
 *  hier gesucht wird ("Sync meldet ok, aber messages bleibt leer"). */
async function processEmail(
  supabase: SupabaseClient,
  workspaceId: string,
  email: InstantlyEmail,
  direction: "inbound" | "outbound",
  eaccount: string,
  openaiKey: string | null
): Promise<string | null> {
  const leadEmail = (email.lead ?? "").trim().toLowerCase();

  // Ohne Instantlys eigenes "lead"-Feld gehoert die Mail zu keinem Thread mit
  // einem Empfaenger -- z.B. Instantlys "Mailbox eingerichtet"-Bestaetigungen,
  // Stripe- oder Passkey-Mails an die verbundene Adresse selbst. Als "received"
  // gespeichert wuerden sie Antwortquoten verfaelschen, ohne je eine Antwort zu sein.
  if (direction === "inbound" && !leadEmail) return null;

  /**
   * Schon bekannt? Dann sofort raus.
   *
   * Notwendig geworden durch die Ueberlappung beim Wasserstand (siehe
   * syncInbox): der Sync sieht seither absichtlich einen Teil der Mails
   * mehrfach. Ohne diese Pruefung wuerde jede davon erneut durch die
   * KI-Einstufung laufen -- also ein bezahlter Modellaufruf pro Mail pro
   * Durchlauf, fuer ein Ergebnis, das schon in der Datenbank steht.
   *
   * Steht bewusst VOR allem anderen und nicht als Teil des Upserts: der
   * teure Teil ist nicht das Schreiben, sondern alles davor.
   */
  const { data: known } = await supabase
    .from("messages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("instantly_email_id", email.id)
    .limit(1);
  if (known?.length) return null;

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

  /**
   * Abwesenheitsnotiz zuerst am Muster pruefen, erst danach die KI fragen.
   *
   * Zwei Gruende, und der zweite wiegt schwerer als der erste:
   *   1. Es spart den Modellaufruf ganz, statt sein Ergebnis zu korrigieren.
   *   2. Es ist verlaesslicher. Die KI hatte beide vorhandenen Auto-Antworten
   *      als "kein Interesse" eingestuft -- inhaltlich falsch und teuer, weil
   *      dieser Status den Kontakt dauerhaft aus kuenftigen Kampagnen wirft.
   *
   * Die Muster stehen mit Tests in lib/crm/auto-reply.ts.
   */
  const auto = detectAutoReply(email.subject, bodyText);
  const aiInterest = auto.autoReply
    ? "out_of_office"
    : contact && openaiKey && bodyText
      ? await classifyReply(openaiKey, bodyText)
      : null;

  const { error: upsertError } = await supabase.from("messages").upsert(
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
  if (upsertError) return `messages upsert ${email.id}: ${upsertError.message}`;

  // Hinausgegangene Mail hebt 'new' auf 'contacted'.
  //
  // Fehlte bisher komplett: der Status wurde ausschliesslich bei einer
  // EINGEHENDEN Antwort angehoben. Wer angeschrieben wurde und (noch) nicht
  // geantwortet hat -- also die grosse Mehrheit -- blieb dauerhaft auf 'new'.
  // Nachgemessen am 2026-08-03: 21 Kontakte mit nachweislich versendeter Mail
  // standen weiterhin auf 'new', im Pipeline-Board also in der Spalte "Neu".
  // Damit war die Pipeline blind fuer genau das, wofuer es sie gibt.
  //
  // Nur von 'new' aus: 'replied' oder 'meeting_booked' duerfen durch eine
  // spaeter versendete Folgemail nicht zurueckfallen.
  if (contact && direction === "outbound" && contact.outreach_status === "new") {
    const { error } = await supabase
      .from("contacts")
      .update({ outreach_status: "contacted" })
      .eq("id", contact.id);
    if (error) return `contact contacted ${contact.id}: ${error.message}`;
  }

  if (
    contact &&
    direction === "inbound" &&
    (STATUS_RANK[contact.outreach_status] ?? 0) < STATUS_RANK.replied
  ) {
    const { error } = await supabase
      .from("contacts")
      .update({ outreach_status: "replied" })
      .eq("id", contact.id);
    if (error) return `contact status update ${contact.id}: ${error.message}`;

    // Nur bei der ERSTEN Antwort eines Kontakts benachrichtigen: der
    // Statuswechsel oben passiert genau einmal, jede Folgemail laeuft nicht
    // mehr in diesen Zweig. Ohne diese Bedingung meldete ein Hin und Her im
    // selben Thread jedes Mal erneut.
    await notifyReply(supabase, workspaceId, leadEmail, email.subject ?? "", bodyText);
  }

  // Absage merken -- unabhaengig davon, ob der Statuswechsel oben gerade
  // stattgefunden hat. Ein Kontakt kann erst freundlich antworten (Status
  // 'replied') und im zweiten Zug absagen; ohne diesen eigenen Zweig ginge
  // die Absage verloren, weil der Block oben beim zweiten Mal nicht mehr
  // greift.
  //
  // Bewusst NICHT in die Sperrliste: "kein Interesse" heisst "diesmal nicht",
  // nicht "nie wieder". Der Kontaktstatus reicht -- api/instantly/campaigns
  // schliesst 'not_interested' beim Anlegen jeder neuen Kampagne aus. Genau
  // dieser Ausschluss lief bisher ins Leere, weil den Status niemand je
  // automatisch gesetzt hat.
  if (contact && direction === "inbound" && aiInterest === "not_interested") {
    const { error } = await supabase
      .from("contacts")
      .update({ outreach_status: "not_interested" })
      .eq("id", contact.id);
    if (error) return `contact not_interested ${contact.id}: ${error.message}`;
  }

  // Abmeldebitte -- das ist die harte Variante und gilt dauerhaft ueber alle
  // Kampagnen hinweg. Greift auch ohne CRM-Kontakt: wer sich abmeldet, hat
  // Anspruch darauf, egal ob wir ihn zuordnen koennen.
  if (direction === "inbound" && leadEmail) {
    const err = await suppressOnOptOut(supabase, workspaceId, leadEmail, bodyText);
    if (err) return err;
  }

  return null;
}

/**
 * Traegt eine Abmeldebitte in die Sperrliste ein.
 *
 * Die Kampagnen-Signatur verspricht "reply 'stop' and I'll leave you alone".
 * Eingeloest wurde das nie: die Sperrliste hatte am 2026-08-03 null Eintraege,
 * obwohl mehrere Kampagnen liefen. Wer "stop" schrieb, bekam beim naechsten
 * Lauf wieder Post.
 *
 * Die Erkennung selbst (inklusive der Falle mit der zitierten Originalmail,
 * in deren Fuss dasselbe Wort steht) sitzt in lib/crm/opt-out.ts und ist dort
 * mit 18 Faellen abgesichert.
 *
 * onConflict: eine zweite "stop"-Mail derselben Adresse ist kein Fehler,
 * sondern der Normalfall -- der Eintrag bleibt einfach bestehen.
 */
async function suppressOnOptOut(
  supabase: SupabaseClient,
  workspaceId: string,
  leadEmail: string,
  bodyText: string
): Promise<string | null> {
  const { optOut, phrase } = detectOptOut(bodyText);
  if (!optOut) return null;

  const { error } = await supabase
    .from("suppression_list")
    .upsert(
      { workspace_id: workspaceId, email: leadEmail, reason: "unsubscribed" },
      { onConflict: "workspace_id,email", ignoreDuplicates: true }
    );
  if (error) return `suppression ${leadEmail}: ${error.message}`;

  console.info(`Abmeldung erkannt und gesperrt: ${leadEmail} ("${phrase}")`);
  return null;
}

/**
 * Mail an den Betreiber, sobald ein Lead antwortet.
 *
 * Bisher landete eine Antwort still im Posteingang der App -- wer nicht selbst
 * nachsah, merkte tagelang nichts. Bei Kaltakquise ist das genau das
 * Zeitfenster, in dem eine Antwort noch warm ist.
 *
 * Schluckt jeden Fehler: der Sync verarbeitet gerade Antworten, und die
 * duerfen nicht verlorengehen, weil ein Mailversand klemmt.
 */
async function notifyReply(
  supabase: SupabaseClient,
  workspaceId: string,
  leadEmail: string,
  subject: string,
  bodyText: string
): Promise<void> {
  try {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("reply_notify_email")
      .eq("id", workspaceId)
      .single();
    const to = (ws?.reply_notify_email ?? "").trim();
    if (!to) return; // nicht eingerichtet

    const auszug = bodyText.trim().slice(0, 600);
    const result = await sendEmail(
      to,
      `Antwort von ${leadEmail}`,
      [
        `${leadEmail} hat auf deine Kampagne geantwortet.`,
        subject ? `Betreff: ${subject}` : null,
        "",
        auszug || "(kein Textinhalt)",
        "",
        "Im Posteingang öffnen: https://app.frostbreaker.app/inbox",
      ]
        .filter((z) => z !== null)
        .join("\n")
    );
    if (!result.ok) {
      console.warn("Antwort-Benachrichtigung nicht zugestellt:", result.reason);
    }
  } catch (e) {
    console.warn("Antwort-Benachrichtigung fehlgeschlagen:", (e as Error).message);
  }
}

/**
 * Meldet aufgebrauchtes Anbieter-Guthaben per Mail (Migration 0059).
 *
 * Warum hier und nicht im Worker: der Worker hat keinen Resend-Schluessel und
 * soll auch keinen bekommen -- er laeuft bei einem anderen Hoster und braucht
 * fuer seine Aufgabe kein Mailkonto. Er schreibt den Alarm nur in die
 * Datenbank; verschickt wird er von hier, wo Resend ohnehin schon eingerichtet
 * ist und ohnehin jede Minute etwas laeuft.
 *
 * notified_at wird VOR dem Versand gesetzt: schlaegt der Mailversand fehl,
 * ist eine ausgebliebene Meldung aergerlich -- eine Endlosschleife, die im
 * Minutentakt dieselbe Mail schickt, sobald Resend kurz klemmt, waere
 * schlimmer.
 */
async function notifyProviderAlerts(supabase: SupabaseClient): Promise<number> {
  const { data: alerts } = await supabase
    .from("provider_alerts")
    .select("id, workspace_id, provider, message")
    .is("notified_at", null)
    .is("resolved_at", null)
    .limit(20);

  if (!alerts?.length) return 0;

  let sent = 0;
  for (const alert of alerts) {
    await supabase
      .from("provider_alerts")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", alert.id);

    const { data: ws } = await supabase
      .from("workspaces")
      .select("reply_notify_email")
      .eq("id", alert.workspace_id)
      .single();
    const to = (ws?.reply_notify_email ?? "").trim();
    if (!to) continue; // nicht eingerichtet -- der Alarm bleibt im Dashboard sichtbar

    const result = await sendEmail(
      to,
      `Guthaben aufgebraucht: ${alert.provider}`,
      [
        `Der Anbieter ${alert.provider} meldet, dass dein Guthaben aufgebraucht ist.`,
        "",
        "Die Lead-Suche laeuft deshalb gerade nicht weiter. Die betroffenen",
        "Jobs sind nicht verloren -- sie werden zurueckgestellt und laufen",
        "von allein weiter, sobald du aufgeladen hast.",
        "",
        `Originalmeldung: ${(alert.message ?? "").slice(0, 400)}`,
        "",
        "Zum Dashboard: https://app.frostbreaker.app/",
      ].join("\n")
    );
    if (result.ok) sent++;
    else console.warn("Guthaben-Warnung nicht zugestellt:", result.reason);
  }
  return sent;
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
        const err = await processEmail(supabase, workspaceId, email, "inbound", "", openaiKey);
        if (err) errors.push(err);
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
  // Tick-Laenge muss zum tatsaechlichen Cron-Intervall passen (Migration 0043:
  // jede Minute statt alle 5 Minuten) -- sonst wuerde dieselbe Seite mehrfach
  // hintereinander drankommen, statt bei jedem Aufruf weiterzurotieren.
  const tickIndex = Math.floor(Date.now() / (60 * 1000));
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
        const err = await processEmail(supabase, workspaceId, email, direction, eaccount, openaiKey);
        if (err) errors.push(err);
      }
    })
  );

  /**
   * Wasserstand vorziehen -- aber MIT UEBERLAPPUNG.
   *
   * Der Fehler, den das behebt: bisher wurde hier now() eingetragen, sobald
   * die letzte Seite eines Zyklus durch war. Die frueheren Seiten liefen aber
   * Minuten vorher. Eine Mail, die nach dem Lauf ihrer Seite und vor diesem
   * Update eintraf, wurde damit nie geholt -- beim naechsten Durchlauf galt
   * schon der neuere Wasserstand, und ihr Zeitfenster lag davor.
   *
   * Nachgewiesen am 2026-08-03 bei 19 Postfaechern (38 Paare, 3 Seiten):
   * zwei eingehende Antworten mit gueltigem lead-Feld fehlten dauerhaft in
   * der App, obwohl Instantly sie lieferte -- hudson@plantpeople.co und
   * adam@partnercommerce.com.
   *
   * Statt now() wird deshalb der Beginn des Zyklus eingetragen, grosszuegig
   * gerechnet: eine Minute je Seite plus zwei Minuten Sicherheit. Der Sync
   * sieht dadurch absichtlich einen Teil der Mails mehrfach. Das kostet
   * nichts, weil processEmail bereits bekannte Mails sofort verwirft (siehe
   * dort) -- und ein doppelt gesehener Datensatz ist unendlich viel besser
   * als ein verlorener.
   */
  if (page === pageCount - 1) {
    const overlapMs = (pageCount + 2) * 60 * 1000;
    await supabase
      .from("workspaces")
      .update({ instantly_inbox_synced_at: new Date(Date.now() - overlapMs).toISOString() })
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
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

    // Ausserhalb der Workspace-Schleife: die Alarme haengen nicht an einem
    // Instantly-Schluessel, sondern am Worker. Ein Workspace ohne Instantly
    // taucht in der Schleife oben gar nicht auf, hat aber genauso ein leeres
    // OpenAI-Konto -- und soll es genauso erfahren.
    const alertsSent = await notifyProviderAlerts(supabase).catch((e) => {
      console.warn("Guthaben-Warnungen fehlgeschlagen:", (e as Error).message);
      return 0;
    });

    return NextResponse.json({ workspaces: results.length, results, alertsSent });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
