import crypto from "crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { instantlyRequest } from "@/lib/instantly";
import { getApiKey } from "@/lib/api-keys";
import { extractOutputText } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage";
import { sendEmail } from "@/lib/email";
import { detectOptOut } from "@/lib/crm/opt-out";
import { detectAutoReply } from "@/lib/crm/auto-reply";
import { emailBodyText } from "@/lib/instantly/email-body";
import { parseStepRef } from "@/lib/instantly/step-ref";
import { runDeliverabilityCheck } from "@/lib/deliverability";
import {
  assessBounces,
  domainChange,
  domainCheckDue,
  type CampaignBounceState,
  type DomainCheck,
} from "@/lib/deliverability-watch";

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
  /** html ist bei aus einer Kampagne versendeten Mails das einzig gefuellte
   *  Feld — siehe lib/instantly/email-body.ts. */
  body?: { text?: string | null; html?: string | null } | null;
  timestamp_email?: string | null;
  /**
   * Die drei Felder fuer die Zuordnung "welcher Text hat das ausgeloest".
   *
   * Instantly liefert sie seit jeher mit — dieser Typ deklarierte nur fuenf
   * der neunzehn Felder, und deshalb stand in 753 Nachrichten kein einziger
   * step_order. Am 2026-08-05 an echten Mails nachgesehen, siehe Migration
   * 0076 und lib/instantly/step-ref.ts.
   */
  campaign_id?: string | null;
  /** "sequenz_schritt_variante", je 0-basiert. Z.B. "0_1_0". */
  step?: string | null;
  /** Verbindet eine Antwort mit der Mail, auf die sie antwortet. */
  thread_id?: string | null;
};

/**
 * Die Zuordnungsfelder einer Mail, fertig zum Schreiben.
 *
 * Als eigene Funktion, weil sie an zwei Stellen gebraucht wird: beim Anlegen
 * einer neuen Zeile und beim Nachtragen an einer bereits bekannten.
 */
function attributionOf(
  email: InstantlyEmail,
  campaignIds: Map<string, string> | undefined
): {
  campaign_id: string | null;
  instantly_campaign_id: string | null;
  step_order: number | null;
  variant_index: number | null;
  thread_id: string | null;
} {
  const ref = parseStepRef(email.step);
  const instantlyCampaignId = email.campaign_id ?? null;
  return {
    // Nur die Kampagnen, die die App auch kennt. Zwei der sechs Kampagnen im
    // Konto wurden direkt bei Instantly angelegt und haben lokal keine Zeile
    // — fuer die bleibt campaign_id leer und instantly_campaign_id traegt
    // den Beleg (siehe Migration 0076).
    campaign_id: (instantlyCampaignId && campaignIds?.get(instantlyCampaignId)) || null,
    instantly_campaign_id: instantlyCampaignId,
    step_order: ref?.step ?? null,
    variant_index: ref?.variant ?? null,
    thread_id: email.thread_id ?? null,
  };
}

/**
 * Was beim Nachholen anders laeuft als im laufenden Betrieb.
 *
 * notify: beim Nachholen aus. Die Antworten, die dabei hochkommen, sind
 * Wochen alt — eine Mail "X hat gerade geantwortet" waere schlicht falsch,
 * und bei ueber hundert nachgeholten Nachrichten waere sie hundertmal falsch.
 * Im Posteingang tauchen sie trotzdem auf, dort gehoeren sie hin.
 */
type ProcessOptions = {
  notify?: boolean;
  /**
   * Instantlys Kampagnen-UUID -> lokale campaigns.id.
   *
   * Einmal je Workspace geladen und durchgereicht, statt je Mail nachzusehen:
   * ein Sync-Tick verarbeitet bis zu 15 Postfaecher mit je bis zu 100 Mails,
   * und eine Abfrage pro Mail waere fuer eine Zuordnung, die sich waehrend
   * eines Laufs nicht aendert.
   */
  campaignIds?: Map<string, string>;
};

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // Laengen muessen zuerst geprueft werden — timingSafeEqual wirft bei
  // unterschiedlicher Laenge, statt konstant lange False zu liefern.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Die Einstufung einer eingegangenen Antwort.
 *
 * supabase und workspaceId stehen hier NUR fuer die Kostenzeile. Diese Route
 * ruft pg_cron jede Minute auf, jede eingestufte Antwort ist ein bezahlter
 * OpenAI-Aufruf — und bis zum 2026-08-12 tauchte davon nichts unter
 * "API-Kosten" auf. Das war kein Nebenposten, sondern eine Dauerlast, die
 * niemand sehen konnte.
 */
async function classifyReply(
  supabase: SupabaseClient,
  workspaceId: string,
  openaiKey: string,
  bodyText: string
): Promise<string | null> {
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
    const json = await res.json();
    await recordOpenAiUsage(supabase, workspaceId, "classify_reply", json);
    const label = extractOutputText(json).trim().toLowerCase();
    const valid = ["interested", "not_interested", "question", "out_of_office"];
    return valid.includes(label) ? label : "question";
  } catch {
    return null;
  }
}

/** Sucht einen Kontakt zur Absenderadresse und upserted die Mail immer in
 *  messages — mit oder ohne Treffer. KI-Klassifizierung und das Hochstufen
 *  des outreach_status bleiben echten CRM-Kontakten vorbehalten (kein
 *  OpenAI-Aufruf fuer Mails ohne Lead-Bezug). Ersetzt sowohl das fruehere
 *  Python-_process_reply (das Mails ohne Treffer verwarf) als auch
 *  _process_email — es gibt jetzt nur noch dieses eine Verhalten. */
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
  openaiKey: string | null,
  options: ProcessOptions = {}
): Promise<string | null> {
  const leadEmail = (email.lead ?? "").trim().toLowerCase();

  // Ohne Instantlys eigenes "lead"-Feld gehoert die Mail zu keinem Thread mit
  // einem Empfaenger — z.B. Instantlys "Mailbox eingerichtet"-Bestaetigungen,
  // Stripe- oder Passkey-Mails an die verbundene Adresse selbst. Als "received"
  // gespeichert wuerden sie Antwortquoten verfaelschen, ohne je eine Antwort zu sein.
  if (direction === "inbound" && !leadEmail) return null;

  // Mit Ruecksfall auf body.html: von 184 gespeicherten ausgehenden Mails
  // hatten am 2026-08-04 alle 184 einen leeren Text, weil hier nur body.text
  // gelesen wurde und Instantly bei Kampagnenmails nur html fuellt. Im
  // Posteingang stand zu jeder verschickten Mail eine leere Zeile.
  const bodyText = emailBodyText(email.body);

  /**
   * Schon bekannt? Dann sofort raus.
   *
   * Notwendig geworden durch die Ueberlappung beim Wasserstand (siehe
   * syncInbox): der Sync sieht seither absichtlich einen Teil der Mails
   * mehrfach. Ohne diese Pruefung wuerde jede davon erneut durch die
   * KI-Einstufung laufen — also ein bezahlter Modellaufruf pro Mail pro
   * Durchlauf, fuer ein Ergebnis, das schon in der Datenbank steht.
   *
   * Steht bewusst VOR allem anderen ausser dem Text: der teure Teil ist
   * nicht das Schreiben, sondern alles davor.
   */
  const { data: known } = await supabase
    .from("messages")
    .select("id, body, step_order")
    .eq("workspace_id", workspaceId)
    .eq("instantly_email_id", email.id)
    .limit(1);
  if (known?.length) {
    /**
     * Zuordnung nachtragen, wenn sie fehlt.
     *
     * Dieselbe Ueberlegung wie beim fehlenden Text darunter: die Zeilen, die
     * vor Migration 0076 entstanden sind, sehen den regulaeren Weg nie wieder
     * — der Sync erkennt sie als bekannt und steigt aus. Diese Stelle ist die
     * einzige, an der eine erneut gesehene Mail eine alte Zeile reparieren
     * kann.
     *
     * Nur wenn step_order leer ist. Eine vorhandene Zuordnung zu
     * ueberschreiben waere kein Nachtragen mehr — und bei einer Mail, deren
     * Kampagne inzwischen anders verdrahtet ist, waere es eine Verfaelschung.
     */
    if (known[0].step_order === null) {
      const attribution = attributionOf(email, options.campaignIds);
      if (attribution.step_order !== null || attribution.instantly_campaign_id) {
        const { error } = await supabase.from("messages").update(attribution).eq("id", known[0].id);
        if (error) return `messages attribution ${email.id}: ${error.message}`;
      }
    }
    /**
     * Eine Ausnahme: der fehlende Text wird nachgetragen.
     *
     * Die 184 bereits gespeicherten Zeilen wuerden sonst fuer immer leer
     * bleiben — der Nachlauf laeuft an ihnen vorbei, weil er sie kennt, und
     * der laufende Sync sieht sie nie wieder. Genau umgekehrt gedacht: der
     * Nachlauf geht ohnehin an jeder dieser Mails vorbei, das ist die einzige
     * Gelegenheit, sie zu reparieren.
     *
     * Nur wenn vorher nichts dastand. Eine vorhandene Fassung zu ueberschreiben
     * waere kein Nachtragen mehr, sondern ein Ueberschreiben.
     */
    if (bodyText && !(known[0].body ?? "").trim()) {
      const { error } = await supabase.from("messages").update({ body: bodyText }).eq("id", known[0].id);
      if (error) return `messages body ${email.id}: ${error.message}`;
    }
    return null;
  }

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

  /**
   * Abwesenheitsnotiz zuerst am Muster pruefen, erst danach die KI fragen.
   *
   * Zwei Gruende, und der zweite wiegt schwerer als der erste:
   *   1. Es spart den Modellaufruf ganz, statt sein Ergebnis zu korrigieren.
   *   2. Es ist verlaesslicher. Die KI hatte beide vorhandenen Auto-Antworten
   *      als "kein Interesse" eingestuft — inhaltlich falsch und teuer, weil
   *      dieser Status den Kontakt dauerhaft aus kuenftigen Kampagnen wirft.
   *
   * Die Muster stehen mit Tests in lib/crm/auto-reply.ts.
   */
  /**
   * Und ausschliesslich fuer EINGEHENDE Mails.
   *
   * Die Einstufung beantwortet "wie hat der Empfaenger reagiert" — auf den
   * eigenen Kampagnentext angewandt ist sie sinnlos. Bisher fehlte diese
   * Bedingung; dass trotzdem keine einzige ausgehende Zeile ein ai_interest
   * trug, lag allein am leeren Body, der den Aufruf zufaellig verhinderte.
   * Mit dem html-Ruecksfall oben faellt dieser Zufall weg: ohne die Schranke
   * haette der Nachlauf rund 130 bezahlte Modellaufrufe auf selbst
   * geschriebene Mails ausgeloest.
   */
  const inbound = direction === "inbound";
  const auto = inbound ? detectAutoReply(email.subject, bodyText) : { autoReply: false };
  const aiInterest = auto.autoReply
    ? "out_of_office"
    : inbound && contact && openaiKey && bodyText
      ? await classifyReply(supabase, workspaceId, openaiKey, bodyText)
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
      ...attributionOf(email, options.campaignIds),
    },
    { onConflict: "workspace_id,instantly_email_id" }
  );
  if (upsertError) return `messages upsert ${email.id}: ${upsertError.message}`;

  // Hinausgegangene Mail hebt 'new' auf 'contacted'.
  //
  // Fehlte bisher komplett: der Status wurde ausschliesslich bei einer
  // EINGEHENDEN Antwort angehoben. Wer angeschrieben wurde und (noch) nicht
  // geantwortet hat — also die grosse Mehrheit — blieb dauerhaft auf 'new'.
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
    if (options.notify !== false) {
      await notifyReply(supabase, workspaceId, leadEmail, email.subject ?? "", bodyText);
    }
  }

  // Absage merken — unabhaengig davon, ob der Statuswechsel oben gerade
  // stattgefunden hat. Ein Kontakt kann erst freundlich antworten (Status
  // 'replied') und im zweiten Zug absagen; ohne diesen eigenen Zweig ginge
  // die Absage verloren, weil der Block oben beim zweiten Mal nicht mehr
  // greift.
  //
  // Bewusst NICHT in die Sperrliste: "kein Interesse" heisst "diesmal nicht",
  // nicht "nie wieder". Der Kontaktstatus reicht — api/instantly/campaigns
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

  // Abmeldebitte — das ist die harte Variante und gilt dauerhaft ueber alle
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
 * sondern der Normalfall — der Eintrag bleibt einfach bestehen.
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
 * Bisher landete eine Antwort still im Posteingang der App — wer nicht selbst
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
 * soll auch keinen bekommen — er laeuft bei einem anderen Hoster und braucht
 * fuer seine Aufgabe kein Mailkonto. Er schreibt den Alarm nur in die
 * Datenbank; verschickt wird er von hier, wo Resend ohnehin schon eingerichtet
 * ist und ohnehin jede Minute etwas laeuft.
 *
 * notified_at wird VOR dem Versand gesetzt: schlaegt der Mailversand fehl,
 * ist eine ausgebliebene Meldung aergerlich — eine Endlosschleife, die im
 * Minutentakt dieselbe Mail schickt, sobald Resend kurz klemmt, waere
 * schlimmer.
 */
/**
 * Der Text der Alarm-Mail, je nach Art.
 *
 * Alle drei Arten teilen sich die Strecke in provider_alerts (Entdoppelung,
 * Versand, Dashboard) — aber nicht den Text. "Guthaben aufgebraucht" ueber
 * einer angehaltenen Kampagne zu schreiben waere schlimmer als gar keine
 * Meldung: der Empfaenger sucht dann am falschen Ort.
 *
 * Jede Mail beantwortet dieselben drei Fragen: was ist passiert, was
 * bedeutet es, was ist jetzt zu tun. Ohne die dritte ist eine Alarmmail nur
 * eine schlechte Nachricht.
 */
function alertMail(kind: string, provider: string, message: string): { subject: string; body: string } {
  if (kind === "domain_broken") {
    return {
      subject: `Zustellbarkeit gefaehrdet: ${provider}`,
      body: [
        message,
        "",
        "Was das heisst: Empfaenger koennen nicht mehr pruefen, ob die Mail",
        "wirklich von dieser Domain kommt. Google und Microsoft stufen sie",
        "deshalb herab — ein grosser Teil landet im Spam-Ordner, ohne dass",
        "es irgendwo als Fehler auftaucht.",
        "",
        "Was zu tun ist: den fehlenden Eintrag beim DNS-Anbieter der Domain",
        "nachtragen. Die App zeigt unter Instantly > Zustellbarkeit, was",
        "genau fehlt und wie der Eintrag aussehen muss.",
        "",
        "Zur Pruefung: https://app.frostbreaker.app/instantly/deliverability",
      ].join("\n"),
    };
  }

  if (kind === "campaign_paused") {
    return {
      subject: `Kampagne angehalten: ${provider}`,
      body: [
        message,
        "",
        "Was das heisst: ab etwa 5 Prozent Bounce greifen die",
        "Schutzmechanismen der Empfaenger-Provider, und der Ruf deiner",
        "Absender-Domain traegt das dauerhaft mit. Weiterzusenden haette",
        "nicht diese Kampagne gekostet, sondern die Domain.",
        "",
        "Was zu tun ist: die Adressliste pruefen, bevor du fortsetzt --",
        "meist stammen die Bounces aus einer Quelle mit vielen ungeprueften",
        "Adressen. Danach laesst sich die Kampagne mit einem Klick wieder",
        "starten.",
        "",
        "Zur Kampagne: https://app.frostbreaker.app/instantly/campaigns",
      ].join("\n"),
    };
  }

  return {
    subject: `Guthaben aufgebraucht: ${provider}`,
    body: [
      `Der Anbieter ${provider} meldet, dass dein Guthaben aufgebraucht ist.`,
      "",
      "Die Lead-Suche laeuft deshalb gerade nicht weiter. Die betroffenen",
      "Jobs sind nicht verloren — sie werden zurueckgestellt und laufen",
      "von allein weiter, sobald du aufgeladen hast.",
      "",
      `Originalmeldung: ${message.slice(0, 400)}`,
      "",
      "Zum Dashboard: https://app.frostbreaker.app/",
    ].join("\n"),
  };
}

async function notifyProviderAlerts(supabase: SupabaseClient): Promise<number> {
  const { data: alerts } = await supabase
    .from("provider_alerts")
    .select("id, workspace_id, provider, kind, message")
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
    if (!to) continue; // nicht eingerichtet — der Alarm bleibt im Dashboard sichtbar

    const mail = alertMail(alert.kind as string, alert.provider as string, alert.message ?? "");
    const result = await sendEmail(to, mail.subject, mail.body);
    if (result.ok) sent++;
    else console.warn("Guthaben-Warnung nicht zugestellt:", result.reason);
  }
  return sent;
}

/** Eine Seite ist bei Instantly auf 100 gedeckelt. */
const EMAIL_PAGE_SIZE = 100;

/**
 * Eine Seite Mails, mit dem Cursor auf die naechste.
 *
 * next ist null, wenn Instantly keine weitere Seite kennt. Wer den Cursor
 * ignoriert, bekommt bei einem vollen Ergebnis stillschweigend nur die
 * neuesten 100 — genau darauf beruht der Nachlauf unten.
 */
async function fetchEmails(
  apiKey: string,
  params: Record<string, string>
): Promise<{ items: InstantlyEmail[]; next: string | null }> {
  const query = new URLSearchParams({ limit: String(EMAIL_PAGE_SIZE), ...params });
  const data = await instantlyRequest<{ items?: InstantlyEmail[]; next_starting_after?: string }>(
    apiKey,
    `/api/v2/emails?${query}`
  );
  return { items: data.items ?? [], next: data.next_starting_after ?? null };
}

/** Die verbundenen Postfaecher. Zaehlt nicht gegen die 20/min auf /emails. */
async function listAccounts(apiKey: string): Promise<string[]> {
  const data = await instantlyRequest<{ items?: { email?: string }[] }>(
    apiKey,
    "/api/v2/accounts?limit=100"
  );
  return (data.items ?? []).map((a) => a.email).filter((e): e is string => Boolean(e));
}

// Jede Suche kostet 1 Request gegen /api/v2/emails (die 20/min-Grenze) — bei
// vielen aktiven Kampagnen gleichzeitig faellig sonst dasselbe Problem wie bei
// syncInbox. Kein Rotations-Aufwand noetig: instantly_last_polled_at haengt
// bereits an der einzelnen Suche, nicht am Workspace, wer diesen Tick nicht
// drankommt, bleibt einfach mit seinem alten Stand liegen und ist beim
// naechsten Mal (nach am laengsten unbearbeitet zuerst) wieder faellig.
const CAMPAIGN_REQUEST_BUDGET = 4;

/** Kampagnen-Teil: Analytics-Rollup + kampagnen-scoped Antworten, wie zuvor
 *  poll_instantly.run() im Python-Worker. Weiterhin fuer die CRM-Pipeline-
 *  Stats (ForecastCards etc.) zustaendig — unabhaengig vom Mailbox-Teil unten. */
/**
 * Instantlys Kampagnen-UUID -> lokale campaigns.id.
 *
 * Einmal je Workspace und Lauf. Ohne diese Zuordnung traegt eine Nachricht
 * zwar Schritt und Variante, aber keine Kampagne — und "Schritt 1, Variante
 * B" ist ohne die Kampagne dazu keine Aussage, weil jede Kampagne ihren
 * eigenen Schritt 1 hat.
 */
async function loadCampaignIds(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("campaigns")
    .select("id, instantly_campaign_id")
    .eq("workspace_id", workspaceId)
    .not("instantly_campaign_id", "is", null);
  return new Map(
    (data ?? []).map((c) => [c.instantly_campaign_id as string, c.id as string])
  );
}

async function syncCampaigns(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string,
  openaiKey: string | null,
  campaignIds: Map<string, string>
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
      const { items: emails } = await fetchEmails(apiKey, params).catch((e) => {
        errors.push(`emails ${campaignId}: ${(e as Error).message}`);
        return { items: [] as InstantlyEmail[], next: null };
      });
      emailsFound += emails.length;
      for (const email of emails) {
        const err = await processEmail(supabase, workspaceId, email, "inbound", "", openaiKey, {
          campaignIds,
        });
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
// einem einzelnen Tick locker sprengen — deshalb wird pro Aufruf nur eine
// "Seite" der faelligen Paare bearbeitet, der Rest kommt in einem der naechsten
// 5-Minuten-Ticks dran. BUDGET absichtlich unter 20, damit noch Luft fuer den
// Kampagnen-Teil (syncCampaigns) bleibt, der parallel dazu laeuft.
const INBOX_REQUEST_BUDGET = 15;

/** Beide Richtungen eines Postfachs — die Einheit, in der beide Sync-Teile
 *  und der Nachlauf ihre Arbeit zaehlen. */
const DIRECTIONS: { emailType: "received" | "sent"; direction: "inbound" | "outbound" }[] = [
  { emailType: "received", direction: "inbound" },
  { emailType: "sent", direction: "outbound" },
];

/** Mailbox-Teil: postfach-weiter Sync ueber alle verbundenen eaccounts, beide
 *  Richtungen, ohne campaign_id-Filter — wie zuvor poll_instantly.run_inbox().
 *  Verarbeitet pro Aufruf nur bis zu INBOX_REQUEST_BUDGET (eaccount, Richtung)-
 *  Paare (siehe oben) — bei vielen Mailboxen dauert ein voller Durchlauf
 *  entsprechend mehrere Ticks, das ist bei einem "alle 5 Minuten"-Sync voellig
 *  ausreichend. instantly_inbox_synced_at wandert erst weiter, wenn ALLE Paare
 *  einmal mit demselben since-Wert drangekommen sind — sonst wuerden Mailboxen,
 *  die diesen Tick nicht an der Reihe waren, Mails aus der Zwischenzeit verpassen. */
async function syncInbox(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string,
  openaiKey: string | null,
  eaccounts: string[],
  campaignIds: Map<string, string>
): Promise<{ accounts: number; page: string; emailsFound: number; since: string | null; errors: string[] }> {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("instantly_inbox_synced_at")
    .eq("id", workspaceId)
    .single();
  const since = workspace?.instantly_inbox_synced_at ?? undefined;

  const errors: string[] = [];
  const overflow: string[] = [];

  const allPairs = eaccounts.flatMap((eaccount) =>
    DIRECTIONS.map((d) => ({ eaccount, ...d }))
  );

  const pageCount = Math.max(1, Math.ceil(allPairs.length / INBOX_REQUEST_BUDGET));
  // Tick-Laenge muss zum tatsaechlichen Cron-Intervall passen (Migration 0043:
  // jede Minute statt alle 5 Minuten) — sonst wuerde dieselbe Seite mehrfach
  // hintereinander drankommen, statt bei jedem Aufruf weiterzurotieren.
  const tickIndex = Math.floor(Date.now() / (60 * 1000));
  const page = tickIndex % pageCount;
  const pairs = allPairs.slice(page * INBOX_REQUEST_BUDGET, (page + 1) * INBOX_REQUEST_BUDGET);

  let emailsFound = 0;
  await Promise.all(
    pairs.map(async ({ eaccount, emailType, direction }) => {
      const params: Record<string, string> = { eaccount, email_type: emailType, mode: "emode_all" };
      if (since) params.min_timestamp_created = since;
      const { items: emails, next } = await fetchEmails(apiKey, params).catch((e) => {
        errors.push(`emails ${eaccount}/${emailType}: ${(e as Error).message}`);
        return { items: [] as InstantlyEmail[], next: null };
      });
      emailsFound += emails.length;
      for (const email of emails) {
        const err = await processEmail(supabase, workspaceId, email, direction, eaccount, openaiKey, {
          campaignIds,
        });
        if (err) errors.push(err);
      }

      /**
       * Eine volle Seite heisst: es gab mehr, als in eine passt.
       *
       * Der laufende Sync holt bewusst genau eine Seite je Paar, damit ein
       * Tick nicht die 20 Anfragen je Minute sprengt. Bei einem Wasserstand
       * von wenigen Minuten reicht das mit weitem Abstand — 100 Mails an
       * EIN Postfach in EINER Richtung in diesem Fenster kommt bei 19
       * Postfaechern und rund 300 Mails insgesamt nicht vor.
       *
       * Falls es doch einmal so weit ist, soll es nicht still passieren:
       * dann fehlen Mails, und zwar dauerhaft, weil der Wasserstand
       * weiterwandert. Deshalb hier eine Meldung statt einer Schleife — die
       * richtige Antwort waere ein Nachlauf fuer dieses Paar, und dessen
       * Auswirkung auf das Anfragebudget will man bewusst entscheiden und
       * nicht als Nebenwirkung bekommen.
       */
      if (emails.length >= EMAIL_PAGE_SIZE && next) {
        overflow.push(`${eaccount}/${emailType}`);
      }
    })
  );

  if (overflow.length) {
    console.warn(
      `Sync-Seite voll ausgeschoepft, es koennten Mails fehlen: ${overflow.join(", ")}`
    );
  }

  /**
   * Wasserstand vorziehen — aber MIT UEBERLAPPUNG.
   *
   * Der Fehler, den das behebt: bisher wurde hier now() eingetragen, sobald
   * die letzte Seite eines Zyklus durch war. Die frueheren Seiten liefen aber
   * Minuten vorher. Eine Mail, die nach dem Lauf ihrer Seite und vor diesem
   * Update eintraf, wurde damit nie geholt — beim naechsten Durchlauf galt
   * schon der neuere Wasserstand, und ihr Zeitfenster lag davor.
   *
   * Nachgewiesen am 2026-08-03 bei 19 Postfaechern (38 Paare, 3 Seiten):
   * zwei eingehende Antworten mit gueltigem lead-Feld fehlten dauerhaft in
   * der App, obwohl Instantly sie lieferte — hudson@plantpeople.co und
   * adam@partnercommerce.com.
   *
   * Statt now() wird deshalb der Beginn des Zyklus eingetragen, grosszuegig
   * gerechnet: eine Minute je Seite plus zwei Minuten Sicherheit. Der Sync
   * sieht dadurch absichtlich einen Teil der Mails mehrfach. Das kostet
   * nichts, weil processEmail bereits bekannte Mails sofort verwirft (siehe
   * dort) — und ein doppelt gesehener Datensatz ist unendlich viel besser
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
    accounts: eaccounts.length,
    page: `${page + 1}/${pageCount}`,
    emailsFound,
    since: since ?? null,
    errors,
  };
}

/**
 * Wie viele Seiten der Nachlauf je Tick holt.
 *
 * Zusammen mit CAMPAIGN_REQUEST_BUDGET (4) bleiben 14 von 20 erlaubten
 * Anfragen je Minute. Bewusst unter INBOX_REQUEST_BUDGET: der Nachlauf holt
 * bis zu 100 Mails je Seite, und die muessen alle einzeln durch processEmail
 * — bei 15 Seiten gleichzeitig waere Vercels Minute das engere Limit als
 * Instantlys Zaehler.
 */
const BACKFILL_REQUEST_BUDGET = 10;

/** 100 Seiten sind 10.000 Mails je Postfach und Richtung. Die Grenze ist die
 *  Bremse gegen eine Endlosschleife, nicht gegen den Normalfall. */
const BACKFILL_MAX_PAGES = 100;

/** Danach gibt der Nachlauf diese Zeile auf. Ohne diese Grenze wuerde ein
 *  dauerhaft kaputtes Postfach den normalen Inbox-Sync fuer immer aussetzen. */
const BACKFILL_MAX_FAILURES = 5;

type BackfillRow = {
  id: string;
  eaccount: string;
  email_type: string;
  starting_after: string | null;
  pages_done: number;
  emails_seen: number;
  failed_attempts: number;
};

type BackfillResult = {
  /** Solange true, setzt der Aufrufer den normalen Inbox-Sync aus. */
  active: boolean;
  seeded?: number;
  worked?: number;
  emailsFound?: number;
  remaining?: number;
  errors?: string[];
};

/**
 * Die Mails nachholen, die vor dem allerersten Sync verschickt wurden.
 *
 * Siehe Migration 0068 fuer den Befund. Kurz: der Wasserstand wurde beim
 * ersten Lauf auf "jetzt" gesetzt, alles davor liegt fuer immer ausserhalb
 * jedes Zeitfensters, das der laufende Sync je abfragt. Am 2026-08-04 fehlten
 * dadurch rund 130 versendete Mails — und mit ihnen rund 110 Kontakte, die
 * im Pipeline-Board weiterhin unter "Neu" standen, obwohl sie angeschrieben
 * waren.
 *
 * Laeuft von allein leer: eine Zeile je Postfach und Richtung, jede haelt
 * ihren Cursor, jeder Tick holt bis zu BACKFILL_REQUEST_BUDGET Seiten. Bei 19
 * Postfaechern sind das 38 Zeilen, meist eine Seite pro Zeile — nach wenigen
 * Minuten ist Ruhe, und danach kostet die Sache eine Indexabfrage pro Minute.
 *
 * WAEHRENDDESSEN PAUSIERT DER NORMALE INBOX-SYNC (Entscheidung des
 * Aufrufers). Das ist kein Verzicht: der Nachlauf geht dieselben Postfaecher
 * von Anfang an durch und sieht damit ohnehin alles, was der laufende Sync
 * sehen wuerde. Beides gleichzeitig wuerde nur das Anfragebudget teilen.
 */
async function runBackfill(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string,
  openaiKey: string | null,
  eaccounts: string[],
  campaignIds: Map<string, string>
): Promise<BackfillResult> {
  const errors: string[] = [];

  // Einmalig anlegen. Dass ueberhaupt Zeilen existieren, IST die Notiz "hier
  // wurde schon nachgeholt" — ein zusaetzliches Datum am Workspace waere eine
  // zweite Wahrheit, die von der ersten abweichen kann.
  const { count: total } = await supabase
    .from("instantly_backfill")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  let seeded = 0;
  if (total === 0 && eaccounts.length > 0) {
    const rows = eaccounts.flatMap((eaccount) =>
      DIRECTIONS.map((d) => ({ workspace_id: workspaceId, eaccount, email_type: d.emailType }))
    );
    const { error } = await supabase.from("instantly_backfill").insert(rows);
    if (error) return { active: false, errors: [`backfill seed: ${error.message}`] };
    seeded = rows.length;
  }

  const { data: due } = await supabase
    .from("instantly_backfill")
    .select("id, eaccount, email_type, starting_after, pages_done, emails_seen, failed_attempts")
    .eq("workspace_id", workspaceId)
    .is("finished_at", null)
    .order("created_at", { ascending: true })
    .limit(BACKFILL_REQUEST_BUDGET);

  const rows = (due ?? []) as BackfillRow[];
  if (rows.length === 0) return { active: false, seeded };

  let emailsFound = 0;
  await Promise.all(
    rows.map(async (row) => {
      const direction = row.email_type === "sent" ? "outbound" : "inbound";
      const params: Record<string, string> = {
        eaccount: row.eaccount,
        email_type: row.email_type,
        mode: "emode_all",
        // Von der aeltesten zur neuesten. Bricht der Nachlauf mittendrin ab,
        // ist damit die aeltere Haelfte schon drin — und genau die ist die,
        // die der laufende Sync nie mehr holen wuerde.
        sort_order: "asc",
      };
      if (row.starting_after) params.starting_after = row.starting_after;

      let page: { items: InstantlyEmail[]; next: string | null };
      try {
        page = await fetchEmails(apiKey, params);
      } catch (e) {
        const failed = row.failed_attempts + 1;
        errors.push(`backfill ${row.eaccount}/${row.email_type}: ${(e as Error).message}`);
        await supabase
          .from("instantly_backfill")
          .update({
            failed_attempts: failed,
            error: (e as Error).message.slice(0, 500),
            finished_at: failed >= BACKFILL_MAX_FAILURES ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        return;
      }

      emailsFound += page.items.length;
      for (const email of page.items) {
        const err = await processEmail(
          supabase,
          workspaceId,
          email,
          direction,
          row.eaccount,
          openaiKey,
          // Keine Benachrichtigung: diese Antworten sind Wochen alt.
          { notify: false, campaignIds }
        );
        if (err) errors.push(err);
      }

      const pagesDone = row.pages_done + 1;
      const done = !page.next || page.items.length === 0 || pagesDone >= BACKFILL_MAX_PAGES;
      await supabase
        .from("instantly_backfill")
        .update({
          starting_after: page.next ?? row.starting_after,
          pages_done: pagesDone,
          emails_seen: row.emails_seen + page.items.length,
          failed_attempts: 0,
          error: pagesDone >= BACKFILL_MAX_PAGES && page.next ? "Seitenlimit erreicht" : null,
          finished_at: done ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    })
  );

  const { count: remaining } = await supabase
    .from("instantly_backfill")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("finished_at", null);

  return { active: true, seeded, worked: rows.length, emailsFound, remaining: remaining ?? 0, errors };
}


/**
 * Der Zustellbarkeits-Waechter, taeglicher Teil: die DNS-Eintraege.
 *
 * Der Torwart prueft einmal, beim Anlegen. Danach kann ein Eintrag jederzeit
 * verschwinden — ein Domain-Umzug, ein aufgeraeumtes Zonefile, ein
 * abgelaufener Vertrag. Ab dem Moment landet jede Mail im Spam, und man merkt
 * es an ausbleibenden Antworten, also gar nicht.
 *
 * Gemeldet wird nur der UEBERGANG (siehe lib/deliverability-watch.ts). Ein
 * offener Alarm bleibt im Dashboard stehen; verschickt wird er einmal.
 */
async function watchDomains(
  supabase: SupabaseClient,
  workspaceId: string,
  eaccounts: string[]
): Promise<{ checked: number; broke: string[]; recovered: string[] }> {
  const domains = [
    ...new Set(
      eaccounts
        .map((e) => {
          const at = e.lastIndexOf("@");
          return at > 0 ? e.slice(at + 1).toLowerCase() : null;
        })
        .filter((d): d is string => Boolean(d))
    ),
  ];
  if (domains.length === 0) return { checked: 0, broke: [], recovered: [] };

  const { data: known } = await supabase
    .from("domain_health")
    .select("domain, spf, dkim, dmarc, checked_at")
    .eq("workspace_id", workspaceId);
  const byDomain = new Map((known ?? []).map((r) => [r.domain as string, r]));

  const now = Date.now();
  const due = domains.filter((d) => domainCheckDue(byDomain.get(d)?.checked_at ?? null, now));
  if (due.length === 0) return { checked: 0, broke: [], recovered: [] };

  const broke: string[] = [];
  const recovered: string[] = [];

  await Promise.all(
    due.map(async (domain) => {
      let current: DomainCheck;
      try {
        const report = await runDeliverabilityCheck(domain);
        current = {
          domain,
          spf: report.spf.status !== "missing",
          dkim: report.dkim.status !== "missing",
          dmarc: report.dmarc.status !== "missing",
        };
      } catch {
        // Eine fehlgeschlagene Abfrage ist keine kaputte Domain. Der Stand
        // bleibt stehen, beim naechsten Lauf wird es erneut versucht — einen
        // Alarm auf einen eigenen Netzfehler zu setzen waere genau die Sorte
        // Fehlalarm, die Alarme entwertet.
        return;
      }

      const previous = byDomain.get(domain);
      const change = domainChange(
        previous ? { domain, spf: previous.spf, dkim: previous.dkim, dmarc: previous.dmarc } : null,
        current
      );

      await supabase.from("domain_health").upsert(
        { workspace_id: workspaceId, ...current, checked_at: new Date().toISOString() },
        { onConflict: "workspace_id,domain" }
      );

      if (change === "broke") {
        broke.push(domain);
        const fehlend = [!current.spf && "SPF", !current.dkim && "DKIM"].filter(Boolean).join(" und ");
        await supabase.from("provider_alerts").upsert(
          {
            workspace_id: workspaceId,
            provider: domain,
            kind: "domain_broken",
            message: `${fehlend} fehlt fuer ${domain}. Bis das behoben ist, landet ein grosser Teil der Mails im Spam.`,
          },
          { onConflict: "workspace_id,provider" }
        );
      }
      if (change === "recovered") {
        recovered.push(domain);
        // Von allein aufloesen: wer den Eintrag repariert hat, soll die
        // Meldung nicht auch noch wegklicken muessen.
        await supabase
          .from("provider_alerts")
          .update({ resolved_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId)
          .eq("provider", domain)
          .eq("kind", "domain_broken")
          .is("resolved_at", null);
      }
    })
  );

  return { checked: due.length, broke, recovered };
}

/**
 * Der Zustellbarkeits-Waechter, laufender Teil: die Bounce-Quote.
 *
 * Ab 5 Prozent greifen die Schutzmechanismen der Empfaenger-Provider, und der
 * Ruf der Absender-Domain traegt es dauerhaft mit. Weiterzusenden ist dann
 * nicht "etwas riskant", sondern der teuerste Fehler in der Kaltakquise — er
 * kostet die Domain, nicht die Kampagne. Gemessen am 2026-08-04 lag eine
 * Kampagne bei 20 Prozent, ohne dass es irgendwo aufgefallen waere.
 *
 * Der Eingriff ist umkehrbar (ein Klick setzt fort), wird per Mail
 * angekuendigt, und wer ihn nicht will, schaltet ihn ab
 * (workspaces.auto_pause_on_bounce, Migration 0072).
 */
async function watchBounces(
  supabase: SupabaseClient,
  workspaceId: string,
  apiKey: string
): Promise<{ paused: string[]; errors: string[] }> {
  const errors: string[] = [];

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("auto_pause_on_bounce")
    .eq("id", workspaceId)
    .single();
  if (workspace?.auto_pause_on_bounce === false) return { paused: [], errors };

  // Die Zahlen haengen an der Suche (instantly_campaign_stats.search_id), die
  // Kampagne an ihrer Instantly-ID. Zusammengefuehrt ueber campaign_searches,
  // weil eine Kampagne seit Migration 0050 aus mehreren Suchen gespeist werden
  // kann — nur search_id anzuschauen wuerde bei genau diesen Kampagnen einen
  // Teil der Bounces uebersehen.
  const [{ data: campaigns }, { data: stats }, { data: links }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, name, instantly_campaign_id, status, search_id")
      .eq("workspace_id", workspaceId)
      .not("instantly_campaign_id", "is", null),
    supabase
      .from("instantly_campaign_stats")
      .select("search_id, emails_sent_count, bounced_count")
      .eq("workspace_id", workspaceId),
    supabase.from("campaign_searches").select("campaign_id, search_id"),
  ]);

  const statBySearch = new Map((stats ?? []).map((s) => [s.search_id as string, s]));
  const searchesFor = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = searchesFor.get(link.campaign_id as string);
    if (list) list.push(link.search_id as string);
    else searchesFor.set(link.campaign_id as string, [link.search_id as string]);
  }

  const states: CampaignBounceState[] = (campaigns ?? []).map((c) => {
    const searchIds = searchesFor.get(c.id as string) ?? (c.search_id ? [c.search_id as string] : []);
    let sent = 0;
    let bounced = 0;
    for (const sid of searchIds) {
      const stat = statBySearch.get(sid);
      sent += stat?.emails_sent_count ?? 0;
      bounced += stat?.bounced_count ?? 0;
    }
    return {
      campaignId: c.id as string,
      name: (c.name as string) ?? "",
      instantlyCampaignId: c.instantly_campaign_id as string,
      sent,
      bounced,
      active: c.status === "active",
    };
  });

  const paused: string[] = [];
  for (const verdict of assessBounces(states).filter((v) => v.shouldPause)) {
    try {
      await instantlyRequest(apiKey, `/api/v2/campaigns/${verdict.instantlyCampaignId}/pause`, {
        method: "POST",
      });
    } catch (e) {
      errors.push(`pause ${verdict.name}: ${(e as Error).message}`);
      // Lokal NICHT als pausiert markieren, wenn Instantly es nicht ist --
      // sonst zeigt die App "angehalten", waehrend weiter gesendet wird.
      continue;
    }

    await supabase.from("campaigns").update({ status: "paused" }).eq("id", verdict.campaignId);
    paused.push(verdict.name);

    await supabase.from("provider_alerts").upsert(
      {
        workspace_id: workspaceId,
        provider: verdict.name,
        kind: "campaign_paused",
        message:
          `Die Kampagne "${verdict.name}" wurde angehalten: ` +
          `${verdict.bounced} von ${verdict.sent} Mails sind zurueckgekommen ` +
          `(${(verdict.rate * 100).toFixed(1)} Prozent).`,
      },
      { onConflict: "workspace_id,provider" }
    );
  }

  return { paused, errors };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Ein von aussen (pg_cron) getriggerter Endpoint darf nie mit einem nackten,
  // body-losen 500 antworten — ohne diesen Rahmen verschluckt Vercel jeden
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

          // KI-Klassifizierung ist optional — fehlt der OpenAI-Key, laeuft der
          // Sync trotzdem, nur ohne ai_interest auf neuen Nachrichten.
          const openaiKey = await getApiKey(supabase, workspaceId, "openai").catch(() => null);

          // Einmal geholt und an beide weitergereicht: die Postfachliste
          // brauchen Nachlauf und Inbox-Sync gleichermassen, und sie kostet
          // eine Anfrage.
          const eaccounts = await listAccounts(apiKey).catch(() => [] as string[]);

          // Vor allem, was Mails verarbeitet: ohne diese Zuordnung bekaeme
          // jede Nachricht Schritt und Variante, aber keine Kampagne.
          const campaignIds = await loadCampaignIds(supabase, workspaceId);

          const [campaigns, backfill] = await Promise.all([
            syncCampaigns(supabase, workspaceId, apiKey, openaiKey, campaignIds),
            runBackfill(supabase, workspaceId, apiKey, openaiKey, eaccounts, campaignIds),
          ]);

          // Solange nachgeholt wird, bleibt der laufende Sync aus — siehe
          // runBackfill. Er wuerde dieselben Postfaecher abfragen und sich
          // nur das Anfragebudget mit dem Nachlauf teilen.
          const inbox = backfill.active
            ? { skipped: "backfill", remaining: backfill.remaining }
            : await syncInbox(supabase, workspaceId, apiKey, openaiKey, eaccounts, campaignIds);

          // Nach dem Sync, nicht davor: die Bounce-Zahlen stammen aus
          // instantly_campaign_stats, und die frischt syncCampaigns gerade
          // auf. Andersherum fiele jede Entscheidung auf dem Stand von gestern.
          const [domains, bounces] = await Promise.all([
            watchDomains(supabase, workspaceId, eaccounts),
            watchBounces(supabase, workspaceId, apiKey),
          ]);

          return { workspaceId, status: "ok", campaigns, backfill, inbox, domains, bounces };
        } catch (e) {
          return { workspaceId, status: "error", message: (e as Error).message };
        }
      })
    );

    // Ausserhalb der Workspace-Schleife: die Alarme haengen nicht an einem
    // Instantly-Schluessel, sondern am Worker. Ein Workspace ohne Instantly
    // taucht in der Schleife oben gar nicht auf, hat aber genauso ein leeres
    // OpenAI-Konto — und soll es genauso erfahren.
    const alertsSent = await notifyProviderAlerts(supabase).catch((e) => {
      console.warn("Guthaben-Warnungen fehlgeschlagen:", (e as Error).message);
      return 0;
    });

    /**
     * Zeitbasierte Automatisierungen (Migration 0066).
     *
     * Haengt hier mit dran, weil dieser Cron ohnehin jede Minute laeuft und
     * ein zweiter Zeitplan ein zweiter Mechanismus waere, der ausfallen kann.
     * Die Bremse sitzt in der Funktion selbst — last_run_at sorgt dafuer,
     * dass daraus ein Tageslauf wird und kein Minutenlauf. Diese Route muss
     * davon nichts wissen und darf deshalb auch nichts daran einstellen.
     *
     * Fehler werden geschluckt: die Automatisierung ist eine Annehmlichkeit,
     * der Mail-Sync darueber ist es nicht.
     */
    // try/catch statt .catch(): supabase-js gibt hier ein PromiseLike zurueck,
    // kein vollstaendiges Promise — eine angehaengte .catch-Kette existiert
    // darauf gar nicht.
    let automations: unknown = null;
    try {
      const { data, error } = await supabase.rpc("run_time_automations");
      if (error) console.warn("Automatisierungen fehlgeschlagen:", error.message);
      else automations = data;
    } catch (e) {
      console.warn("Automatisierungen fehlgeschlagen:", (e as Error).message);
    }

    return NextResponse.json({ workspaces: results.length, results, alertsSent, automations });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
