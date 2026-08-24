/**
 * Aus einem Entwurf wird eine echte Instantly-Kampagne.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DAS HIER STEHT UND NICHT IN DER ROUTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis zum 2026-08-22 stand dieser Ablauf vollstaendig in
 * app/api/instantly/campaigns/route.ts (POST). Seither gehen ihn ZWEI Wege:
 * das Kampagnenformular in der App und das MCP-Werkzeug publish_campaign.
 * Beide laden echte Empfaenger zu einem Drittanbieter hoch. Eine zweite
 * Umsetzung desselben Ablaufs waere die verlaesslichste Art, dass die beiden
 * Wege in einem halben Jahr Unterschiedliches tun -- und die Unterschiede
 * waeren genau die Filter, an denen die CAN-SPAM-Zusage haengt.
 *
 * Der EINZIGE Unterschied zwischen den Aufrufern ist, woher Identitaet und
 * Abo-Status kommen: die Route hat eine Sitzung (getBillingStatus liest
 * auth.getUser()), der MCP-Server hat nur die user_id aus dem Token
 * (getBillingStatusForUser). Deshalb wird der Abo-Status hier
 * HEREINGEREICHT statt selbst geholt -- und trotzdem hier geprueft, damit ihn
 * kein Aufrufer weglassen kann.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import type { BillingStatus } from "@/lib/billing";
import { filterSuppressed } from "@/lib/suppression";
import { pickPrimaryContactPerBusiness, splitByEngagement, splitBySendability } from "@/lib/contacts";
import {
  allVariants,
  buildCampaignSchedule,
  buildCampaignSequence,
  buildInstantlyLead,
  primaryVariant,
  toLocalStatus,
  usesWebsiteFinding,
  WEBSITE_FINDING_FIELD,
  type InstantlyCampaign,
  type SequenceStep,
} from "./campaigns";
import { isCampaignDraft, planDraftTakeover, type CampaignDraftRow } from "./campaign-draft";

/** Die Spalten, an denen haengt, ob eine Kampagne noch ein Entwurf ist
 *  (siehe campaign-draft.ts). */
const DRAFT_COLUMNS = "id, name, status, instantly_campaign_id, activated_at";

/** Ein Kontakt, soweit er fuer den Versand zaehlt. Woertlich die Spalten der
 *  Abfrage unten; businesses ist eingebettet und liefert Firmenname, Website
 *  (fuer die Domain-Sperre) und die Eroeffnungszeile. */
export type CampaignContactRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  business_id: string | null;
  is_primary: boolean;
  outreach_status: string;
  email_verification_status: string | null;
  businesses: {
    name: string | null;
    website: string | null;
    personalization: string | null;
    /** Der Website-Befund als eigener Satz (Migration 0103). LEER IST HAEUFIG
     *  und richtig: kein Befund, keine Website, Seite nicht erreichbar. */
    website_finding: string | null;
  } | null;
};

/** Exportiert, weil die Mail-Vorschau (api/campaigns/preview-leads) dieselben
 *  Zeilen braucht: sie zeigt Leads, die tatsaechlich in die Kampagne gingen,
 *  und muss deshalb durch dieselbe Abfrage und dieselben Filter
 *  (planCampaignLeads) gehen wie der Versand. */
export const CONTACT_COLUMNS =
  "id, email, first_name, last_name, title, business_id, is_primary, outreach_status, email_verification_status, businesses!inner(name, website, personalization, website_finding, search_id)";

/**
 * Leads ohne Website-Befund von einer Sequenz trennen, die ihn benutzt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE STELLE, AN DER DIESES FEATURE TRAEGT ODER PEINLICH WIRD
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Nicht jeder Lead hat einen Befund. Keine Website, Seite nicht erreichbar,
 * oder keine der acht Pruefungen schlaegt an: dann ist businesses.website_finding
 * leer, und das ist ein richtiges Ergebnis, kein Fehler (siehe
 * apps/worker/worker/pipelines/website_finding.py).
 *
 * Es gibt drei Umgangsformen damit, und zwei davon sind schlechter:
 *
 *   Einen Rueckfallsatz einsetzen. Waere eine erfundene Tatsachenbehauptung
 *   ueber eine fremde Website in einer Kaltmail. Genau das tut diese App
 *   nirgends: unbekannte Preise bleiben leer (worker/usage.py), fehlende
 *   Referenzen erzeugen ein Verbot statt einer Erfindung (Migration 0090).
 *
 *   Die leere Variable einfach mitschicken. Instantly setzt dann nichts ein,
 *   und in der Mail steht ein Loch, im schlimmsten Fall ein leerer Absatz
 *   mitten im Text. Es faellt beim Empfaenger auf und sonst nirgends.
 *
 * Deshalb: der Lead geht nicht mit. Das ist derselbe Handgriff, den die App
 * fuer gesperrte, ungueltige und bereits engagierte Adressen ohnehin macht,
 * mit demselben Nachweis im Bericht (skippedWithoutFinding). Und er wird
 * VORHER angesagt: lib/campaign-readiness.ts meldet die Zahl, bevor jemand
 * auf Start drueckt, und die Leadliste kann nach "hat einen Befund" filtern.
 *
 * KEIN Filter, wenn die Sequenz die Variable gar nicht benutzt. Sonst wuerde
 * eine ganz normale Kampagne Leads verlieren, weil irgendwann einmal ein
 * Website-Check nichts gefunden hat.
 */
export function splitByWebsiteFinding(
  rows: CampaignContactRow[],
  sequenceUsesFinding: boolean
): { rows: CampaignContactRow[]; withoutFinding: CampaignContactRow[] } {
  if (!sequenceUsesFinding) return { rows, withoutFinding: [] };
  const withoutFinding = rows.filter((c) => !(c.businesses?.website_finding ?? "").trim());
  const ohneIds = new Set(withoutFinding.map((c) => c.id));
  return { rows: rows.filter((c) => !ohneIds.has(c.id)), withoutFinding };
}

/**
 * Wer aus den Lead-Listen tatsaechlich angeschrieben wird.
 *
 * Rein und ohne Datenbank, damit genau diese Entscheidung testbar bleibt: sie
 * ist die CAN-SPAM-Zusage in Code (lib/instantly/create-campaign.test.ts).
 * Die vier Filter in der Reihenfolge, in der sie seit dem 2026-08-09 in der
 * App stehen:
 *
 * 1. bereits reagiert (splitByEngagement) -- kanalunabhaengig, wer auf
 *    LinkedIn geantwortet hat, faellt hier ebenfalls raus.
 * 2. Sperrliste UND Archiv (filterSuppressed). Das Archiv geht bewusst nur
 *    mit der Adresse durch dieselbe Pruefung, nicht mit der Domain: die
 *    Domain sperrt der Dublettenschutz im Worker, hier waere sie zu grob und
 *    wuerde eine bewusst gewaehlte zweite Ansprechpartnerin derselben Firma
 *    mit ausschliessen.
 * 3. als ungueltig erkannte Adressen (splitBySendability) -- sie bouncen
 *    garantiert und beschaedigen die Reputation der ganzen Domain.
 * 4. eine Person je Firma (pickPrimaryContactPerBusiness), sonst wird die
 *    Firma durchtelefoniert.
 */
export function planCampaignLeads(
  contacts: CampaignContactRow[],
  suppression: { email: string | null; domain: string | null }[],
  archivedEmails: (string | null)[]
): {
  rows: CampaignContactRow[];
  engaged: CampaignContactRow[];
  suppressed: CampaignContactRow[];
  unsendable: CampaignContactRow[];
} {
  const withEmail = contacts.filter((c) => !!c.email);
  const { contactable: notDeclined, engaged } = splitByEngagement(withEmail);
  // Bereits angeschrieben, Liste inzwischen endgueltig geloescht (Migration
  // 0095). Ohne diese Zeilen koennte dieselbe Adresse ueber eine neu gesuchte
  // Liste ein zweites Mal in eine Kampagne rutschen.
  const blocked = [
    ...suppression,
    ...archivedEmails.map((email) => ({ email, domain: null })),
  ];
  const erlaubt = filterSuppressed(notDeclined, blocked);
  const erlaubteIds = new Set(erlaubt.map((c) => c.id));
  const suppressed = notDeclined.filter((c) => !erlaubteIds.has(c.id));
  const { sendable, unsendable } = splitBySendability(erlaubt);
  return { rows: pickPrimaryContactPerBusiness(sendable), engaged, suppressed, unsendable };
}

export type CreateCampaignInput = {
  workspaceId: string;
  name: string;
  searchIds: string[];
  mailboxes: string[];
  steps: SequenceStep[];
  /** 0=Sonntag..6=Samstag, wie JS Date#getDay(). */
  days: number[];
  from: string; // "09:00"
  to: string; // "17:00"
  timezone: string;
  dailyLimit: number | null;
  openTracking: boolean;
  linkTracking: boolean;
  /** Der Entwurf, dessen Zeile weiterverwendet wird, statt eine zweite
   *  anzulegen. Ohne ihn wird er ueber campaign_searches trotzdem gefunden. */
  draftId: string | null;
  /** Alles pruefen und zaehlen, aber nichts anlegen und nichts hochladen. */
  dryRun?: boolean;
};

/**
 * Warum es nicht geht, maschinenlesbar.
 *
 * Die Route braucht nur status und Text (sie zeigt ihn dem Menschen). Der
 * MCP-Server braucht den Grund: seine Meldungen sind englisch und richten sich
 * an ein Modell, das daraus den naechsten Schritt ableiten soll. Ihn aus dem
 * HTTP-Code zu raten ginge nicht -- 400 traegt hier vier verschiedene Faelle.
 */
export type CreateCampaignFailureReason =
  | "subscription_inactive"
  | "missing_fields"
  | "incomplete_variant"
  | "search_not_found"
  | "search_already_linked"
  | "draft_gone"
  | "draft_not_a_draft"
  | "list_has_campaign"
  | "no_sendable_leads"
  | "instantly_failed"
  | "mirror_failed";

/** Was einem Anlegen im Weg steht, ohne dass die Eingabe falsch waere. Im
 *  Probelauf werden diese Punkte GEMELDET statt zu scheitern: er soll sagen,
 *  was fehlt, und nicht beim ersten fehlenden Punkt abbrechen. */
export type CreateCampaignBlocker = "subscription_inactive" | "no_mailboxes";

export type CreateCampaignReport = {
  dryRun: boolean;
  /** Nur im Probelauf gefuellt: ein echter Lauf kommt bis hierher nur, wenn
   *  die Liste leer ist. */
  blockers: CreateCampaignBlocker[];
  /** Im Probelauf die Zeile, die weiterverwendet WUERDE, sonst die angelegte. */
  campaignId: string | null;
  instantlyCampaignId: string | null;
  fromDraft: string | null;
  discardedDrafts: number;
  /** Hochgeladen, im Probelauf: wuerde hochgeladen. */
  leadsAdded: number;
  skippedUnverified: number;
  skippedSuppressed: number;
  skippedEngaged: number;
  /** Zurueckgehalten, weil die Sequenz {{websiteFinding}} benutzt und diese
   *  Leads keinen Befund haben. Immer 0, wenn die Sequenz ihn nicht benutzt. */
  skippedWithoutFinding: number;
  searchIds: string[];
};

export type CreateCampaignResult =
  | ({ ok: true } & CreateCampaignReport)
  /** status ist der HTTP-Code, den die Route daraus macht, reason der Grund
   *  fuer den MCP-Server. error ist der deutsche Satz fuer die Oberflaeche;
   *  bei "instantly_failed" steht darin Instantlys eigene Meldung. */
  | {
      ok: false;
      status: number;
      reason: CreateCampaignFailureReason;
      error: string;
      instantlyCampaignId?: string;
    };

/**
 * Der ganze Ablauf: pruefen, Empfaenger bestimmen, bei Instantly anlegen,
 * Leads hochladen, Spiegel schreiben.
 *
 * @param billing Der Abo-Status des Kontos, das den Aufruf ausloest. Wird
 *   hereingereicht, weil die beiden Aufrufer ihn verschieden ermitteln -- und
 *   hier geprueft, damit ihn keiner vergessen kann.
 */
export async function createInstantlyCampaign(
  supabase: SupabaseClient,
  apiKey: string,
  billing: BillingStatus | null,
  input: CreateCampaignInput
): Promise<CreateCampaignResult> {
  const {
    workspaceId,
    searchIds,
    mailboxes,
    steps,
    days,
    from,
    to,
    timezone,
    dailyLimit,
    openTracking,
    linkTracking,
  } = input;
  const name = input.name?.trim() ?? "";
  const dryRun = input.dryRun === true;

  const blockers: CreateCampaignBlocker[] = [];

  // Gleiche Sperre wie fuer neue Suchen (RLS auf public.searches, Migration
  // 0024), hier zusaetzlich auf App-Ebene, weil das Anlegen einer Kampagne
  // nicht per Direkt-Insert vom Client laeuft. Sie steht VOR dem
  // Instantly-Aufruf, denn genau dort werden Leads zu einem Drittanbieter
  // hochgeladen.
  if (!billing?.isActive) {
    if (!dryRun) {
      return {
        ok: false,
        status: 402,
        reason: "subscription_inactive",
        error:
          "Deine Testphase ist abgelaufen. Bitte waehle einen Plan unter /pricing, um neue Kampagnen anzulegen.",
      };
    }
    blockers.push("subscription_inactive");
  }

  if (!searchIds?.length || !name || !steps?.length || !days?.length || !from || !to || !timezone) {
    return { ok: false, status: 400, reason: "missing_fields", error: "Pflichtfelder fehlen" };
  }
  // Ohne Postfach kann Instantly nichts versenden. Im Probelauf ist das eine
  // Auskunft ("waehle noch Absender aus") und kein Abbruch.
  if (!mailboxes?.length) {
    if (!dryRun) {
      return { ok: false, status: 400, reason: "missing_fields", error: "Pflichtfelder fehlen" };
    }
    blockers.push("no_mailboxes");
  }
  // Jede Fassung muss vollstaendig sein. Eine halb ausgefuellte Variante
  // wuerde bei Instantly als leere Mail an einen Teil der Empfaenger
  // rausgehen, und zwar an einen zufaellig ausgewaehlten.
  if (steps.some((s) => !s.variants?.length || s.variants.some((v) => !v.subject?.trim() || !v.body?.trim()))) {
    return {
      ok: false,
      status: 400,
      reason: "incomplete_variant",
      error: "Jede Variante braucht Betreff und Text.",
    };
  }

  const { data: searches } = await supabase
    .from("searches")
    .select("id, name, query, instantly_campaign_id")
    .in("id", searchIds)
    .eq("workspace_id", workspaceId);
  if (!searches || searches.length !== searchIds.length) {
    return {
      ok: false,
      status: 404,
      reason: "search_not_found",
      error: "Mindestens eine Suche wurde nicht gefunden",
    };
  }
  const alreadyLinked = searches.find((s) => s.instantly_campaign_id);
  if (alreadyLinked) {
    return {
      ok: false,
      status: 409,
      reason: "search_already_linked",
      error: `Suche "${alreadyLinked.name ?? alreadyLinked.query}" hat bereits eine verknuepfte Kampagne.`,
    };
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
  const draftId = input.draftId || null;
  let requestedDraft: CampaignDraftRow | null = null;
  if (draftId) {
    const { data } = await supabase
      .from("campaigns")
      .select(DRAFT_COLUMNS)
      .eq("id", draftId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) {
      return {
        ok: false,
        status: 404,
        reason: "draft_gone",
        error: "Dieser Entwurf existiert nicht mehr. Lege die Kampagne ohne ihn an.",
      };
    }
    requestedDraft = data as unknown as CampaignDraftRow;
    if (!isCampaignDraft(requestedDraft)) {
      return {
        ok: false,
        status: 409,
        reason: "draft_not_a_draft",
        error: `"${requestedDraft.name}" ist kein Entwurf mehr, die Kampagne wurde bereits angelegt. Du findest sie unter Instantly > Kampagnen.`,
      };
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
    return {
      ok: false,
      status: 409,
      reason: "list_has_campaign",
      error: `Diese Lead-Liste speist bereits die Kampagne "${draftPlan.blocked.name}".`,
    };
  }

  const [{ data: contacts }, { data: suppression }, { data: archived }] = await Promise.all([
    supabase
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("businesses.search_id", searchIds)
      .not("email", "is", null)
      .limit(5000),
    supabase.from("suppression_list").select("email, domain").eq("workspace_id", workspaceId),
    supabase.from("contact_archive").select("email").eq("workspace_id", workspaceId).not("email", "is", null),
  ]);

  // Sicherheitsnetz gegen versehentliches erneutes Anschreiben. Die Regeln
  // stehen vollstaendig in planCampaignLeads, damit beide Wege in diese
  // Kampagne (Formular und MCP) durch dieselben vier Filter gehen.
  const { rows: erlaubte, engaged, suppressed, unsendable } = planCampaignLeads(
    (contacts ?? []) as unknown as CampaignContactRow[],
    (suppression ?? []) as { email: string | null; domain: string | null }[],
    ((archived ?? []) as { email: string | null }[]).map((a) => a.email)
  );

  // NACH den vier CAN-SPAM-Filtern und bewusst nicht in planCampaignLeads:
  // das hier ist kein Recht des Empfaengers, sondern eine Frage der
  // Textqualitaet. Begruendung in splitByWebsiteFinding.
  const { rows, withoutFinding } = splitByWebsiteFinding(
    erlaubte,
    usesWebsiteFinding(allVariants(steps))
  );

  if (rows.length === 0 && withoutFinding.length > 0) {
    return {
      ok: false,
      status: 400,
      reason: "no_sendable_leads",
      error:
        `Keine versendbaren Leads: die Sequenz benutzt {{${WEBSITE_FINDING_FIELD}}}, aber ` +
        `keiner der ${withoutFinding.length} Leads hat einen Website-Befund. Entweder die ` +
        "Variable aus der Sequenz nehmen oder eine Liste waehlen, deren Leads eine " +
        "erreichbare Website haben.",
    };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      status: 400,
      reason: "no_sendable_leads",
      error:
        unsendable.length > 0
          ? `Keine versendbaren Leads: alle ${unsendable.length} Adressen sind als ungueltig erkannt, blockiert oder ohne Interesse.`
          : "Keine kontaktierbaren Leads in dieser Suche gefunden (alle bereits blockiert oder ohne Interesse).",
    };
  }
  // Die Zuordnung Spalte -> Instantly-Feld steht bewusst NICHT hier, sondern
  // in buildInstantlyLead (lib/instantly/campaigns.ts). Dieselbe Zuordnung
  // braucht die Mail-Vorschau, und eine abgeschriebene Vorschau zeigt
  // irgendwann etwas anderes, als der Empfaenger bekommt.
  //
  // Leere website_finding-Werte kommen hier nicht mehr an: benutzt die
  // Sequenz die Variable, sind die betroffenen Leads oben schon
  // zurueckgehalten worden.
  const leads = rows.map((c) => buildInstantlyLead(c));

  const bericht: CreateCampaignReport = {
    dryRun,
    blockers,
    campaignId: draftPlan.reuse?.id ?? null,
    instantlyCampaignId: null,
    fromDraft: draftPlan.reuse?.id ?? null,
    discardedDrafts: draftPlan.obsolete.length,
    leadsAdded: leads.length,
    skippedUnverified: unsendable.length,
    skippedSuppressed: suppressed.length,
    skippedEngaged: engaged.length,
    skippedWithoutFinding: withoutFinding.length,
    searchIds,
  };

  // Der Probelauf endet hier, also VOR dem ersten Fremdaufruf: er kostet
  // keinen Instantly-Request und laedt keine Adresse hoch.
  if (dryRun) return { ok: true, ...bericht };

  let instantlyCampaign: InstantlyCampaign;
  try {
    instantlyCampaign = await instantlyRequest<InstantlyCampaign>(apiKey, "/api/v2/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name,
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
      await instantlyRequest(apiKey, "/api/v2/leads/add", {
        method: "POST",
        body: JSON.stringify({ campaign_id: instantlyCampaign.id, leads: chunk }),
      });
    }
  } catch (e) {
    const status = e instanceof InstantlyApiError ? e.status : 500;
    return { ok: false, status, reason: "instantly_failed", error: (e as Error).message };
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
    name,
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
    return {
      ok: false,
      status: 500,
      reason: "mirror_failed",
      error: "Kampagne wurde bei Instantly angelegt, konnte aber nicht lokal gespeichert werden: " + mirrorError,
      instantlyCampaignId: instantlyCampaign.id,
    };
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
  // liest; fuer ALLE verknuepften Suchen gesetzt, nicht nur die erste, damit
  // jede von ihnen im UI korrekt als "verknuepft" erscheint.
  await supabase
    .from("searches")
    .update({ instantly_campaign_id: instantlyCampaign.id })
    .in("id", searchIds)
    .eq("workspace_id", workspaceId);

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

  return {
    ok: true,
    ...bericht,
    campaignId: localCampaignId,
    instantlyCampaignId: instantlyCampaign.id,
  };
}
