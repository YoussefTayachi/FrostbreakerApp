import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertWorkspaceAllowed,
  requireScope,
  SCOPE_DENIED_MESSAGE,
  type McpScope,
} from "@/lib/mcp/authorize";
import { TOOL_DESCRIPTIONS, type ToolName } from "@/lib/mcp/tool-descriptions";
import { wrapUntrusted } from "@/lib/mcp/untrusted";
import { loadFieldDefs } from "@/lib/offer-field-defs";
import { getApiKey } from "@/lib/api-keys";
import { getBillingStatusForUser } from "@/lib/billing";
import { instantlyRequest, InstantlyApiError } from "@/lib/instantly";
import { instantlyHtmlToPlainText, normalizeInstantlyTimezone } from "@/lib/instantly/campaigns";
import {
  campaignFormValueFromDraft,
  classifyLinkedCampaigns,
  type CampaignDraftFormValue,
  type CampaignDraftRow,
  type CampaignDraftStep,
} from "@/lib/instantly/campaign-draft";
import { createInstantlyCampaign, type CreateCampaignResult } from "@/lib/instantly/create-campaign";
import { OFFER_COLUMNS, OFFER_TEXT_FIELDS, type OfferTextField } from "@/lib/offers";

/**
 * Die Werkzeuge, die der MCP-Server anbietet.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DIE DREI SCHRITTE IN JEDEM HANDLER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. assertWorkspaceAllowed(ctx.allowedWorkspaceIds, args.workspace_id)
 * 2. requireScope(ctx.scope, ...)
 * 3. Abfrage mit ausdruecklichem .eq("workspace_id", der GEPRUEFTEN Id)
 *
 * Schritt 3 ist hier keine Gewohnheit wie im uebrigen Frontend, sondern der
 * einzige verbleibende Zaun: der Server laeuft mit Service-Role, RLS sagt also
 * nicht mehr nein (Begruendung in app/api/mcp/route.ts). Wer eine Abfrage ohne
 * diesen Filter schreibt, liefert fremde Daten aus, und kein Test der App
 * bemerkt es.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ARGUMENTPRUEFUNG VON HAND
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Kein zod: das Repo hat es nicht, und eine Abhaengigkeit fuer neunzehn
 * Werkzeuge mit zusammen gut dreissig Argumenten waere ein schlechter Tausch.
 * Die Pruefer unten (readString, readCount, readFlag, readList) sind die
 * einzige Stelle, an der Eingaben angefasst werden.
 *
 * Verstoesse werden WERKZEUGFEHLER (isError: true), keine JSON-RPC-Fehler:
 * ein Modell, das limit=500 schickt, soll den Hinweis lesen und es mit 100
 * nochmal versuchen. Ein Protokollfehler liesse die Verbindung als kaputt
 * erscheinen und beendet den Versuch.
 */

// ─────────────────────────────────────────────────────────────────────────
// Typen
// ─────────────────────────────────────────────────────────────────────────

/** Was die Route aus Token und Mitgliedschaft ermittelt hat. Der Handler
 *  vertraut ausschliesslich diesen Werten, nie den Argumenten. */
export type McpToolContext = {
  allowedWorkspaceIds: string[];
  scope: McpScope | string;
  tokenId: string;
  userId: string;
};

export type ToolCallResult = {
  content: { type: "text"; text: string }[];
  /**
   * Dieselben Daten maschinenlesbar. content[0].text bleibt die Fassung fuer
   * das Modell -- bei den drei Werkzeugen mit Fremdtext ist das der umzaeunte
   * Block, und der ist als Ganzes kein JSON mehr. structuredContent traegt
   * dann die blanke Nutzlast, damit ein Client sie auswerten kann, ohne die
   * Umzaeunung wieder aufzuschneiden.
   *
   * Bei einem Werkzeugfehler bleibt das Feld leer: dort ist der Text die
   * ganze Aussage.
   */
  structuredContent?: unknown;
  isError?: boolean;
};

type ToolArgs = Record<string, unknown>;

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export type McpTool = {
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
  /** Der Scope, den ein Token mitbringen muss. */
  scope: McpScope;
  handler: (
    supabase: SupabaseClient,
    ctx: McpToolContext,
    args: ToolArgs
  ) => Promise<ToolCallResult>;
};

// ─────────────────────────────────────────────────────────────────────────
// Antwortformen
// ─────────────────────────────────────────────────────────────────────────

function ok(text: string, structured?: unknown): ToolCallResult {
  return {
    content: [{ type: "text", text }],
    ...(structured === undefined ? {} : { structuredContent: structured }),
  };
}

function fail(message: string): ToolCallResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function okJson(payload: unknown): ToolCallResult {
  return ok(JSON.stringify(payload, null, 2), payload);
}

/** Fremdtext: umzaeunt fuer das Modell, blank als structuredContent. */
function okUntrusted(label: string, payload: unknown): ToolCallResult {
  return ok(wrapUntrusted(label, payload), payload);
}

/**
 * Ein Datenbankfehler wird zum Werkzeugfehler, aber ohne den Originaltext.
 *
 * Postgres-Meldungen nennen Spalten, Constraints und manchmal Werte. Das
 * gehoert nicht in den Kontext eines fremden Modells; ins Server-Log gehoert
 * es sehr wohl, deshalb der console.error.
 */
function dbFail(werkzeug: string, error: { message?: string } | null): ToolCallResult {
  console.error(`[mcp] ${werkzeug} fehlgeschlagen:`, error?.message ?? error);
  return fail(`The database request for ${werkzeug} failed. Try again; if it persists, check Frostbreaker.`);
}

// ─────────────────────────────────────────────────────────────────────────
// Argumentpruefung
// ─────────────────────────────────────────────────────────────────────────

function readString(args: ToolArgs, key: string): string | null {
  const wert = args[key];
  if (typeof wert !== "string") return null;
  const getrimmt = wert.trim();
  return getrimmt === "" ? null : getrimmt;
}

type CountCheck = { ok: true; value: number } | { ok: false; message: string };

/**
 * limit/offset. Die Grenzen stehen hier UND in TOOL_DESCRIPTIONS; was die
 * Beschreibung als Maximum nennt, muss genau das sein, was hier durchgeht --
 * sonst schickt das Modell eine Zahl, die es fuer erlaubt haelt, und bekommt
 * einen Fehler, den es nicht erklaeren kann.
 */
function readCount(
  args: ToolArgs,
  key: string,
  standard: number,
  max: number
): CountCheck {
  const wert = args[key];
  if (wert === undefined || wert === null) return { ok: true, value: standard };
  if (typeof wert !== "number" || !Number.isFinite(wert) || !Number.isInteger(wert)) {
    return { ok: false, message: `Argument "${key}" must be a whole number.` };
  }
  if (wert < 0) return { ok: false, message: `Argument "${key}" must not be negative.` };
  if (wert > max) {
    return { ok: false, message: `Argument "${key}" must be ${max} or less. Use offset to page through more rows.` };
  }
  return { ok: true, value: wert };
}

/** Ein Ja/Nein-Argument. Fehlt es, gilt der Standard; alles andere als ein
 *  echtes boolean ist ein Fehler und keine Auslegung -- "true" als String
 *  waere geraten, und geraten wird bei einem Schreibwerkzeug nichts. */
function readFlag(
  args: ToolArgs,
  key: string,
  standard: boolean
): { ok: true; value: boolean } | { ok: false; message: string } {
  const wert = args[key];
  if (wert === undefined || wert === null) return { ok: true, value: standard };
  if (typeof wert !== "boolean") {
    return { ok: false, message: `Argument "${key}" must be true or false.` };
  }
  return { ok: true, value: wert };
}

/** Eine Liste von Objekten, mit Deckel. Der Deckel wird VOR jeder anderen
 *  Pruefung gemeldet: wer 300 Eintraege schickt, soll "teile es auf" lesen
 *  und nicht einen Fehler zum 51. Eintrag. */
function readList(
  args: ToolArgs,
  key: string,
  max: number,
  zuVielHinweis: string
): { ok: true; value: Record<string, unknown>[] } | { ok: false; message: string } {
  const wert = args[key];
  if (!Array.isArray(wert)) {
    return { ok: false, message: `Argument "${key}" is required and must be a list.` };
  }
  if (wert.length === 0) {
    return { ok: false, message: `Argument "${key}" must not be empty.` };
  }
  if (wert.length > max) {
    return {
      ok: false,
      message: `Argument "${key}" has ${wert.length} entries, the maximum is ${max}. ${zuVielHinweis}`,
    };
  }
  const eintraege: Record<string, unknown>[] = [];
  for (const [i, eintrag] of wert.entries()) {
    if (typeof eintrag !== "object" || eintrag === null || Array.isArray(eintrag)) {
      return { ok: false, message: `Entry ${i + 1} of "${key}" must be an object.` };
    }
    eintraege.push(eintrag as Record<string, unknown>);
  }
  return { ok: true, value: eintraege };
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
/** Deckel fuer die beiden Werkzeuge ohne eigene Blaetterung (Listen-Uebersicht
 *  und Kampagnenzahlen). Beide liefern je Zeile nur Zahlen und kurze Namen,
 *  keine Freitexte -- 200 Zeilen davon bleiben deutlich unter der
 *  Ausgabegrenze, waehrend 200 LEADS sie reissen wuerden. */
const LIST_CAP = 200;
/**
 * Deckel fuer die Teilsuchen einer gebuendelten Mehrfach-Suche (Migration
 * 0096). Deutlich hoeher als LIST_CAP, weil hier keine Listen stehen, sondern
 * ihre Bestandteile: die Suche vom 2026-08-16 allein hatte 60 (4 Nischen x 15
 * Staedte). Geholt werden je Zeile nur zwei Werte, und sie werden sofort zu
 * einer Zahl je Gruppe verrechnet.
 */
const CHILD_CAP = 1000;
/** Offsets darueber sind kein sinnvoller Aufruf mehr, sondern ein Modell, das
 *  sich verzaehlt hat. Eine Obergrenze verhindert, dass Postgres dafuer eine
 *  Million Zeilen ueberspringt. */
const MAX_OFFSET = 100000;

/**
 * Fremdtext kuerzen.
 *
 * 1200 Zeichen sind rund 300 Token. Bei 100 Leads je Aufruf sind das allein
 * fuer die Zusammenfassungen ~30.000 Token -- und Claude Code bricht eine
 * Werkzeugausgabe bei 25.000 Token HART ab, also mitten im JSON. Das Modell
 * saehe dann nicht "gekuerzt", sondern eine kaputte Antwort. Lieber sichtbar
 * kuerzen als unsichtbar abgeschnitten werden.
 */
const MAX_FOREIGN_TEXT_CHARS = 1200;

/** Ein Icebreaker ist eine Eroeffnungszeile; der Generator im Worker ist auf
 *  35 Woerter begrenzt (Migration 0094). 2000 Zeichen lassen jedem
 *  Handeintrag Luft und fangen trotzdem ab, wenn ein Modell versehentlich
 *  eine ganze Mail hineinschreibt. */
const MAX_ICEBREAKER_CHARS = 2000;

/** Eine Notiz ist ein Gespraechsvermerk, kein Dokument. 5000 Zeichen sind
 *  grosszuegig fuer "telefoniert, will im Q4 nochmal reden" und fangen den
 *  Fall ab, in dem ein Modell einen ganzen Mail-Verlauf hineinkopiert. */
const MAX_NOTE_CHARS = 5000;

/** Ein Angebotsfeld ist ein bis zwei Saetze (siehe die Feldbeschreibungen in
 *  Migration 0090/0093); CUSTOM_VALUE_MAX in lib/copy/offer-custom-fields.ts
 *  deckelt die eigenen Felder aus einer Modellantwort sogar bei 400. Hier
 *  bewusst grosszuegiger, weil ein Mensch ueber MCP auch mal einen laengeren
 *  tone-Text setzen darf -- aber nicht unbegrenzt. */
const MAX_OFFER_VALUE_CHARS = 2000;

/**
 * Wie viele Mails der Verlauf in get_lead hoechstens traegt.
 *
 * Der Verlauf ist der teuerste Teil dieses Servers: 40 Mails à 1200 Zeichen
 * sind bereits rund 12.000 Token, also die Haelfte dessen, was Claude Code
 * ueberhaupt annimmt. Geholt werden die JUENGSTEN 40 und danach chronologisch
 * gedreht -- wer eine Antwort entwirft, braucht das Ende des Gespraechs, nicht
 * seinen Anfang.
 */
const MAX_THREAD_MESSAGES = 40;

/** Notizen sind kurz; dreissig decken jeden realen Lead ab. */
const MAX_NOTES = 30;

/** find_lead. Bewusst ohne Blaetterung: wer mehr als 25 Treffer hat, hat
 *  keinen Suchbegriff, sondern eine Liste -- dafuer gibt es get_leads. */
const MAX_FIND_RESULTS = 25;
/** Kuerzer als das faengt kein Firmenname ein, sondern liefert die halbe
 *  Liste zurueck. */
const MIN_QUERY_CHARS = 2;

/** get_briefing: Standard- und Hoechstfenster in Stunden. 720 = 30 Tage; wer
 *  weiter zurueck will, fragt nicht nach der Lage, sondern nach einer
 *  Auswertung, und dafuer gibt es get_replies mit offset. */
const DEFAULT_SINCE_HOURS = 24;
const MAX_SINCE_HOURS = 720;

/** Deckel innerhalb des Briefings. Es soll eine Seite sein, kein Bericht --
 *  die vollstaendige Fassung liefern get_replies, get_campaign_stats und
 *  list_lead_lists. */
const BRIEFING_CAP = 10;

/**
 * Ab wann eine Bounce-Rate im Briefing auffaellt.
 *
 * 2 % ist die Schwelle, ab der Zustellbarkeit messbar leidet; unter 20
 * gesendeten Mails ist eine Rate keine Rate, sondern ein Zufall (ein Bounce
 * bei fuenf Mails waeren 20 %). Beide Zahlen stehen hier und nicht in der
 * Beschreibung: das Modell soll die Auffaelligkeit gemeldet bekommen, nicht
 * selbst nachrechnen.
 */
const BOUNCE_ALERT_RATE = 0.02;
const BOUNCE_ALERT_MIN_SENT = 20;

/**
 * Die erlaubten Werte von contacts.outreach_status.
 *
 * Woertlich aus dem Check-Constraint in Migration 0018 -- NICHT geraten und
 * nicht erweitert. Waere hier ein Wert zu viel, quittierte Postgres den
 * Schreibvorgang mit einem Constraint-Fehler, den das Modell nicht deuten
 * kann; waere einer zu wenig, fehlte eine Stufe der Pipeline.
 */
/**
 * Der Deckel des einzigen Mengenwerkzeugs.
 *
 * 50 ist keine technische Grenze -- Postgres schriebe auch 500. Es ist die
 * Grenze, ab der ein Mensch den Bestaetigungsdialog seines Clients nicht mehr
 * liest, und genau dieses Lesen ist die Bedingung, unter der ein
 * Mengenwerkzeug hier ueberhaupt vertretbar ist (die vier Bedingungen stehen
 * vollstaendig in lib/mcp/untrusted.ts). Eine Liste mit 300 Leads bleibt
 * deshalb sechs Aufrufe mit sechs Bestaetigungen.
 */
const MAX_BULK_LEADS = 50;

/**
 * Wie viele Protokollzeilen undo_writes je Aufruf zurueckdreht.
 *
 * Dieselbe Zahl wie MAX_BULK_LEADS, und das ist der Punkt: EIN Mengenaufruf
 * laesst sich mit EINEM Aufruf zurueckdrehen. Ausserdem kostet jede Zeile
 * einen Lese- und einen Schreibvorgang; bei mehreren hundert liefe die Route
 * in ihr Zeitlimit, und ein halb durchgelaufenes Zurueckdrehen waere der
 * schlechteste aller Zustaende.
 */
const MAX_UNDO_ROWS = 50;
/** 1440 Minuten = 24 Stunden. Wer weiter zurueck will, nennt die
 *  Protokoll-IDs -- eine Zeitspanne von Tagen trifft zu viel Fremdes. */
const DEFAULT_UNDO_MINUTES = 60;
const MAX_UNDO_MINUTES = 1440;

/** Eine Sequenz mit mehr als zehn Stufen ist keine Sequenz mehr. Das Formular
 *  in der App kennt keine Obergrenze, aber auch niemanden, der je mehr als
 *  fuenf angelegt haette. */
const MAX_SEQUENCE_STEPS = 10;
/** Betreffzeile und Mailtext eines Entwurfsschrittes. Der Text ist der
 *  laengste Wert, den dieser Server annimmt; er wird nicht gekuerzt, sondern
 *  abgelehnt, damit keine halbe Mail in der Datenbank landet. */
const MAX_SUBJECT_CHARS = 300;
const MAX_BODY_CHARS = 10000;
/** Wartezeit vor einem Schritt. 90 Tage sind grosszuegig; alles darueber ist
 *  ein Vertipper (900 statt 9). */
const MAX_WAIT_DAYS = 90;
const MAX_CAMPAIGN_NAME_CHARS = 200;
/** Instantly deckelt selbst nicht sichtbar; 1000 Mails am Tag aus einem
 *  Workspace waeren ohnehin ein Zustellbarkeitsproblem und kein Tageslimit. */
const MAX_DAILY_LIMIT = 1000;

/**
 * Womit ein Kampagnen-ENTWURF anfaengt.
 *
 * Woertlich das, was emptyCampaignFormValue() in
 * app/instantly/campaigns/campaign-form.tsx setzt: Mo-Fr, 09:00-17:00, 50
 * Mails am Tag, kein Zaehlpixel und keine Link-Verfolgung (die bewusste
 * Entscheidung aus Migration 0071 -- Instantlys Vorgabe waere "an" und kostet
 * Zustellbarkeit).
 *
 * NICHT uebernommen ist defaultInstantlyTimezone(): das liest die Zeitzone des
 * BROWSERS, und hier gibt es keinen. Auf dem Server ergaebe es UTC und darueber
 * den Rueckfall "Europe/Belgrade" -- eine erfundene Zeitzone fuer einen
 * deutschsprachigen Kunden. Stattdessen die Vorgabe der Spalte selbst
 * (Migration 0001, 'Europe/Berlin'), sichtbar und mit dem Argument timezone
 * ueberschreibbar.
 */
const CAMPAIGN_DEFAULTS = {
  days: [1, 2, 3, 4, 5],
  send_window_start: "09:00",
  send_window_end: "17:00",
  timezone: "Europe/Berlin",
  daily_limit: 50,
  open_tracking: false,
  link_tracking: false,
} as const;

/**
 * Der Rueckfall fuer campaignFormValueFromDraft in publish_campaign.
 *
 * In der App ist das emptyCampaignFormValue() des Formulars; hier gibt es
 * keinen Browser (siehe die Begruendung an CAMPAIGN_DEFAULTS), also dieselben
 * Vorgaben. Er greift nur fuer Spalten, die am Entwurf leer sind; die Sequenz
 * kann er nicht ersetzen, ein Entwurf ohne Schritte wird vorher abgelehnt.
 */
const LEERES_KAMPAGNENFORMULAR: CampaignDraftFormValue = {
  name: "",
  mailboxes: [],
  steps: [],
  days: [...CAMPAIGN_DEFAULTS.days],
  from: CAMPAIGN_DEFAULTS.send_window_start,
  to: CAMPAIGN_DEFAULTS.send_window_end,
  timezone: CAMPAIGN_DEFAULTS.timezone,
  dailyLimit: String(CAMPAIGN_DEFAULTS.daily_limit),
  openTracking: CAMPAIGN_DEFAULTS.open_tracking,
  linkTracking: CAMPAIGN_DEFAULTS.link_tracking,
};

/** Wie viele Absenderadressen publish_campaign annimmt. Instantly deckelt
 *  email_list nicht sichtbar; zwanzig Postfaecher auf einer Kampagne sind
 *  bereits mehr, als ein Workspace dieser App real hat. */
const MAX_MAILBOXES = 20;

/** "09:00". Genau das Format, das <input type="time"> in der App liefert und
 *  das Postgres als time annimmt. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Die Felder, die undo_writes tatsaechlich zurueckschreiben kann.
 *
 * Bewusst eine Erlaubnisliste und keine Ausschlussliste: was hier nicht steht,
 * wird uebersprungen und im Ergebnis mit Grund genannt. Ein Werkzeug, das
 * "irgendwie schon" versucht, eine unbekannte Spalte zu setzen, waere mit
 * Service-Role die gefaehrlichste Zeile dieses Servers.
 *
 * notes.body fehlt mit Absicht: eine Notiz wird nur ANGEHAENGT, sie hat keinen
 * alten Wert, und mcp_write_log traegt ihre note_id gar nicht (Migration
 * 0100). Sie zurueckzudrehen hiesse loeschen, und es gibt hier bewusst nichts,
 * was loescht. campaigns.* fehlt aus demselben Grund: ein Entwurf wird in der
 * App entfernt, nicht hier.
 */
const UNDOABLE_FIELDS = {
  "businesses.personalization": { table: "businesses", column: "personalization" },
  "contacts.outreach_status": { table: "contacts", column: "outreach_status" },
} as const;

const CONTACT_STATUSES = [
  "new",
  "contacted",
  "replied",
  "meeting_booked",
  "customer",
  "not_interested",
] as const;

const TRUNCATION_MARK = " […truncated by Frostbreaker MCP, open the lead in the app for the full text]";

function shorten(text: unknown): string | null {
  if (typeof text !== "string") return null;
  if (text.length <= MAX_FOREIGN_TEXT_CHARS) return text;
  return text.slice(0, MAX_FOREIGN_TEXT_CHARS) + TRUNCATION_MARK;
}

/** Die Vorarbeit, die jedes Werkzeug ausser list_workspaces leistet. */
function gate(
  ctx: McpToolContext,
  args: ToolArgs,
  needed: McpScope
): { ok: true; workspaceId: string } | { ok: false; result: ToolCallResult } {
  const check = assertWorkspaceAllowed(ctx.allowedWorkspaceIds, args.workspace_id);
  if (!check.ok) return { ok: false, result: fail(check.message) };
  if (!requireScope(ctx.scope, needed)) return { ok: false, result: fail(SCOPE_DENIED_MESSAGE) };
  return { ok: true, workspaceId: check.workspaceId };
}

// ─────────────────────────────────────────────────────────────────────────
// Schema-Bausteine
// ─────────────────────────────────────────────────────────────────────────

const WORKSPACE_PROPERTY = {
  type: "string",
  description: "The workspace id from list_workspaces.",
};

/**
 * Die Spalten von get_leads, zweimal als LITERAL.
 *
 * Zusammengebaut wuerde Supabase die Zeilenform nicht mehr ableiten koennen
 * (GenericStringError, siehe OFFER_COLUMNS in lib/offers.ts). Der einzige
 * Unterschied ist das !inner, mit dem with_linkedin aus der eingebetteten
 * Beziehung eine Bedingung macht.
 */
const LEAD_COLUMNS =
  "id, name, website, company_summary, personalization, decisionmaker_status, hunter_status, created_at, contacts(id, full_name, title, email, seniority, source, linkedin)";
const LEAD_COLUMNS_LINKEDIN =
  "id, name, website, company_summary, personalization, decisionmaker_status, hunter_status, created_at, contacts!inner(id, full_name, title, email, seniority, source, linkedin)";

/** Die Zeile dazu, von Hand: siehe den Kommentar an LEAD_COLUMNS. */
type LeadRow = {
  id: string;
  name: string | null;
  website: string | null;
  company_summary: string | null;
  personalization: string | null;
  decisionmaker_status: string | null;
  hunter_status: string | null;
  created_at: string | null;
  contacts:
    | {
        id: string;
        full_name: string | null;
        title: string | null;
        email: string | null;
        seniority: string | null;
        source: string | null;
        linkedin: string | null;
      }[]
    | null;
};

const READ_ONLY_ANNOTATIONS = (title: string) => ({
  title,
  readOnlyHint: true,
  // Alle Daten stammen aus der eigenen Datenbank; dieser Server ruft keine
  // fremde API auf.
  openWorldHint: false,
});

/**
 * Die Kennzeichnung der schreibenden Werkzeuge.
 *
 * destructiveHint ist bei allen vier false: sie ueberschreiben ein Feld oder
 * legen eine Zeile an, keines loescht etwas -- und es gibt hier bewusst kein
 * Werkzeug, das das koennte.
 *
 * idempotentHint entscheidet der Einzelfall: bei den drei set_*-Werkzeugen
 * ergibt derselbe Aufruf zweimal denselben Zustand, bei add_note stuenden
 * danach zwei gleichlautende Notizen da. Ein Client, der bei einem Zeitablauf
 * wiederholt, muss das unterscheiden koennen.
 */
const WRITE_ANNOTATIONS = (title: string, idempotent: boolean) => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: idempotent,
  openWorldHint: false,
});

// ─────────────────────────────────────────────────────────────────────────
// Die Registry
// ─────────────────────────────────────────────────────────────────────────

export const TOOLS: Record<ToolName, McpTool> = {
  // ── list_workspaces ────────────────────────────────────────────────────
  list_workspaces: {
    title: "List workspaces",
    description: TOOL_DESCRIPTIONS.list_workspaces,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY_ANNOTATIONS("List workspaces"),
    scope: "read",
    async handler(supabase, ctx) {
      if (!requireScope(ctx.scope, "read")) return fail(SCOPE_DENIED_MESSAGE);
      // Das einzige Werkzeug ohne workspace_id -- die Reichweite steht schon
      // fest, sie wird hier nur ausgesprochen.
      if (ctx.allowedWorkspaceIds.length === 0) {
        return okJson({
          workspaces: [],
          note: "This token can reach no workspace. Either its owner is not a member of any workspace, or the token was restricted to a workspace they have since left.",
        });
      }
      const { data, error } = await supabase
        .from("workspaces")
        .select("id, name, created_at")
        .in("id", ctx.allowedWorkspaceIds)
        .order("created_at", { ascending: true });
      if (error) return dbFail("list_workspaces", error);
      return okJson({
        workspaces: (data ?? []).map((w) => ({
          workspace_id: w.id,
          name: w.name,
          created_at: w.created_at,
        })),
      });
    },
  },

  // ── list_lead_lists ────────────────────────────────────────────────────
  list_lead_lists: {
    title: "List lead lists",
    description: TOOL_DESCRIPTIONS.list_lead_lists,
    inputSchema: {
      type: "object",
      properties: { workspace_id: WORKSPACE_PROPERTY },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("List lead lists"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      const [listenAntwort, kinderAntwort, summen] = await Promise.all([
        supabase
          .from("searches")
          // businesses(count) ist die Aggregat-Form von PostgREST: eine Zeile je
          // Suche mit der Anzahl der daran haengenden Firmen, statt N+1 Abfragen.
          //
          // NICHT gegen den Produktivstand geprueft (2026-08-22): dafuer fehlte
          // lokal der Service-Role-Schluessel. Sollte PostgREST die Form nicht
          // annehmen, scheitert die GANZE Abfrage sichtbar (dbFail), sie liefert
          // keine stillen Nullen. Der Ausweg waere dann eine Zaehlabfrage je
          // Zeile mit { count: "exact", head: true } -- durch LIST_CAP gedeckelt
          // und parallel abgesetzt derselbe Aufwand, den die Suchen-Seite
          // ohnehin bei jedem Laden erzeugt.
          .select("id, name, query, location, source, status, created_at, archived_at, instantly_campaign_id, businesses(count)")
          .eq("workspace_id", tor.workspaceId)
          // Der Papierkorb (Migration 0010) ist in der App unsichtbar und soll
          // es hier auch sein.
          .is("deleted_at", null)
          // Teilsuchen einer gebuendelten Mehrfach-Suche (Migration 0096) sind
          // fuer den Nutzer keine eigenen Listen; search_overview blendet sie aus
          // demselben Grund aus. Ohne diese Zeile stuenden hier sechzig
          // Eintraege fuer das, was in der App EINE Liste ist -- und das Modell
          // wuerde sechzigmal get_leads aufrufen.
          .is("parent_search_id", null)
          .order("created_at", { ascending: false })
          .limit(LIST_CAP),

        /**
         * Die Firmen der Teilsuchen, damit die Gruppenzeile nicht mit 0 dasteht.
         *
         * Eine Gruppen-Huelle hat KEINE eigenen Firmen (Migration 0096, Spalte
         * is_search_group); die haengen an ihren Kindern, und die Kinder sind
         * oben ausgeblendet. Ohne diese Abfrage meldete list_lead_lists fuer
         * eine gebuendelte Mehrfach-Suche company_count 0, obwohl 800 Leads
         * darin liegen -- search_overview summiert sie fuer die App aus genau
         * demselben Grund.
         *
         * EINE Abfrage fuer alle Kinder des Workspaces, nicht eine je Gruppe.
         * Der Teilindex searches_parent_idx (Migration 0096) deckt sie ab.
         */
        supabase
          .from("searches")
          .select("parent_search_id, businesses(count)")
          .eq("workspace_id", tor.workspaceId)
          .is("deleted_at", null)
          .not("parent_search_id", "is", null)
          .limit(CHILD_CAP),

        leadTotals(supabase, tor.workspaceId),
      ]);

      if (listenAntwort.error) return dbFail("list_lead_lists", listenAntwort.error);

      const hinweise: string[] = [];

      // Ohne offset in diesem Werkzeug: waere der Deckel erreicht, fehlten
      // Listen, ohne dass es jemandem auffiele. Der Hinweis sagt es.
      const listen = listenAntwort.data ?? [];
      if (listen.length >= LIST_CAP) {
        hinweise.push(
          `Only the ${LIST_CAP} most recent lead lists are shown. Older ones exist in Frostbreaker, and totals below still cover all of them.`
        );
      }

      /**
       * Die Kinder scheitern zu lassen waere der teurere Fehler.
       *
       * Gebuendelte Suchen hat laengst nicht jeder Workspace; die Liste selbst
       * hat aber jeder. Bricht diese eine Abfrage, bleibt company_count fuer
       * eine Gruppe bei 0 -- genau so falsch wie vor dieser Aenderung -- statt
       * dass das ganze Werkzeug ausfaellt. Gesagt wird es trotzdem.
       */
      const kindFirmen = new Map<string, number>();
      if (kinderAntwort.error) {
        console.error("[mcp] list_lead_lists: Teilsuchen fehlgeschlagen:", kinderAntwort.error.message);
        hinweise.push(
          "The sub-searches of bundled searches could not be read, so a bundled lead list may show company_count 0. Open it in Frostbreaker for its real size."
        );
      } else {
        for (const kind of kinderAntwort.data ?? []) {
          const eltern = kind.parent_search_id;
          if (!eltern) continue;
          kindFirmen.set(eltern, (kindFirmen.get(eltern) ?? 0) + leadCount(kind.businesses));
        }
      }

      if (!summen) {
        hinweise.push(
          "The workspace totals could not be counted this time; the per-list numbers below are unaffected."
        );
      }

      return okJson({
        ...(hinweise.length > 0 ? { note: hinweise.join(" ") } : {}),
        /**
         * Die Summen VOR den Listen, und das ist Absicht.
         *
         * Gemessen am 2026-08-22 im Workspace 2d9bb9ae-…: 64 Listen, zusammen
         * 3053 Firmen, 3007 Ansprechpartner, davon 1650 mit E-Mail, und 1916
         * der Firmen liegen in archivierten Listen. Auf "wie viele Leads habe
         * ich" antwortete das Modell 3053 -- richtig gezaehlt, aber meist nicht
         * gefragt: gemeint ist "wie viele kann ich anschreiben" (1650) oder
         * "wie viele sind aktiv" (1137). Dazu musste es ausserdem 64 Zeilen
         * addieren, was eine zweite Fehlerquelle war.
         */
        totals: summen,
        ...(summen ? { totals_note: TOTALS_NOTE } : {}),
        lead_lists: listen.map((s) => ({
          search_id: s.id,
          // searches.name ist optional; die App zeigt dann die Suchanfrage,
          // und ein Modell braucht denselben Ersatz.
          name: s.name ?? s.query,
          query: s.query,
          location: s.location,
          source: s.source,
          status: s.status,
          /**
           * Frueher lead_count. Umbenannt, weil "lead" im Gespraech mal die
           * Firma, mal die Person und mal den anschreibbaren Kontakt meint --
           * gezaehlt wird hier die FIRMA. Ausserhalb dieser Antwort hat das
           * Feld niemand gelesen (nur hier erzeugt, nirgends im Repo
           * verwendet).
           */
          company_count: leadCount(s.businesses) + (kindFirmen.get(s.id) ?? 0),
          archived: s.archived_at !== null,
          in_instantly: Boolean(s.instantly_campaign_id),
          created_at: s.created_at,
        })),
      });
    },
  },

  // ── get_leads ──────────────────────────────────────────────────────────
  get_leads: {
    title: "Get leads",
    description: TOOL_DESCRIPTIONS.get_leads,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        search_id: { type: "string", description: "The lead list id from list_lead_lists." },
        limit: {
          type: "integer",
          description: `How many leads to return. Default ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT}.`,
          minimum: 1,
          maximum: MAX_LIMIT,
        },
        offset: { type: "integer", description: "How many leads to skip.", minimum: 0 },
        without_icebreaker: {
          type: "boolean",
          description: "Only leads that have no icebreaker yet. Default false.",
        },
        with_linkedin: {
          type: "boolean",
          description:
            "Only leads whose contacts have a LinkedIn profile URL, and only those contacts. Default false.",
        },
      },
      required: ["workspace_id", "search_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Get leads"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      const searchId = readString(args, "search_id");
      if (!searchId) return fail('Argument "search_id" is required. Call list_lead_lists to get one.');

      const limit = readCount(args, "limit", DEFAULT_LIMIT, MAX_LIMIT);
      if (!limit.ok) return fail(limit.message);
      if (limit.value === 0) return fail('Argument "limit" must be at least 1.');
      const offset = readCount(args, "offset", 0, MAX_OFFSET);
      if (!offset.ok) return fail(offset.message);
      const ohneIcebreaker = readFlag(args, "without_icebreaker", false);
      if (!ohneIcebreaker.ok) return fail(ohneIcebreaker.message);
      const mitLinkedin = readFlag(args, "with_linkedin", false);
      if (!mitLinkedin.ok) return fail(mitLinkedin.message);

      /**
       * Die Arbeitsliste: "gib mir 25, die noch offen sind".
       *
       * with_linkedin macht aus der eingebetteten Beziehung einen INNER JOIN.
       * Das filtert nicht nur die Firmen, sondern auch die mitgelieferten
       * Kontakte: eine Firma mit drei Kontakten, von denen einer ein
       * LinkedIn-Profil hat, kommt mit genau diesem einen zurueck. Das ist
       * fuer den Zweck richtig (man will das Profil ansehen) und steht
       * deshalb ausdruecklich in der Beschreibung -- wer alle Kontakte
       * braucht, nimmt get_lead.
       *
       * NICHT gegen den Produktivstand geprueft (2026-08-22): dafuer fehlte
       * lokal der Service-Role-Schluessel, dieselbe Luecke wie bei
       * businesses(count) in list_lead_lists. Sollte PostgREST die Form nicht
       * annehmen, scheitert die GANZE Abfrage sichtbar (dbFail); sie liefert
       * keine stillen Teilmengen.
       */
      const spalten = mitLinkedin.value ? LEAD_COLUMNS_LINKEDIN : LEAD_COLUMNS;

      let abfrage = supabase
        .from("businesses")
        .select(spalten, { count: "exact" })
        .eq("workspace_id", tor.workspaceId)
        .eq("search_id", searchId);
      if (ohneIcebreaker.value) abfrage = abfrage.is("personalization", null);
      if (mitLinkedin.value) abfrage = abfrage.not("contacts.linkedin", "is", null);

      const { data, error, count } = await abfrage
        // Zweites Sortierkriterium, damit die Seiten nicht ineinander rutschen:
        // created_at ist bei einem Suchlauf fuer viele Zeilen identisch, und
        // ohne eindeutigen Tie-Break liefert Postgres bei range() nicht
        // zwingend dieselbe Reihenfolge.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset.value, offset.value + limit.value - 1);
      if (error) return dbFail("get_leads", error);

      // Ueber unknown: die Spaltenliste steht erst zur Laufzeit fest, und
      // Supabase leitet die Zeilenform aus dem STRING-LITERAL ab (dieselbe
      // Falle wie bei OFFER_COLUMNS in lib/offers.ts). Die beiden moeglichen
      // Listen unterscheiden sich nur im !inner, die Felder sind identisch.
      const zeilen = (data ?? []) as unknown as LeadRow[];

      const leads = zeilen.map((b) => ({
        business_id: b.id,
        name: b.name,
        website: b.website,
        company_summary: shorten(b.company_summary),
        icebreaker: b.personalization,
        decisionmaker_status: b.decisionmaker_status,
        email_search_status: b.hunter_status,
        contacts: (Array.isArray(b.contacts) ? b.contacts : []).map((c) => ({
          contact_id: c.id,
          full_name: c.full_name,
          title: c.title,
          email: c.email,
          seniority: c.seniority,
          source: c.source,
          // Bei 1449 von 3007 Kontakten dieses Workspaces gefuellt (48 %,
          // gemessen am 2026-08-22). Null heisst "nicht gefunden", nicht
          // "hat kein Profil".
          linkedin: c.linkedin ?? null,
        })),
      }));
      const total = count ?? leads.length;

      return okUntrusted("leads", {
        search_id: searchId,
        total,
        limit: limit.value,
        offset: offset.value,
        has_more: offset.value + leads.length < total,
        // Zurueckgespiegelt, damit im Gespraech nicht untergeht, dass total
        // sich auf die GEFILTERTE Menge bezieht und nicht auf die Liste.
        ...(ohneIcebreaker.value || mitLinkedin.value
          ? {
              filters: {
                without_icebreaker: ohneIcebreaker.value,
                with_linkedin: mitLinkedin.value,
              },
            }
          : {}),
        leads,
      });
    },
  },

  // ── find_lead ──────────────────────────────────────────────────────────
  find_lead: {
    title: "Find lead",
    description: TOOL_DESCRIPTIONS.find_lead,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        query: {
          type: "string",
          description: "Part of a company name or website, matched case-insensitively.",
          minLength: MIN_QUERY_CHARS,
        },
      },
      required: ["workspace_id", "query"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Find lead"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      const query = readString(args, "query");
      if (!query) return fail('Argument "query" is required: part of a company name or website.');
      if (query.length < MIN_QUERY_CHARS) {
        return fail(
          `Argument "query" must be at least ${MIN_QUERY_CHARS} characters. A shorter one matches most of the list instead of a company.`
        );
      }

      /**
       * ZWEI ABFRAGEN STATT EINES .or(), UND ZWAR MIT ABSICHT.
       *
       * PostgRESTs or= nimmt einen FILTERSTRING ("name.ilike.*x*,website.
       * ilike.*x*"). Hier kaeme der Wert aus einem Modell, also aus fremdem
       * Text -- ein Komma oder eine Klammer darin waere kein Suchbegriff mehr,
       * sondern ein zweiter Filter. Die Anfuehrungszeichen-Regeln von
       * PostgREST dafuer exakt zu treffen, waere eine Regel, die niemand
       * nachprueft und die beim naechsten Upgrade still kippt.
       *
       * .ilike(spalte, muster) uebergibt den Wert dagegen als eigenen
       * Abfrageparameter; supabase-js kodiert ihn, und er kann grundsaetzlich
       * kein Filter werden. Der Preis sind zwei Rundreisen -- fuer eine
       * Namenssuche in Ordnung, die Sicherheit ist es nicht wert, hier zu
       * sparen. (In get_lead steht sehr wohl ein .or(): dort stammen ALLE
       * Werte aus der eigenen Datenbank.)
       *
       * Ein * im Suchbegriff bleibt ein Platzhalter. Das ist nuetzlich und
       * ungefaehrlich: die Reichweite haengt am workspace_id-Filter, nicht am
       * Muster.
       */
      const muster = `*${query}*`;
      const spalten = "id, name, website, search_id, searches(name, query)";
      const [nachName, nachWebsite] = await Promise.all([
        supabase
          .from("businesses")
          .select(spalten)
          .eq("workspace_id", tor.workspaceId)
          .ilike("name", muster)
          .order("name", { ascending: true })
          .limit(MAX_FIND_RESULTS),
        supabase
          .from("businesses")
          .select(spalten)
          .eq("workspace_id", tor.workspaceId)
          .ilike("website", muster)
          .order("name", { ascending: true })
          .limit(MAX_FIND_RESULTS),
      ]);
      if (nachName.error) return dbFail("find_lead", nachName.error);
      if (nachWebsite.error) return dbFail("find_lead", nachWebsite.error);

      // Eine Firma, deren Name UND Website passen, steht in beiden Ergebnissen.
      const gesehen = new Set<string>();
      const treffer: Record<string, unknown>[] = [];
      for (const b of [...(nachName.data ?? []), ...(nachWebsite.data ?? [])]) {
        if (gesehen.has(b.id) || treffer.length >= MAX_FIND_RESULTS) continue;
        gesehen.add(b.id);
        const search = firstRelation(b.searches);
        treffer.push({
          business_id: b.id,
          name: b.name,
          website: b.website,
          search_id: b.search_id,
          // searches.name ist optional; die App zeigt dann die Suchanfrage.
          lead_list: search?.name ?? search?.query ?? null,
        });
      }

      return okUntrusted("matches", {
        query,
        // Kein total: die beiden Teilabfragen sind je fuer sich gedeckelt,
        // eine ehrliche Gesamtzahl gaebe es nur mit einer dritten Abfrage.
        // Der Hinweis unten sagt stattdessen, dass es mehr geben KANN.
        count: treffer.length,
        ...(treffer.length >= MAX_FIND_RESULTS
          ? {
              note: `Only the first ${MAX_FIND_RESULTS} matches are shown. Narrow the query if the company is not among them.`,
            }
          : {}),
        matches: treffer,
      });
    },
  },

  // ── get_lead ───────────────────────────────────────────────────────────
  get_lead: {
    title: "Get lead",
    description: TOOL_DESCRIPTIONS.get_lead,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        business_id: { type: "string", description: "The business_id from get_leads or find_lead." },
      },
      required: ["workspace_id", "business_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Get lead"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      const businessId = readString(args, "business_id");
      if (!businessId) {
        return fail('Argument "business_id" is required. Call get_leads or find_lead to get one.');
      }

      const { data: business, error: firmaFehler } = await supabase
        .from("businesses")
        .select(
          "id, name, website, address, phone_national, phone_international, company_summary, personalization, decisionmaker_status, hunter_status, search_id, created_at, searches(name, query), contacts(id, full_name, title, email, outreach_status, seniority, source, linkedin, email_verification_status)"
        )
        .eq("id", businessId)
        .eq("workspace_id", tor.workspaceId)
        .maybeSingle();
      if (firmaFehler) return dbFail("get_lead", firmaFehler);
      if (!business) {
        // Gleiche Formulierung wie bei set_lead_icebreaker: "gibt es nicht"
        // und "gehoert einem anderen Workspace" duerfen sich nicht
        // unterscheiden.
        return fail(
          "Unknown business_id in this workspace. Call get_leads or find_lead for the workspace to get valid ids."
        );
      }

      const kontakte = Array.isArray(business.contacts) ? business.contacts : [];
      const kontaktIds = kontakte.map((c) => c.id as string);

      /**
       * Notizen haengen an der Firma ODER an einem ihrer Kontakte -- genau
       * eines von beiden ist gesetzt (Constraint notes_target_check,
       * Migration 0031). Beide Seiten gehoeren in dieselbe Liste, sonst fehlt
       * dem Verlauf die Haelfte.
       *
       * Hier steht ein .or(), anders als in find_lead: die eingesetzten Werte
       * sind UUIDs aus der Antwort oben, also aus der eigenen Datenbank, und
       * koennen kein Komma und keine Klammer enthalten. Der Filter auf
       * workspace_id steht daneben und wird durch die or-Gruppe nicht
       * aufgeweicht.
       */
      const notizBedingungen = [`business_id.eq.${business.id}`];
      if (kontaktIds.length > 0) notizBedingungen.push(`contact_id.in.(${kontaktIds.join(",")})`);
      const { data: notizen, error: notizFehler } = await supabase
        .from("notes")
        .select("id, body, contact_id, business_id, created_at")
        .eq("workspace_id", tor.workspaceId)
        .or(notizBedingungen.join(","))
        .order("created_at", { ascending: false })
        .limit(MAX_NOTES);
      if (notizFehler) return dbFail("get_lead", notizFehler);

      /**
       * Der Mail-Verlauf, der Grund fuer dieses Werkzeug.
       *
       * messages haengt an contact_id, nicht an business_id (Migration 0019):
       * ohne Kontakte gibt es keinen Verlauf, und dann wird auch nicht
       * gefragt. Sortiert wird ABSTEIGEND und danach gedreht -- bei einem
       * langen Faden sind die juengsten Mails die, gegen die geantwortet wird.
       */
      let verlauf: Record<string, unknown>[] = [];
      let verlaufGekuerzt = false;
      if (kontaktIds.length > 0) {
        const { data: mails, error: mailFehler } = await supabase
          .from("messages")
          .select("id, direction, subject, body, sent_at, created_at, status, ai_interest, step_order, contact_id")
          .eq("workspace_id", tor.workspaceId)
          .in("contact_id", kontaktIds)
          .order("sent_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(MAX_THREAD_MESSAGES);
        if (mailFehler) return dbFail("get_lead", mailFehler);

        const zeilen = mails ?? [];
        verlaufGekuerzt = zeilen.length >= MAX_THREAD_MESSAGES;
        verlauf = zeilen
          .slice()
          .reverse()
          .map((m) => ({
            message_id: m.id,
            direction: m.direction,
            contact_id: m.contact_id,
            subject: m.subject,
            body: shorten(m.body),
            status: m.status,
            // Nur bei eingehenden Mails gesetzt und dort die Einstufung des
            // Antwortassistenten, nicht des Absenders.
            classification: m.ai_interest,
            /** 0-basiert, deckungsgleich mit get_sequence (Migration 0076).
             *  Null heisst "nicht zuordenbar", nicht "Schritt 0". */
            sequence_step: m.step_order,
            at: m.sent_at ?? m.created_at,
          }));
      }

      const search = firstRelation(business.searches);

      return okUntrusted("lead", {
        lead: {
          business_id: business.id,
          name: business.name,
          website: business.website,
          address: business.address,
          phone: business.phone_national ?? business.phone_international,
          company_summary: shorten(business.company_summary),
          icebreaker: business.personalization,
          decisionmaker_status: business.decisionmaker_status,
          email_search_status: business.hunter_status,
          search_id: business.search_id,
          lead_list: search?.name ?? search?.query ?? null,
          created_at: business.created_at,
        },
        contacts: kontakte.map((c) => ({
          contact_id: c.id,
          full_name: c.full_name,
          title: c.title,
          email: c.email,
          email_verification_status: c.email_verification_status,
          outreach_status: c.outreach_status,
          seniority: c.seniority,
          source: c.source,
          linkedin: c.linkedin,
        })),
        notes: (notizen ?? [])
          .slice()
          .reverse()
          .map((n) => ({
            note_id: n.id,
            // Eine Notiz haengt entweder an der Firma oder an einem Kontakt;
            // welches von beidem, aendert ihre Bedeutung.
            scope: n.contact_id ? "contact" : "company",
            contact_id: n.contact_id,
            body: shorten(n.body),
            created_at: n.created_at,
          })),
        ...(verlaufGekuerzt
          ? {
              messages_note: `Only the ${MAX_THREAD_MESSAGES} most recent messages are shown, oldest of those first. Older ones exist in Frostbreaker.`,
            }
          : {}),
        messages: verlauf,
      });
    },
  },

  // ── get_offer ──────────────────────────────────────────────────────────
  get_offer: {
    title: "Get offer",
    description: TOOL_DESCRIPTIONS.get_offer,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        offer_id: {
          type: "string",
          description: "Optional. Without it, the workspace's primary offer is returned.",
        },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Get offer"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      let query = supabase
        .from("offers")
        .select(
          "id, name, offering, icp, problem, outcome, proof, cta, tone, friction, friction_reason, mechanism, preview_asset, review_time, signature, address_form, language, website, is_default, custom_fields, created_at"
        )
        .eq("workspace_id", tor.workspaceId);

      const offerId = readString(args, "offer_id");
      if (offerId) {
        query = query.eq("id", offerId);
      } else {
        // Ohne offer_id das Standardangebot; is_default steht unter einem
        // Teilindex, es gibt also hoechstens eines (Migration 0090).
        query = query.order("is_default", { ascending: false }).order("created_at", { ascending: true });
      }

      const { data, error } = await query.limit(1);
      if (error) return dbFail("get_offer", error);
      const offer = (data ?? [])[0];
      if (!offer) {
        return fail(
          offerId
            ? "No offer with that offer_id in this workspace. Call get_offer without offer_id for the primary offer."
            : "This workspace has no offer yet. It is created in Frostbreaker under Offers."
        );
      }

      // Die Beschriftungen der eigenen Felder: ohne sie waere custom_fields
      // eine Liste aus Schluesseln, die niemand deuten kann (Migration 0098).
      // Ueber loadFieldDefs und nicht ueber eine eigene Abfrage, damit es
      // weiterhin genau eine Stelle gibt, die offer_field_defs kennt (samt
      // Deckel bei MAX_CUSTOM_FIELDS).
      const defs = await loadFieldDefs(supabase, tor.workspaceId);

      return okUntrusted("offer", {
        offer: { ...offer, offer_id: offer.id },
        custom_field_definitions: defs,
      });
    },
  },

  // ── get_sequence ───────────────────────────────────────────────────────
  /**
   * ═════════════════════════════════════════════════════════════════════
   * WO DIE SEQUENZ LIEGT -- NACHGESEHEN, NICHT ANGENOMMEN (2026-08-22)
   * ═════════════════════════════════════════════════════════════════════
   *
   * Die Frage war, ob die Schritte ueberhaupt bei uns stehen. Sie tun es:
   * public.campaign_steps (Migration 0001, urspruenglich fuer die nie gebaute
   * eigene Sende-Engine, seit Migration 0023 als lokaler SPIEGEL der
   * Instantly-Kampagne weiterverwendet) haelt je Schritt step_order,
   * wait_days, subject, body und seit Migration 0071 variants als jsonb.
   * Geschrieben wird die Tabelle beim Anlegen und bei jedem Speichern einer
   * Kampagne (api/instantly/campaigns/route.ts und [id]/route.ts).
   *
   * NICHT hier liegt: was Instantly je Schritt und Variante GEZAEHLT hat. Das
   * kommt live aus /api/v2/campaigns/analytics/steps und braucht den
   * Instantly-Schluessel des Workspaces -- ein Fremdaufruf, der Instantlys
   * Grenze von 20 Anfragen je Minute mitbenutzt. Dieses Werkzeug bleibt
   * deshalb bei den eigenen Daten und sagt in der Beschreibung, dass es der
   * Spiegel ist: wer den Text direkt bei Instantly geaendert hat, sieht die
   * Aenderung hier nicht.
   *
   * campaign_steps hat KEINE workspace_id. Der Zaun laeuft deshalb ueber
   * campaigns: erst die Kampagne mit .eq("workspace_id", …) laden, dann die
   * Schritte zu deren id. Eine Abfrage direkt auf campaign_steps mit einer
   * geratenen campaign_id waere mit Service-Role ein Leck.
   */
  get_sequence: {
    title: "Get sequence",
    description: TOOL_DESCRIPTIONS.get_sequence,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        search_id: {
          type: "string",
          description:
            "Optional. The lead list id from list_lead_lists. Without it, the campaigns of the workspace are listed instead.",
        },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Get sequence"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      const searchId = readString(args, "search_id");

      let kampagnen = supabase
        .from("campaigns")
        .select("id, name, status, search_id, instantly_campaign_id, activated_at, created_at")
        .eq("workspace_id", tor.workspaceId)
        .order("created_at", { ascending: false })
        .limit(LIST_CAP);

      if (searchId) {
        /**
         * Eine Kampagne kann aus MEHREREN Listen gespeist werden
         * (campaign_searches, Migration 0050); campaigns.search_id ist nur die
         * primaere. Ueber die Zuordnungstabelle zu gehen, findet deshalb auch
         * die Kampagne, in der diese Liste die zweite ist.
         *
         * Der Workspace wird VORHER an der Suche geprueft, nicht erst an der
         * Kampagne: campaign_searches traegt selbst keine workspace_id, und
         * eine Abfrage darauf mit einer fremden search_id soll gar nicht erst
         * stattfinden.
         */
        const { data: suche, error: suchFehler } = await supabase
          .from("searches")
          .select("id")
          .eq("id", searchId)
          .eq("workspace_id", tor.workspaceId)
          .maybeSingle();
        if (suchFehler) return dbFail("get_sequence", suchFehler);
        if (!suche) {
          return fail(
            "Unknown search_id in this workspace. Call list_lead_lists for the workspace to get valid ids."
          );
        }

        const { data: zuordnung, error: zuordnungFehler } = await supabase
          .from("campaign_searches")
          .select("campaign_id")
          .eq("search_id", searchId);
        if (zuordnungFehler) return dbFail("get_sequence", zuordnungFehler);

        const ids = (zuordnung ?? []).map((z) => z.campaign_id as string);
        if (ids.length === 0) {
          return fail(
            "This lead list has no campaign in Frostbreaker yet, so there is no sequence to read. It is created under Instantly > Campaigns."
          );
        }
        // Der Workspace-Filter bleibt trotz der geprueften Suche stehen: er ist
        // die Bedingung, die hier tatsaechlich schuetzt.
        kampagnen = kampagnen.in("id", ids);
      }

      const { data: zeilen, error: kampagnenFehler } = await kampagnen;
      if (kampagnenFehler) return dbFail("get_sequence", kampagnenFehler);
      const gefunden = zeilen ?? [];

      // Ohne search_id nur die Uebersicht: die Sequenzen aller Kampagnen auf
      // einmal waeren mehrere zehntausend Zeichen fuer eine Frage, die sich
      // auf eine Liste bezieht.
      if (!searchId) {
        return okJson({
          campaigns: gefunden.map((c) => ({
            campaign_id: c.id,
            name: c.name,
            status: c.status,
            search_id: c.search_id,
            in_instantly: Boolean(c.instantly_campaign_id),
            activated_at: c.activated_at,
          })),
          note: "Call get_sequence again with a search_id to read the steps of one campaign.",
        });
      }

      const schritte = await Promise.all(
        gefunden.map(async (c) => {
          const { data, error } = await supabase
            .from("campaign_steps")
            // Kein workspace_id-Filter moeglich und keiner noetig: c.id kommt
            // aus der Abfrage oben, die auf den Workspace gefiltert war.
            .select("step_order, wait_days, subject, body, variants")
            .eq("campaign_id", c.id)
            .order("step_order", { ascending: true });
          return { campaign: c, data, error };
        })
      );
      const fehler = schritte.find((s) => s.error);
      if (fehler) return dbFail("get_sequence", fehler.error ?? null);

      return okUntrusted("sequence", {
        campaigns: schritte.map(({ campaign, data }) => ({
          campaign_id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          in_instantly: Boolean(campaign.instantly_campaign_id),
          activated_at: campaign.activated_at,
          steps: (data ?? []).map((s) => ({
            /** 0-basiert, deckungsgleich mit messages.step_order in get_lead. */
            step: s.step_order,
            /** Wartezeit VOR diesem Schritt. Instantly fuehrt sie am
             *  vorherigen; die Verschiebung passiert beim Senden
             *  (buildCampaignSequence), gespeichert ist unsere Lesart. */
            wait_days: s.wait_days,
            variants: readVariants(s).map((v, i) => ({
              // 0 = A, wie in Instantlys Oberflaeche.
              variant: String.fromCharCode(65 + i),
              subject: shorten(v.subject),
              body: shorten(v.body),
              // Steht noch da und wird nicht mehr versendet (Migration 0071).
              disabled: v.disabled === true,
            })),
          })),
        })),
      });
    },
  },

  // ── get_campaign_stats ─────────────────────────────────────────────────
  get_campaign_stats: {
    title: "Get campaign stats",
    description: TOOL_DESCRIPTIONS.get_campaign_stats,
    inputSchema: {
      type: "object",
      properties: { workspace_id: WORKSPACE_PROPERTY },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Get campaign stats"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      // Eine Zeile JE SUCHE, nicht je Instantly-Kampagne: search_id ist der
      // Primaerschluessel dieser Tabelle (Migration 0019).
      const { data, error } = await supabase
        .from("instantly_campaign_stats")
        .select(
          "search_id, leads_count, contacted_count, emails_sent_count, open_count, reply_count, reply_count_unique, bounced_count, unsubscribed_count, updated_at, searches(name, query)"
        )
        .eq("workspace_id", tor.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(LIST_CAP);
      if (error) return dbFail("get_campaign_stats", error);

      return okJson({
        lead_lists: (data ?? []).map((row) => {
          const search = firstRelation(row.searches);
          return {
            search_id: row.search_id,
            name: search?.name ?? search?.query ?? null,
            leads: row.leads_count,
            contacted: row.contacted_count,
            emails_sent: row.emails_sent_count,
            opened: row.open_count,
            replied: row.reply_count,
            replied_unique: row.reply_count_unique,
            bounced: row.bounced_count,
            unsubscribed: row.unsubscribed_count,
            // Diese Zahlen sind ein Abzug aus Instantly, kein Live-Stand: der
            // Rollup laeuft ueber pg_cron gegen api/cron/instantly-sync.
            synced_at: row.updated_at,
          };
        }),
      });
    },
  },

  // ── get_replies ────────────────────────────────────────────────────────
  get_replies: {
    title: "Get replies",
    description: TOOL_DESCRIPTIONS.get_replies,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        limit: {
          type: "integer",
          description: `How many replies to return. Default ${DEFAULT_LIMIT}, maximum ${MAX_LIMIT}.`,
          minimum: 1,
          maximum: MAX_LIMIT,
        },
        offset: { type: "integer", description: "How many replies to skip.", minimum: 0 },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Get replies"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      const limit = readCount(args, "limit", DEFAULT_LIMIT, MAX_LIMIT);
      if (!limit.ok) return fail(limit.message);
      if (limit.value === 0) return fail('Argument "limit" must be at least 1.');
      const offset = readCount(args, "offset", 0, MAX_OFFSET);
      if (!offset.ok) return fail(offset.message);

      const { data, error, count } = await supabase
        .from("messages")
        .select(
          "id, subject, body, sent_at, created_at, ai_interest, read_at, contacts(full_name, email, title, businesses(name, website))",
          { count: "exact" }
        )
        .eq("workspace_id", tor.workspaceId)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .range(offset.value, offset.value + limit.value - 1);
      if (error) return dbFail("get_replies", error);

      const replies = (data ?? []).map((m) => {
        const contact = firstRelation(m.contacts);
        const business = contact ? firstRelation(contact.businesses) : null;
        return {
          message_id: m.id,
          company: business?.name ?? null,
          website: business?.website ?? null,
          from_name: contact?.full_name ?? null,
          from_email: contact?.email ?? null,
          from_title: contact?.title ?? null,
          subject: m.subject,
          body: shorten(m.body),
          classification: m.ai_interest,
          read: m.read_at !== null,
          received_at: m.sent_at ?? m.created_at,
        };
      });
      const total = count ?? replies.length;

      return okUntrusted("replies", {
        total,
        limit: limit.value,
        offset: offset.value,
        has_more: offset.value + replies.length < total,
        replies,
      });
    },
  },

  // ── get_briefing ───────────────────────────────────────────────────────
  /**
   * Die Tageslage in EINEM Aufruf.
   *
   * Wofuer: eine Agentur mit fuenf Workspaces fragt morgens fuenfmal
   * "was ist los" -- mit den Einzelwerkzeugen waeren das zwanzig Aufrufe und
   * mehrere zehntausend Token, bevor die erste Entscheidung faellt.
   *
   * Deshalb ist hier ALLES gedeckelt (BRIEFING_CAP) und kein Mailtext dabei,
   * nur Betreff und Absender. Claude Code bricht eine Werkzeugausgabe bei
   * 25.000 Token hart ab, mitten im JSON; ein Briefing, das diese Grenze
   * reisst, ist schlimmer als gar keines, weil das Modell die Antwort fuer
   * vollstaendig haelt.
   */
  get_briefing: {
    title: "Get briefing",
    description: TOOL_DESCRIPTIONS.get_briefing,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        since_hours: {
          type: "integer",
          description: `How far back to look for replies, in hours. Default ${DEFAULT_SINCE_HOURS}, maximum ${MAX_SINCE_HOURS}.`,
          minimum: 1,
          maximum: MAX_SINCE_HOURS,
        },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS("Get briefing"),
    scope: "read",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read");
      if (!tor.ok) return tor.result;

      const stunden = readCount(args, "since_hours", DEFAULT_SINCE_HOURS, MAX_SINCE_HOURS);
      if (!stunden.ok) return fail(stunden.message);
      if (stunden.value === 0) return fail('Argument "since_hours" must be at least 1.');
      const seit = new Date(Date.now() - stunden.value * 3600_000).toISOString();

      const [antworten, kampagnen, suchen, ohneIcebreaker] = await Promise.all([
        /**
         * Abgegrenzt an created_at und nicht an sent_at, anders als
         * get_replies sortiert.
         *
         * sent_at ist der Zeitpunkt beim Absender und darf null sein; eine
         * Mail ohne ihn fiele bei .gte() lautlos aus dem Briefing. created_at
         * ist der Zeitpunkt, an dem der Instantly-Sync sie hier eingetragen
         * hat -- und genau das ist die Frage "was ist seit gestern
         * dazugekommen".
         */
        supabase
          .from("messages")
          .select(
            "id, subject, sent_at, created_at, ai_interest, read_at, contacts(full_name, email, businesses(name))",
            { count: "exact" }
          )
          .eq("workspace_id", tor.workspaceId)
          .eq("direction", "inbound")
          .gte("created_at", seit)
          .order("created_at", { ascending: false })
          .limit(BRIEFING_CAP),

        supabase
          .from("instantly_campaign_stats")
          .select("search_id, emails_sent_count, bounced_count, reply_count_unique, searches(name, query)")
          .eq("workspace_id", tor.workspaceId)
          .limit(LIST_CAP),

        supabase
          .from("searches")
          .select("id, name, query, location, status, created_at")
          .eq("workspace_id", tor.workspaceId)
          .in("status", ["pending", "running"])
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(BRIEFING_CAP),

        /**
         * Nur die Zahl, ohne Zeilen (head: true).
         *
         * Gezaehlt werden FIRMEN, nicht Personen: der Icebreaker haengt an
         * businesses.personalization, eine Firma mit drei Ansprechpartnern hat
         * genau einen. Der Feldname sagt das seit dem 2026-08-22 auch --
         * "leads_without_icebreaker" liess offen, ob Firmen oder Kontakte
         * gemeint sind, und genau diese Verwechslung ist der Grund, warum
         * list_lead_lists jetzt ein totals-Objekt liefert.
         *
         * Gezaehlt wird ueber ALLE Listen des Workspaces, auch archivierte und
         * laengst versendete -- ein Join auf searches waere hier eine zweite
         * Bedingung, die niemand nachprueft. Der Hinweis im Ergebnis sagt es
         * ausdruecklich, statt eine Zahl auszugeben, die praeziser aussieht,
         * als sie ist.
         */
        supabase
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", tor.workspaceId)
          .is("personalization", null),
      ]);

      if (antworten.error) return dbFail("get_briefing", antworten.error);
      if (kampagnen.error) return dbFail("get_briefing", kampagnen.error);
      if (suchen.error) return dbFail("get_briefing", suchen.error);
      if (ohneIcebreaker.error) return dbFail("get_briefing", ohneIcebreaker.error);

      const neueAntworten = antworten.data ?? [];
      const gesamtAntworten = antworten.count ?? neueAntworten.length;

      // Die Auffaelligkeit wird HIER berechnet und nicht dem Modell
      // ueberlassen: eine Rate, die jeder selbst ausrechnet, wird von jedem
      // anders bewertet.
      const auffaellig = (kampagnen.data ?? [])
        .map((row) => {
          const gesendet = row.emails_sent_count ?? 0;
          const bounces = row.bounced_count ?? 0;
          const search = firstRelation(row.searches);
          return {
            search_id: row.search_id,
            name: search?.name ?? search?.query ?? null,
            emails_sent: gesendet,
            bounced: bounces,
            bounce_rate: gesendet > 0 ? Math.round((bounces / gesendet) * 1000) / 10 : 0,
            replied_unique: row.reply_count_unique ?? 0,
          };
        })
        .filter(
          (c) =>
            c.emails_sent >= BOUNCE_ALERT_MIN_SENT &&
            c.bounced / c.emails_sent >= BOUNCE_ALERT_RATE
        )
        .sort((a, b) => b.bounce_rate - a.bounce_rate)
        .slice(0, BRIEFING_CAP);

      return okUntrusted("briefing", {
        workspace_id: tor.workspaceId,
        since_hours: stunden.value,
        since: seit,
        replies: {
          total: gesamtAntworten,
          unread: neueAntworten.filter((m) => m.read_at === null).length,
          ...(gesamtAntworten > neueAntworten.length
            ? { note: `Showing ${neueAntworten.length} of ${gesamtAntworten}. Call get_replies for the rest and for the message text.` }
            : {}),
          // Ohne Mailtext: das Briefing sagt, DASS etwas da ist. Der Text
          // steht in get_replies und get_lead, wo die Umzaeunung um genau
          // eine Antwort herum liegt.
          items: neueAntworten.map((m) => {
            const contact = firstRelation(m.contacts);
            const business = contact ? firstRelation(contact.businesses) : null;
            return {
              message_id: m.id,
              company: business?.name ?? null,
              from_name: contact?.full_name ?? null,
              from_email: contact?.email ?? null,
              subject: m.subject,
              classification: m.ai_interest,
              read: m.read_at !== null,
              received_at: m.sent_at ?? m.created_at,
            };
          }),
        },
        campaign_alerts: {
          note: `Lead lists that sent at least ${BOUNCE_ALERT_MIN_SENT} emails with a bounce rate of ${BOUNCE_ALERT_RATE * 100}% or more. An empty list means nothing stood out.`,
          items: auffaellig,
        },
        running_searches: (suchen.data ?? []).map((s) => ({
          search_id: s.id,
          name: s.name ?? s.query,
          location: s.location,
          status: s.status,
          started_at: s.created_at,
        })),
        companies_without_icebreaker: {
          count: ohneIcebreaker.count ?? 0,
          note: "Counted in companies, not in contacts: an icebreaker belongs to the company, so a company with three contacts has one. Counted across every lead list of this workspace, including archived ones. Call list_lead_lists for the workspace totals in companies, contacts and contacts with an email address.",
        },
      });
    },
  },

  // ── set_lead_icebreaker ────────────────────────────────────────────────
  set_lead_icebreaker: {
    title: "Set lead icebreaker",
    description: TOOL_DESCRIPTIONS.set_lead_icebreaker,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        business_id: { type: "string", description: "The business_id from get_leads." },
        icebreaker: { type: "string", description: "The new opening line to store." },
      },
      required: ["workspace_id", "business_id", "icebreaker"],
      additionalProperties: false,
    },
    // Zweimal derselbe Text ergibt denselben Zustand.
    annotations: WRITE_ANNOTATIONS("Set lead icebreaker", true),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const businessId = readString(args, "business_id");
      if (!businessId) return fail('Argument "business_id" is required. Call get_leads to get one.');
      const icebreaker = args.icebreaker;
      if (typeof icebreaker !== "string") {
        return fail('Argument "icebreaker" is required and must be a string.');
      }
      if (icebreaker.length > MAX_ICEBREAKER_CHARS) {
        return fail(
          `Argument "icebreaker" is longer than ${MAX_ICEBREAKER_CHARS} characters. An opening line is one or two sentences.`
        );
      }

      // Erst lesen: ohne den alten Wert liesse sich im Protokoll hinterher
      // nicht sagen, was ein missverstandener Prompt ueberschrieben hat.
      const { data: vorher, error: leseFehler } = await supabase
        .from("businesses")
        .select("id, name, personalization")
        .eq("id", businessId)
        .eq("workspace_id", tor.workspaceId)
        .maybeSingle();
      if (leseFehler) return dbFail("set_lead_icebreaker", leseFehler);
      if (!vorher) {
        // Gleiche Formulierung fuer "gibt es nicht" und "gehoert einem anderen
        // Workspace" -- sonst liesse sich durch Durchprobieren ablesen, welche
        // business_ids existieren.
        return fail(
          "Unknown business_id in this workspace. Call get_leads for the workspace to get valid ids."
        );
      }

      const { error: schreibFehler } = await supabase
        .from("businesses")
        .update({ personalization: icebreaker })
        .eq("id", businessId)
        // BEIDE Bedingungen, nicht nur die id: die id allein wuerde mit
        // Service-Role jede Zeile der Datenbank treffen.
        .eq("workspace_id", tor.workspaceId);
      if (schreibFehler) return dbFail("set_lead_icebreaker", schreibFehler);

      await protokolliere(supabase, ctx, tor.workspaceId, {
        business_id: businessId,
        field: "businesses.personalization",
        old_value: vorher.personalization ?? null,
        new_value: icebreaker,
      });

      return okJson({
        business_id: businessId,
        company: vorher.name,
        previous_icebreaker: vorher.personalization ?? null,
        icebreaker,
        written: true,
      });
    },
  },

  // ── set_lead_icebreakers ───────────────────────────────────────────────
  /**
   * ═════════════════════════════════════════════════════════════════════
   * DAS EINZIGE MENGENWERKZEUG, UND WORAN ES HAENGT
   * ═════════════════════════════════════════════════════════════════════
   *
   * Zweimal abgelehnt, beim dritten Mal gebaut -- unter vier Bedingungen, die
   * vollstaendig in lib/mcp/untrusted.ts begruendet sind: namentliche
   * Einzeleintraege statt eines Filters, Deckel bei MAX_BULK_LEADS,
   * Probelauf ueber dry_run, Umkehrbarkeit ueber undo_writes. Wer eine davon
   * hier herausnimmt, nimmt die Begruendung mit.
   *
   * ALLES ODER NICHTS: eine fremde oder doppelte business_id laesst den
   * ganzen Aufruf scheitern. Die gueltigen zu schreiben und den Rest
   * stillschweigend zu ueberspringen waere bei einer Menge die schlechtere
   * Auskunft -- niemand liest bei 50 Zeilen nach, welche zwei fehlen.
   */
  set_lead_icebreakers: {
    title: "Set lead icebreakers",
    description: TOOL_DESCRIPTIONS.set_lead_icebreakers,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        leads: {
          type: "array",
          description: `The leads to write, each named by its own business_id. At most ${MAX_BULK_LEADS} per call.`,
          minItems: 1,
          maxItems: MAX_BULK_LEADS,
          items: {
            type: "object",
            properties: {
              business_id: { type: "string", description: "The business_id from get_leads." },
              icebreaker: { type: "string", description: "The new opening line for this lead." },
            },
            required: ["business_id", "icebreaker"],
            additionalProperties: false,
          },
        },
        dry_run: {
          type: "boolean",
          description: "True writes nothing and returns what would change. Default false.",
        },
      },
      required: ["workspace_id", "leads"],
      additionalProperties: false,
    },
    // Dieselbe Liste zweimal ergibt denselben Zustand.
    annotations: WRITE_ANNOTATIONS("Set lead icebreakers", true),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const liste = readList(
        args,
        "leads",
        MAX_BULK_LEADS,
        `Split it up: ${MAX_BULK_LEADS} leads per call, six calls for 300 leads.`
      );
      if (!liste.ok) return fail(liste.message);
      const probelauf = readFlag(args, "dry_run", false);
      if (!probelauf.ok) return fail(probelauf.message);

      const eintraege: { business_id: string; icebreaker: string }[] = [];
      const gesehen = new Set<string>();
      for (const [i, eintrag] of liste.value.entries()) {
        const businessId = readString(eintrag, "business_id");
        if (!businessId) {
          return fail(`Entry ${i + 1} of "leads" needs a non-empty "business_id" from get_leads.`);
        }
        // Zweimal dieselbe Firma in einer Liste: welcher der beiden Texte
        // gewinnen soll, kann niemand aus der Liste ablesen -- und im
        // Protokoll stuenden zwei Zeilen, von denen eine luegt.
        if (gesehen.has(businessId)) {
          return fail(
            `business_id "${businessId}" appears twice in "leads". Every lead may be named once per call; nothing was written.`
          );
        }
        gesehen.add(businessId);
        const icebreaker = eintrag.icebreaker;
        if (typeof icebreaker !== "string") {
          return fail(`Entry ${i + 1} of "leads" needs "icebreaker" as a string.`);
        }
        if (icebreaker.length > MAX_ICEBREAKER_CHARS) {
          return fail(
            `The icebreaker of entry ${i + 1} is longer than ${MAX_ICEBREAKER_CHARS} characters. An opening line is one or two sentences.`
          );
        }
        eintraege.push({ business_id: businessId, icebreaker });
      }

      /**
       * EINE Abfrage fuer alle IDs, vor jedem Schreibvorgang.
       *
       * 50 Einzelpruefungen waeren 50 Rundreisen und -- schlimmer -- die
       * Versuchung, nach der zehnten Pruefung schon zu schreiben. So steht
       * vorher fest, ob der ganze Aufruf durchgehen darf.
       */
      const ids = eintraege.map((e) => e.business_id);
      const { data: gefunden, error: leseFehler } = await supabase
        .from("businesses")
        .select("id, name, personalization")
        .eq("workspace_id", tor.workspaceId)
        .in("id", ids);
      if (leseFehler) return dbFail("set_lead_icebreakers", leseFehler);

      const bekannt = new Map((gefunden ?? []).map((b) => [b.id as string, b]));
      const fremd = ids.filter((id) => !bekannt.has(id));
      if (fremd.length > 0) {
        // Gleiche Formulierung wie ueberall: "gibt es nicht" und "gehoert
        // einem anderen Workspace" duerfen sich nicht unterscheiden. Die IDs
        // selbst zu nennen ist kein Orakel -- sie kommen aus dem Aufruf.
        return fail(
          `${fremd.length} of ${ids.length} business_ids are not in this workspace: ${fremd.slice(0, 5).join(", ")}${fremd.length > 5 ? ", …" : ""}. Nothing was written. Call get_leads for the workspace to get valid ids.`
        );
      }

      const geplant = eintraege.map((e) => {
        const zeile = bekannt.get(e.business_id)!;
        return {
          business_id: e.business_id,
          company: (zeile.name as string | null) ?? null,
          previous_icebreaker: (zeile.personalization as string | null) ?? null,
          icebreaker: e.icebreaker,
          // Ein Text, der schon dasteht, ist kein Schreibvorgang. Das
          // mitzuzaehlen waere eine Zahl, die groesser klingt als die
          // Aenderung.
          unchanged: (zeile.personalization ?? null) === e.icebreaker,
        };
      });

      if (probelauf.value) {
        return okJson({
          dry_run: true,
          written: false,
          count: geplant.length,
          would_change: geplant.filter((g) => !g.unchanged).length,
          note: "Nothing was written. Call again without dry_run to write these values.",
          changes: geplant.map(beschreibeIcebreaker),
        });
      }

      /**
       * Nacheinander und nicht parallel.
       *
       * 50 gleichzeitige Updates waeren ein Stoss auf denselben Verbindungs-
       * pool, den die App fuer echte Seitenaufrufe braucht, und der Gewinn
       * waere eine halbe Sekunde. Faellt einer aus, laufen die uebrigen
       * trotzdem durch und stehen einzeln im Ergebnis: ein Abbruch mitten
       * drin haette einen Zustand hinterlassen, den niemand mehr benennen
       * kann.
       */
      const geschrieben: typeof geplant = [];
      const fehlgeschlagen: { business_id: string; company: string | null }[] = [];
      for (const eintrag of geplant) {
        const { error } = await supabase
          .from("businesses")
          .update({ personalization: eintrag.icebreaker })
          .eq("id", eintrag.business_id)
          // Beide Bedingungen, wie ueberall: die id allein traefe mit
          // Service-Role jede Zeile der Datenbank.
          .eq("workspace_id", tor.workspaceId);
        if (error) {
          console.error(`[mcp] set_lead_icebreakers: ${eintrag.business_id} nicht geschrieben:`, error.message);
          fehlgeschlagen.push({ business_id: eintrag.business_id, company: eintrag.company });
          continue;
        }
        geschrieben.push(eintrag);
      }

      if (geschrieben.length === 0) {
        return fail(
          "None of the leads could be written. Nothing changed. Try again; if it persists, check Frostbreaker."
        );
      }

      // EINE Protokollzeile je geschriebenem Lead, in einem einzigen Insert:
      // die Spur ist genauso fein wie bei set_lead_icebreaker, kostet aber
      // eine Rundreise statt fuenfzig.
      await protokolliereViele(
        supabase,
        ctx,
        tor.workspaceId,
        geschrieben.map((g) => ({
          business_id: g.business_id,
          field: "businesses.personalization",
          old_value: g.previous_icebreaker,
          new_value: g.icebreaker,
        }))
      );

      return okJson({
        dry_run: false,
        written: geschrieben.length,
        count: geplant.length,
        ...(fehlgeschlagen.length > 0
          ? {
              failed: fehlgeschlagen,
              note: `${fehlgeschlagen.length} leads could not be written. The others were. Call again with only the failed ones; writing the same text twice changes nothing.`,
            }
          : {}),
        undo_hint: "Call undo_writes to put the previous icebreakers back.",
        changes: geschrieben.map(beschreibeIcebreaker),
      });
    },
  },

  // ── set_contact_status ─────────────────────────────────────────────────
  set_contact_status: {
    title: "Set contact status",
    description: TOOL_DESCRIPTIONS.set_contact_status,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        contact_id: { type: "string", description: "The contact_id from get_lead or get_leads." },
        status: {
          type: "string",
          description: "The new outreach status.",
          enum: [...CONTACT_STATUSES],
        },
      },
      required: ["workspace_id", "contact_id", "status"],
      additionalProperties: false,
    },
    // Zweimal derselbe Status ergibt denselben Zustand. Der Trigger aus
    // Migration 0032 schreibt beim zweiten Mal nichts mehr in die Historie:
    // er prueft "is distinct from".
    annotations: WRITE_ANNOTATIONS("Set contact status", true),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const contactId = readString(args, "contact_id");
      if (!contactId) return fail('Argument "contact_id" is required. Call get_lead to get one.');

      const status = readString(args, "status");
      if (!status || !(CONTACT_STATUSES as readonly string[]).includes(status)) {
        return fail(
          `Argument "status" must be one of: ${CONTACT_STATUSES.join(", ")}. Nothing else is accepted.`
        );
      }

      /**
       * DER FILTER LAEUFT UEBER BEIDE SEITEN.
       *
       * contacts traegt zwar eine eigene workspace_id (Migration 0001, not
       * null), aber sie ist eine Kopie: die verbindliche Zugehoerigkeit
       * entsteht ueber business_id. Weichen beide je auseinander -- ein
       * fehlerhafter Import, ein spaeterer Umbau --, waere der Filter auf die
       * Spalte allein die falsche Bedingung, und mit Service-Role haelt
       * nichts sonst eine geratene contact_id auf.
       *
       * businesses!inner erzwingt den Join, .eq("businesses.workspace_id", …)
       * filtert darueber. Beide Bedingungen stehen bewusst nebeneinander.
       */
      const { data: vorher, error: leseFehler } = await supabase
        .from("contacts")
        .select("id, full_name, email, outreach_status, business_id, businesses!inner(id, name, workspace_id)")
        .eq("id", contactId)
        .eq("workspace_id", tor.workspaceId)
        .eq("businesses.workspace_id", tor.workspaceId)
        .maybeSingle();
      if (leseFehler) return dbFail("set_contact_status", leseFehler);
      if (!vorher) {
        return fail(
          "Unknown contact_id in this workspace. Call get_lead for the company to get valid contact ids."
        );
      }

      const { error: schreibFehler } = await supabase
        .from("contacts")
        .update({ outreach_status: status })
        .eq("id", contactId)
        // Beide Bedingungen, nicht nur die id: mit Service-Role traefe die id
        // allein jede Zeile der Datenbank.
        .eq("workspace_id", tor.workspaceId);
      if (schreibFehler) return dbFail("set_contact_status", schreibFehler);

      await protokolliere(supabase, ctx, tor.workspaceId, {
        contact_id: contactId,
        field: "contacts.outreach_status",
        old_value: vorher.outreach_status ?? null,
        new_value: status,
      });

      const business = firstRelation(vorher.businesses);
      return okJson({
        contact_id: contactId,
        contact: vorher.full_name ?? vorher.email,
        company: business?.name ?? null,
        previous_status: vorher.outreach_status ?? null,
        status,
        written: true,
        // Damit im Gespraech nicht unterschlagen wird, dass hier mehr passiert
        // als eine Spalte: der Trigger aus Migration 0066 kann eine Aufgabe
        // anlegen.
        note:
          status === "replied" || status === "meeting_booked"
            ? "Frostbreaker may have created a follow-up task for this contact, depending on the workspace's automation rules."
            : undefined,
      });
    },
  },

  // ── add_note ───────────────────────────────────────────────────────────
  add_note: {
    title: "Add note",
    description: TOOL_DESCRIPTIONS.add_note,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        business_id: {
          type: "string",
          description: "The company the note belongs to. Give either this or contact_id, not both.",
        },
        contact_id: {
          type: "string",
          description: "The person the note belongs to. Give either this or business_id, not both.",
        },
        body: { type: "string", description: "The note text." },
      },
      required: ["workspace_id", "body"],
      additionalProperties: false,
    },
    // Nicht idempotent: zweimal aufgerufen stehen zwei Notizen da, und es gibt
    // hier kein Werkzeug, das eine davon wieder entfernt.
    annotations: WRITE_ANNOTATIONS("Add note", false),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const businessId = readString(args, "business_id");
      const contactId = readString(args, "contact_id");
      // Genau eines von beiden -- so steht es im Constraint
      // notes_target_check (Migration 0031). Die Pruefung hier ist keine
      // Dopplung, sondern die Uebersetzung des Constraints in einen Satz, den
      // das Modell lesen und befolgen kann; Postgres wuerde nur eine
      // Verletzung melden, die dbFail bewusst nicht durchreicht.
      if (businessId && contactId) {
        return fail(
          'Give either "business_id" or "contact_id", not both. A note belongs to the whole company or to one person.'
        );
      }
      if (!businessId && !contactId) {
        return fail(
          'One of "business_id" or "contact_id" is required. Call get_lead to get either.'
        );
      }

      const body = args.body;
      if (typeof body !== "string" || body.trim() === "") {
        return fail('Argument "body" is required and must not be empty.');
      }
      if (body.length > MAX_NOTE_CHARS) {
        return fail(
          `Argument "body" is longer than ${MAX_NOTE_CHARS} characters. A note is a remark, not a document.`
        );
      }

      // Das Ziel muss diesem Workspace gehoeren, BEVOR die Zeile entsteht:
      // mit Service-Role wuerde eine geratene id sonst eine Notiz an einem
      // fremden Lead anlegen, die dessen Besitzer im CRM zu sehen bekaeme.
      let company: string | null = null;
      let contact: string | null = null;
      if (businessId) {
        const { data, error } = await supabase
          .from("businesses")
          .select("id, name")
          .eq("id", businessId)
          .eq("workspace_id", tor.workspaceId)
          .maybeSingle();
        if (error) return dbFail("add_note", error);
        if (!data) {
          return fail(
            "Unknown business_id in this workspace. Call get_leads or find_lead for the workspace to get valid ids."
          );
        }
        company = data.name;
      } else {
        const { data, error } = await supabase
          .from("contacts")
          // Wie bei set_contact_status ueber businesses mitgeprueft.
          .select("id, full_name, email, businesses!inner(name, workspace_id)")
          .eq("id", contactId!)
          .eq("workspace_id", tor.workspaceId)
          .eq("businesses.workspace_id", tor.workspaceId)
          .maybeSingle();
        if (error) return dbFail("add_note", error);
        if (!data) {
          return fail(
            "Unknown contact_id in this workspace. Call get_lead for the company to get valid contact ids."
          );
        }
        contact = data.full_name ?? data.email ?? null;
        company = firstRelation(data.businesses)?.name ?? null;
      }

      const { data: angelegt, error: schreibFehler } = await supabase
        .from("notes")
        .insert({
          workspace_id: tor.workspaceId,
          business_id: businessId,
          contact_id: contactId,
          body,
          /**
           * notes.author_user_id hat "default auth.uid()" (Migration 0031),
           * damit der Client den Autor nicht faelschen kann. Hier ist
           * auth.uid() NULL -- der Server laeuft mit Service-Role und ohne
           * Session. Ohne diese Zeile stuende die Notiz im CRM ohne Verfasser
           * da. ctx.userId kommt aus dem Token und nicht aus den Argumenten,
           * ist also genauso wenig faelschbar.
           */
          author_user_id: ctx.userId,
        })
        .select("id, created_at")
        .maybeSingle();
      if (schreibFehler) return dbFail("add_note", schreibFehler);

      await protokolliere(supabase, ctx, tor.workspaceId, {
        business_id: businessId,
        contact_id: contactId,
        field: "notes.body",
        // Eine Notiz ueberschreibt nichts; ein alter Wert existiert nicht und
        // wird deshalb nicht erfunden.
        old_value: null,
        new_value: body,
      });

      return okJson({
        note_id: angelegt?.id ?? null,
        scope: contactId ? "contact" : "company",
        company,
        contact,
        created_at: angelegt?.created_at ?? null,
        written: true,
      });
    },
  },

  // ── set_offer_field ────────────────────────────────────────────────────
  set_offer_field: {
    title: "Set offer field",
    description: TOOL_DESCRIPTIONS.set_offer_field,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        offer_id: {
          type: "string",
          description: "Optional. Without it, the workspace's primary offer is used.",
        },
        field: {
          type: "string",
          description: `One of the twelve fixed fields (${OFFER_TEXT_FIELDS.join(", ")}) or the key of one of the workspace's own fields.`,
        },
        value: { type: "string", description: "The new text. May be empty to clear the field." },
      },
      required: ["workspace_id", "field", "value"],
      additionalProperties: false,
    },
    // Zweimal derselbe Wert ergibt denselben Zustand.
    annotations: WRITE_ANNOTATIONS("Set offer field", true),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const field = readString(args, "field");
      if (!field) return fail('Argument "field" is required.');

      const value = args.value;
      if (typeof value !== "string") {
        return fail('Argument "value" is required and must be a string. Use "" to clear the field.');
      }
      if (value.length > MAX_OFFER_VALUE_CHARS) {
        return fail(
          `Argument "value" is longer than ${MAX_OFFER_VALUE_CHARS} characters. An offer field is a sentence or two, not a page.`
        );
      }

      const offerId = readString(args, "offer_id");
      let abfrage = supabase
        .from("offers")
        // OFFER_COLUMNS und kein Zusammenbau aus OFFER_TEXT_FIELDS: Supabase
        // leitet die Feldtypen aus dem String LITERAL ab und faellt bei einem
        // zur Laufzeit zusammengesetzten auf GenericStringError zurueck (die
        // Falle ist in lib/offers.ts vermerkt und hat hier zugeschlagen).
        .select(OFFER_COLUMNS)
        .eq("workspace_id", tor.workspaceId);
      if (offerId) {
        abfrage = abfrage.eq("id", offerId);
      } else {
        // Wie in get_offer: ohne offer_id das Standardangebot.
        abfrage = abfrage.order("is_default", { ascending: false }).order("created_at", { ascending: true });
      }
      const { data: gefunden, error: leseFehler } = await abfrage.limit(1);
      if (leseFehler) return dbFail("set_offer_field", leseFehler);
      // Ueber unknown, weil das Feld erst zur Laufzeit feststeht: die
      // Pruefung darauf, dass es eines der zwoelf ist, steht direkt darunter.
      const offer = (gefunden ?? [])[0] as unknown as Record<string, unknown> | undefined;
      if (!offer) {
        return fail(
          offerId
            ? "No offer with that offer_id in this workspace. Call set_offer_field without offer_id for the primary offer."
            : "This workspace has no offer yet. It is created in Frostbreaker under Offers."
        );
      }

      const istFestesFeld = (OFFER_TEXT_FIELDS as readonly string[]).includes(field);

      /**
       * Die eigenen Felder (Migration 0098).
       *
       * Ueber loadFieldDefs und nicht ueber eine eigene Abfrage, damit es
       * weiterhin genau eine Stelle gibt, die offer_field_defs kennt -- samt
       * ihres Deckels bei MAX_CUSTOM_FIELDS. Ein Schluessel, der dort nicht
       * steht, ist KEIN eigenes Feld, auch wenn in custom_fields zufaellig ein
       * Wert unter diesem Namen liegt: verwaiste Werte sind laut Migration
       * 0098 Absicht, und sie wieder zu beschreiben hiesse, ein geloeschtes
       * Feld durch die Hintertuer zurueckzuholen.
       */
      const defs = istFestesFeld ? [] : await loadFieldDefs(supabase, tor.workspaceId);
      const def = defs.find((d) => d.key === field);

      if (!istFestesFeld && !def) {
        const eigene = defs.map((d) => d.key);
        return fail(
          `Unknown field "${field}". Use one of the twelve fixed fields (${OFFER_TEXT_FIELDS.join(", ")})` +
            (eigene.length > 0
              ? ` or one of this workspace's own fields (${eigene.join(", ")}).`
              : ". This workspace has no custom offer fields; they are created in Frostbreaker under Offers.")
        );
      }

      const alt = istFestesFeld
        ? typeof offer[field] === "string"
          ? (offer[field] as string)
          : null
        : leseCustomField(offer.custom_fields, field);

      if (istFestesFeld) {
        const { error } = await supabase
          .from("offers")
          // Der Feldname stammt aus OFFER_TEXT_FIELDS, nicht aus dem Argument:
          // die Pruefung oben laesst nur diese zwoelf Namen durch.
          .update({ [field as OfferTextField]: value })
          .eq("id", offer.id as string)
          // Beide Bedingungen; die id allein traefe mit Service-Role jedes
          // Angebot der Datenbank.
          .eq("workspace_id", tor.workspaceId);
        if (error) return dbFail("set_offer_field", error);
      } else {
        /**
         * custom_fields wird als GANZES zurueckgeschrieben (Lesen, Aendern,
         * Schreiben). Das ist bei jsonb ohne jsonb_set nicht anders zu haben
         * und hier vertretbar: ein Werkzeug, das je Aufruf genau ein Feld
         * setzt, wird nicht nebenlaeufig gegen sich selbst laufen. Wer
         * gleichzeitig das Formular in der App speichert, gewinnt -- wie
         * ueberall sonst in dieser App auch.
         */
        const bisher =
          typeof offer.custom_fields === "object" && offer.custom_fields !== null
            ? (offer.custom_fields as Record<string, string>)
            : {};
        const { error } = await supabase
          .from("offers")
          .update({ custom_fields: { ...bisher, [field]: value } })
          .eq("id", offer.id as string)
          .eq("workspace_id", tor.workspaceId);
        if (error) return dbFail("set_offer_field", error);
      }

      await protokolliere(supabase, ctx, tor.workspaceId, {
        offer_id: offer.id as string,
        // Der Pfad, nicht nur der Name: "offers.cta" und
        // "offers.custom_fields.risk_reversal" sind im Protokoll ohne diesen
        // Unterschied nicht auseinanderzuhalten.
        field: istFestesFeld ? `offers.${field}` : `offers.custom_fields.${field}`,
        old_value: alt,
        new_value: value,
      });

      return okJson({
        offer_id: offer.id,
        offer_name: offer.name,
        field,
        field_kind: istFestesFeld ? "fixed" : "custom",
        label: def?.label ?? null,
        previous_value: alt,
        value,
        written: true,
      });
    },
  },

  // ── create_campaign ────────────────────────────────────────────────────
  /**
   * ═════════════════════════════════════════════════════════════════════
   * WIE DIE APP EINE KAMPAGNE ANLEGT -- NACHGESEHEN (2026-08-22)
   * ═════════════════════════════════════════════════════════════════════
   *
   * api/instantly/campaigns/route.ts POST macht DREI Dinge in dieser
   * Reihenfolge: Kampagne bei Instantly anlegen (POST /api/v2/campaigns),
   * Leads dorthin schieben, und erst danach den lokalen Spiegel schreiben
   * (campaigns, campaign_steps, campaign_leads, campaign_searches) sowie
   * searches.instantly_campaign_id setzen. Einen Entwurf, der NUR bei uns
   * liegt, kennt die App bisher nicht: sie hat immer beide Seiten.
   *
   * Genau diesen Fall legt dieses Werkzeug an, und zwar bewusst nur die
   * eigene Haelfte: instantly_campaign_id bleibt leer, activated_at bleibt
   * leer, mailboxes bleibt leer. Der Gang zu Instantly braucht den
   * API-Schluessel des Workspaces, kostet einen Fremdaufruf und ist der
   * Schritt, nach dem echte Mails moeglich werden -- er gehoert in die App
   * und nicht in ein Werkzeug, das neben fremdem Website- und Mailtext
   * steht.
   *
   * ZWEI Pruefungen der App werden gespiegelt: die Liste muss dem Workspace
   * gehoeren, und sie darf noch keine Kampagne haben (dort HTTP 409). Die
   * dritte, getBillingStatus, laeuft ueber auth.getUser() und ergaebe hier
   * ohne Session immer null; sie sitzt ohnehin vor dem Instantly-Aufruf, und
   * der findet hier nicht statt. Ein Entwurf verbraucht nichts.
   *
   * Eine gebuendelte Mehrfach-Suche (Migration 0096) wird wie im Formular
   * aufgeloest: an der Huelle haengt keine einzige Firma, verknuepft werden
   * ihre Teilsuchen.
   */
  create_campaign: {
    title: "Create campaign draft",
    description: TOOL_DESCRIPTIONS.create_campaign,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        name: { type: "string", description: "The campaign name, as it appears in Frostbreaker." },
        search_id: {
          type: "string",
          description: "The lead list this campaign sends to, from list_lead_lists.",
        },
      },
      required: ["workspace_id", "name", "search_id"],
      additionalProperties: false,
    },
    // Nicht idempotent: zweimal aufgerufen entstuenden zwei Entwuerfe. Der
    // zweite Aufruf laeuft deshalb in die Pruefung unten und wird ein Fehler,
    // der den ersten beim Namen nennt.
    annotations: WRITE_ANNOTATIONS("Create campaign draft", false),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const name = readString(args, "name");
      if (!name) return fail('Argument "name" is required: the name of the campaign.');
      if (name.length > MAX_CAMPAIGN_NAME_CHARS) {
        return fail(`Argument "name" is longer than ${MAX_CAMPAIGN_NAME_CHARS} characters.`);
      }
      const searchId = readString(args, "search_id");
      if (!searchId) {
        return fail('Argument "search_id" is required. Call list_lead_lists to get one.');
      }

      const { data: suche, error: suchFehler } = await supabase
        .from("searches")
        .select("id, name, query, is_search_group, instantly_campaign_id")
        .eq("id", searchId)
        .eq("workspace_id", tor.workspaceId)
        // Der Papierkorb (Migration 0010) ist in der App unsichtbar; eine
        // Kampagne fuer eine geloeschte Liste waere eine fuer niemanden.
        .is("deleted_at", null)
        .maybeSingle();
      if (suchFehler) return dbFail("create_campaign", suchFehler);
      if (!suche) {
        return fail(
          "Unknown search_id in this workspace. Call list_lead_lists for the workspace to get valid ids."
        );
      }

      /**
       * Die Listen, aus denen die Kampagne ihre Empfaenger zieht.
       *
       * Bei einer Gruppen-Huelle sind das ihre Teilsuchen, nie sie selbst --
       * dieselbe Uebersetzung, die groupPickerOptions im Formular macht.
       * Beide Abfragen laufen ueber .eq() und nie ueber einen
       * zusammengesetzten .or()-Filterstring: die ID kommt aus einem Modell,
       * und ein Komma darin waere dort ein zweiter Filter (Begruendung in
       * find_lead).
       */
      let listen: { id: string; instantly_campaign_id: string | null }[] = [
        { id: suche.id as string, instantly_campaign_id: suche.instantly_campaign_id as string | null },
      ];
      if (suche.is_search_group === true) {
        const { data: kinder, error: kindFehler } = await supabase
          .from("searches")
          .select("id, instantly_campaign_id")
          .eq("parent_search_id", suche.id as string)
          .eq("workspace_id", tor.workspaceId)
          .is("deleted_at", null);
        if (kindFehler) return dbFail("create_campaign", kindFehler);
        listen = (kinder ?? []).map((k) => ({
          id: k.id as string,
          instantly_campaign_id: k.instantly_campaign_id as string | null,
        }));
        if (listen.length === 0) {
          return fail(
            "This lead list is a bundle whose sub-lists are gone, so it holds no companies. Pick another lead list from list_lead_lists."
          );
        }
      }

      // Wie in der App (dort HTTP 409): eine Liste speist genau eine
      // Kampagne. Ohne diese Pruefung stuenden dieselben Empfaenger in zwei
      // Kampagnen und bekaemen alles doppelt.
      const verknuepft = listen.find((l) => l.instantly_campaign_id);
      if (verknuepft) {
        return fail(
          "This lead list already has a campaign in Instantly. Open it in Frostbreaker under Instantly > Campaigns instead of creating a second one."
        );
      }

      /**
       * Und ein zweiter Entwurf fuer dieselbe Liste?
       *
       * campaign_searches traegt selbst keine workspace_id; gefragt wird
       * deshalb mit den Such-IDs von oben, die bereits gegen den Workspace
       * geprueft sind. Das Ergebnis wird trotzdem nochmal ueber campaigns mit
       * .eq("workspace_id", …) aufgeloest -- die Zwischentabelle allein waere
       * mit Service-Role kein Zaun.
       */
      const { data: zuordnung, error: zuordnungFehler } = await supabase
        .from("campaign_searches")
        .select("campaign_id")
        .in("search_id", listen.map((l) => l.id));
      if (zuordnungFehler) return dbFail("create_campaign", zuordnungFehler);
      const kampagnenIds = [...new Set((zuordnung ?? []).map((z) => z.campaign_id as string))];
      if (kampagnenIds.length > 0) {
        const { data: vorhanden, error: vorhandenFehler } = await supabase
          .from("campaigns")
          .select("id, name, status, instantly_campaign_id, activated_at")
          .eq("workspace_id", tor.workspaceId)
          .in("id", kampagnenIds)
          // Kein .limit(1): ob die gefundene Zeile ein Entwurf ist oder eine
          // laufende Kampagne, entscheidet ueber die Auskunft, und die erste
          // beliebige waere die falsche. Es sind hoechstens eine Handvoll.
          .order("created_at", { ascending: true });
        if (vorhandenFehler) return dbFail("create_campaign", vorhandenFehler);
        const { draft, live } = classifyLinkedCampaigns((vorhanden ?? []) as unknown as CampaignDraftRow[]);
        // Zuerst der Entwurf: er ist der Fall, aus dem das Modell selbst
        // weiterkommt. Die campaign_id steht in der Meldung, damit es
        // set_campaign_sequence darauf anwenden kann, statt einen zweiten
        // Entwurf fuer dieselben Empfaenger anzulegen.
        if (draft) {
          return fail(
            `This lead list already has a campaign draft ("${draft.name}", campaign_id ${draft.id}). Write its emails with set_campaign_sequence or rename it with update_campaign instead of creating a second draft; two drafts for one list would end up as two campaigns to the same people.`
          );
        }
        if (live) {
          return fail(
            `This lead list already feeds a campaign that exists in Instantly ("${live.name}", status ${live.status}). Open it in Frostbreaker under Instantly > Campaigns; its text lives in Instantly and no tool here can change it.`
          );
        }
      }

      const { data: angelegt, error: schreibFehler } = await supabase
        .from("campaigns")
        .insert({
          workspace_id: tor.workspaceId,
          // Die primaere Liste, wie in der App: instantly_campaign_stats
          // haengt an genau einer search_id, die vollstaendige Zuordnung
          // steht in campaign_searches (Migration 0050).
          search_id: listen[0].id,
          name,
          // Der Status der Spalte selbst (Migration 0001). Kein
          // toLocalStatus() wie in der App: dort kommt die Zahl von Instantly
          // zurueck, hier gibt es kein Instantly.
          status: "draft",
          instantly_campaign_id: null,
          activated_at: null,
          // Leer, und das ist der Punkt: welche Postfaecher senden, steht
          // erst fest, wenn jemand sie in der App auswaehlt. Eine geratene
          // Adresse hier waere die erste Mail aus dem falschen Postfach.
          mailboxes: [],
          days: [...CAMPAIGN_DEFAULTS.days],
          send_window_start: CAMPAIGN_DEFAULTS.send_window_start,
          send_window_end: CAMPAIGN_DEFAULTS.send_window_end,
          timezone: CAMPAIGN_DEFAULTS.timezone,
          daily_limit: CAMPAIGN_DEFAULTS.daily_limit,
          open_tracking: CAMPAIGN_DEFAULTS.open_tracking,
          link_tracking: CAMPAIGN_DEFAULTS.link_tracking,
        })
        .select("id, created_at")
        .maybeSingle();
      if (schreibFehler) return dbFail("create_campaign", schreibFehler);
      if (!angelegt) return dbFail("create_campaign", { message: "insert ohne Rueckgabe" });

      const campaignId = angelegt.id as string;

      const { error: verknuepfFehler } = await supabase
        .from("campaign_searches")
        .insert(listen.map((l) => ({ campaign_id: campaignId, search_id: l.id })));
      if (verknuepfFehler) {
        // Die Kampagne steht bereits. Das zu verschweigen waere schlimmer als
        // der halbe Zustand selbst -- dieselbe Haltung wie in der App, wenn
        // Instantly geklappt hat und der Spiegel nicht.
        console.error("[mcp] create_campaign: campaign_searches nicht geschrieben:", verknuepfFehler.message);
        return fail(
          `The campaign was created (campaign_id ${campaignId}), but it could not be linked to the lead list. Open it in Frostbreaker and check which list it uses.`
        );
      }

      await protokolliere(supabase, ctx, tor.workspaceId, {
        campaign_id: campaignId,
        field: "campaigns.created",
        // Es gab nichts vorher; ein alter Wert wird nicht erfunden.
        old_value: null,
        new_value: name,
      });

      return okJson({
        campaign_id: campaignId,
        name,
        status: "draft",
        // searches.name ist optional; die App zeigt dann die Suchanfrage.
        lead_list: (suche.name as string | null) ?? (suche.query as string | null) ?? null,
        search_ids: listen.map((l) => l.id),
        created_at: angelegt.created_at ?? null,
        defaults: {
          days: CAMPAIGN_DEFAULTS.days,
          send_window_start: CAMPAIGN_DEFAULTS.send_window_start,
          send_window_end: CAMPAIGN_DEFAULTS.send_window_end,
          timezone: CAMPAIGN_DEFAULTS.timezone,
          daily_limit: CAMPAIGN_DEFAULTS.daily_limit,
          open_tracking: CAMPAIGN_DEFAULTS.open_tracking,
          link_tracking: CAMPAIGN_DEFAULTS.link_tracking,
          mailboxes: [],
        },
        written: true,
        next_steps:
          "Write the emails with set_campaign_sequence. After that the draft waits under Instantly > Campaigns in Frostbreaker, where it opens in the campaign form: choosing the mailboxes, creating the campaign in Instantly and starting it happen there and nowhere else, and nothing is sent until someone does it.",
      });
    },
  },

  // ── set_campaign_sequence ──────────────────────────────────────────────
  /**
   * ═════════════════════════════════════════════════════════════════════
   * WARUM NUR ENTWUERFE OHNE INSTANTLY-ZWILLING
   * ═════════════════════════════════════════════════════════════════════
   *
   * Nachgesehen in api/instantly/campaigns/[id]/route.ts (2026-08-22): die
   * Kampagnenseite liest die Sequenz LIVE von Instantly und nimmt aus
   * campaign_steps nur, was dort leer ist. Wer also die Schritte einer
   * Kampagne beschreibt, die es bei Instantly schon gibt, aendert weder das,
   * was versendet wird, noch das, was der Nutzer sieht -- er ueberschreibt
   * nur das Sicherheitsnetz gegen verschwundene Entwuerfe. Ein Schreibvorgang,
   * der nichts bewirkt und dabei etwas kaputtmacht, ist der schlechteste;
   * deshalb hier ein klarer Fehler statt einer stillen Wirkungslosigkeit.
   *
   * Ersetzt wird vollstaendig (delete + insert), genau wie PATCH in der App.
   * campaign_steps hat unique(campaign_id, step_order): ein Insert ohne das
   * vorherige Loeschen liefe in den Constraint.
   */
  set_campaign_sequence: {
    title: "Set campaign sequence",
    description: TOOL_DESCRIPTIONS.set_campaign_sequence,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        campaign_id: { type: "string", description: "The campaign_id from create_campaign or get_sequence." },
        steps: {
          type: "array",
          description: `The complete sequence, replacing what is there. At most ${MAX_SEQUENCE_STEPS} steps.`,
          minItems: 1,
          maxItems: MAX_SEQUENCE_STEPS,
          items: {
            type: "object",
            properties: {
              step_order: { type: "integer", description: "Position in the sequence, ascending.", minimum: 0 },
              wait_days: {
                type: "integer",
                description: "Days to wait before this step. The first step has no wait.",
                minimum: 0,
                maximum: MAX_WAIT_DAYS,
              },
              subject: { type: "string", description: "The subject line." },
              body: { type: "string", description: "The email text, as plain text." },
            },
            required: ["step_order", "wait_days", "subject", "body"],
            additionalProperties: false,
          },
        },
      },
      required: ["workspace_id", "campaign_id", "steps"],
      additionalProperties: false,
    },
    // Dieselbe Sequenz zweimal ergibt denselben Zustand.
    annotations: WRITE_ANNOTATIONS("Set campaign sequence", true),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const campaignId = readString(args, "campaign_id");
      if (!campaignId) {
        return fail('Argument "campaign_id" is required. Call create_campaign or get_sequence to get one.');
      }

      const liste = readList(
        args,
        "steps",
        MAX_SEQUENCE_STEPS,
        "A sequence with more steps than that is not a sequence any more."
      );
      if (!liste.ok) return fail(liste.message);

      const schritte: { step_order: number; wait_days: number; subject: string; body: string }[] = [];
      const belegt = new Set<number>();
      for (const [i, eintrag] of liste.value.entries()) {
        const order = readCount(eintrag, "step_order", -1, MAX_SEQUENCE_STEPS * 10);
        if (!order.ok) return fail(`Entry ${i + 1} of "steps": ${order.message}`);
        if (order.value < 0) return fail(`Entry ${i + 1} of "steps" needs a "step_order" of 0 or more.`);
        if (belegt.has(order.value)) {
          return fail(`Two steps share step_order ${order.value}. Every step needs its own position.`);
        }
        belegt.add(order.value);
        const wait = readCount(eintrag, "wait_days", 0, MAX_WAIT_DAYS);
        if (!wait.ok) return fail(`Entry ${i + 1} of "steps": ${wait.message}`);
        const subject = readString(eintrag, "subject");
        const body = readString(eintrag, "body");
        // Dieselbe Pruefung wie in der App ("Jede Variante braucht Betreff
        // und Text."): ein halb ausgefuellter Schritt ginge bei Instantly als
        // leere Mail an einen Teil der Empfaenger raus.
        if (!subject || !body) {
          return fail(`Entry ${i + 1} of "steps" needs both a "subject" and a "body"; neither may be empty.`);
        }
        if (subject.length > MAX_SUBJECT_CHARS) {
          return fail(`The subject of entry ${i + 1} is longer than ${MAX_SUBJECT_CHARS} characters.`);
        }
        if (body.length > MAX_BODY_CHARS) {
          return fail(`The body of entry ${i + 1} is longer than ${MAX_BODY_CHARS} characters.`);
        }
        schritte.push({ step_order: order.value, wait_days: wait.value, subject, body });
      }
      // Die uebergebene Reihenfolge zaehlt nicht, step_order zaehlt.
      schritte.sort((a, b) => a.step_order - b.step_order);

      const entwurf = await ladeEntwurf(supabase, tor.workspaceId, campaignId, "set_campaign_sequence");
      if (!entwurf.ok) return entwurf.result;

      // Der bisherige Stand, bevor er verschwindet: ohne ihn stuende im
      // Protokoll nur, DASS jemand die Sequenz ersetzt hat.
      const { data: bisher, error: bisherFehler } = await supabase
        .from("campaign_steps")
        .select("step_order, wait_days, subject, body")
        // Kein workspace_id-Filter moeglich und keiner noetig: campaignId ist
        // durch ladeEntwurf gegangen (campaign_steps traegt keine
        // workspace_id, Migration 0001).
        .eq("campaign_id", campaignId)
        .order("step_order", { ascending: true });
      if (bisherFehler) return dbFail("set_campaign_sequence", bisherFehler);

      const { error: loeschFehler } = await supabase
        .from("campaign_steps")
        .delete()
        .eq("campaign_id", campaignId);
      if (loeschFehler) return dbFail("set_campaign_sequence", loeschFehler);

      const { error: einfuegFehler } = await supabase.from("campaign_steps").insert(
        schritte.map((s, i) => ({
          campaign_id: campaignId,
          // 0-basiert und lueckenlos, wie die App speichert (dort der
          // Array-Index). step_order aus dem Argument bestimmt nur die
          // Reihenfolge, nicht die gespeicherte Zahl.
          step_order: i,
          wait_days: s.wait_days,
          // subject/body fuehren weiterhin Variante A (Migration 0071), und
          // variants haelt die vollstaendige Wahrheit -- get_sequence liest
          // beides in dieser Ordnung.
          subject: s.subject,
          body: s.body,
          variants: [{ subject: s.subject, body: s.body }],
        }))
      );
      if (einfuegFehler) return dbFail("set_campaign_sequence", einfuegFehler);

      await protokolliere(supabase, ctx, tor.workspaceId, {
        campaign_id: campaignId,
        field: "campaign_steps",
        // Vollstaendig als JSON, nicht als Zusammenfassung: eine halbe Kopie
        // waere fuer den Menschen, der wissen will, was ein Modell
        // ueberschrieben hat, nutzlos.
        old_value: (bisher ?? []).length > 0 ? JSON.stringify(bisher) : null,
        new_value: JSON.stringify(schritte),
      });

      return okJson({
        campaign_id: campaignId,
        name: entwurf.campaign.name,
        status: entwurf.campaign.status,
        replaced_steps: (bisher ?? []).length,
        steps: schritte.map((s, i) => ({
          step: i,
          wait_days: s.wait_days,
          subject: s.subject,
        })),
        written: true,
        note: "Stored in Frostbreaker only. The campaign reaches Instantly when someone creates it there in the app; nothing is sent before that.",
      });
    },
  },

  // ── update_campaign ────────────────────────────────────────────────────
  update_campaign: {
    title: "Update campaign draft",
    description: TOOL_DESCRIPTIONS.update_campaign,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        campaign_id: { type: "string", description: "The campaign_id from create_campaign or get_sequence." },
        name: { type: "string", description: "The new campaign name." },
        daily_limit: {
          type: "integer",
          description: `How many emails a day this campaign may send. 1 to ${MAX_DAILY_LIMIT}.`,
          minimum: 1,
          maximum: MAX_DAILY_LIMIT,
        },
        send_window_start: { type: "string", description: 'Start of the sending window, "HH:MM".' },
        send_window_end: { type: "string", description: 'End of the sending window, "HH:MM".' },
        timezone: {
          type: "string",
          description: 'The timezone the window is meant in, e.g. "Europe/Berlin".',
        },
      },
      required: ["workspace_id", "campaign_id"],
      additionalProperties: false,
    },
    // Dieselben Werte zweimal ergeben denselben Zustand.
    annotations: WRITE_ANNOTATIONS("Update campaign draft", true),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const campaignId = readString(args, "campaign_id");
      if (!campaignId) {
        return fail('Argument "campaign_id" is required. Call create_campaign or get_sequence to get one.');
      }

      const aenderungen: Record<string, string | number> = {};

      const name = readString(args, "name");
      if (args.name !== undefined && !name) {
        return fail('Argument "name" must not be empty. Leave it out to keep the current name.');
      }
      if (name) {
        if (name.length > MAX_CAMPAIGN_NAME_CHARS) {
          return fail(`Argument "name" is longer than ${MAX_CAMPAIGN_NAME_CHARS} characters.`);
        }
        aenderungen.name = name;
      }

      if (args.daily_limit !== undefined && args.daily_limit !== null) {
        const limit = readCount(args, "daily_limit", CAMPAIGN_DEFAULTS.daily_limit, MAX_DAILY_LIMIT);
        if (!limit.ok) return fail(limit.message);
        if (limit.value === 0) return fail('Argument "daily_limit" must be at least 1.');
        aenderungen.daily_limit = limit.value;
      }

      for (const [arg, spalte] of [
        ["send_window_start", "send_window_start"],
        ["send_window_end", "send_window_end"],
      ] as const) {
        const wert = readString(args, arg);
        if (args[arg] !== undefined && !wert) {
          return fail(`Argument "${arg}" must not be empty. Leave it out to keep the current value.`);
        }
        if (wert) {
          // Das Format, das <input type="time"> in der App liefert. Ohne die
          // Pruefung entstuende ein Postgres-Fehler, den dbFail bewusst nicht
          // durchreicht und den das Modell nicht deuten koennte.
          if (!TIME_PATTERN.test(wert)) {
            return fail(`Argument "${arg}" must be a time like "09:00".`);
          }
          aenderungen[spalte] = wert;
        }
      }

      const timezone = readString(args, "timezone");
      if (args.timezone !== undefined && !timezone) {
        return fail('Argument "timezone" must not be empty. Leave it out to keep the current one.');
      }
      if (timezone) {
        /**
         * Ueber normalizeInstantlyTimezone und nicht roh uebernommen.
         *
         * Instantly kennt nur eine kuratierte Liste von Zonennamen
         * (lib/instantly/campaigns.ts); "Europe/Vienna" ist dort ungueltig
         * und wird auf "Europe/Belgrade" abgebildet. Ein ungeprueft
         * gespeicherter Name faellt erst auf, wenn die Kampagne bei Instantly
         * angelegt wird -- also im schlechtesten Moment.
         */
        const normalisiert = normalizeInstantlyTimezone(timezone);
        aenderungen.timezone = normalisiert;
      }

      if (Object.keys(aenderungen).length === 0) {
        return fail(
          'Give at least one of "name", "daily_limit", "send_window_start", "send_window_end" or "timezone".'
        );
      }

      const entwurf = await ladeEntwurf(supabase, tor.workspaceId, campaignId, "update_campaign");
      if (!entwurf.ok) return entwurf.result;

      const { error: schreibFehler } = await supabase
        .from("campaigns")
        .update(aenderungen)
        .eq("id", campaignId)
        // Beide Bedingungen; die id allein traefe mit Service-Role jede
        // Kampagne der Datenbank.
        .eq("workspace_id", tor.workspaceId);
      if (schreibFehler) return dbFail("update_campaign", schreibFehler);

      // Eine Zeile JE SPALTE, nicht eine fuer den ganzen Aufruf: sonst
      // stuende im Protokoll ein Gemischtwarenladen aus vier Werten in einem
      // Textfeld, und niemand koennte sagen, was sich woran geaendert hat.
      await protokolliereViele(
        supabase,
        ctx,
        tor.workspaceId,
        Object.entries(aenderungen).map(([spalte, wert]) => ({
          campaign_id: campaignId,
          field: `campaigns.${spalte}`,
          old_value: alsText(entwurf.campaign[spalte as keyof typeof entwurf.campaign]),
          new_value: String(wert),
        }))
      );

      return okJson({
        campaign_id: campaignId,
        status: entwurf.campaign.status,
        changed: aenderungen,
        ...(timezone && aenderungen.timezone !== timezone
          ? {
              timezone_note: `Instantly only accepts a fixed list of timezones; "${timezone}" was stored as "${aenderungen.timezone}", which is the same offset.`,
            }
          : {}),
        written: true,
      });
    },
  },

  // ── publish_campaign ───────────────────────────────────────────────────
  /**
   * ═════════════════════════════════════════════════════════════════════
   * DAS EINZIGE WERKZEUG, DAS NACH DRAUSSEN GEHT
   * ═════════════════════════════════════════════════════════════════════
   *
   * Alle anderen Werkzeuge dieses Servers bleiben in der eigenen Datenbank.
   * Dieses legt die Kampagne bei Instantly an und laedt die Empfaenger dorthin
   * hoch -- genau das, was api/instantly/campaigns POST tut, wenn ein Mensch
   * im Formular auf Anlegen klickt. Der Ablauf steht deshalb NICHT hier,
   * sondern in lib/instantly/create-campaign.ts, den beide Wege aufrufen: eine
   * zweite Umsetzung waere die verlaesslichste Art, dass Sperrliste und
   * Abmeldungen auf einem der beiden Wege irgendwann nicht mehr greifen.
   *
   * Was hier bleibt, sind die zwei Dinge, die der MCP-Weg anders hat:
   *
   * 1. DIE ABO-SCHRANKE. Die Route ruft getBillingStatus(supabase) auf, und
   *    das liest auth.getUser(). Mit Service-Role ist das null, die Pruefung
   *    waere also wirkungslos -- ein Konto mit abgelaufener Testphase koennte
   *    ueber MCP anlegen, was ihm in der App verweigert wird. Hier laeuft sie
   *    deshalb ueber getBillingStatusForUser mit der user_id aus dem Token
   *    (dieselbe Abfrage, dieselbe isActive-Regel, nur eine andere Quelle der
   *    Identitaet).
   * 2. DIE POSTFAECHER. create_campaign legt bewusst keine an ("eine geratene
   *    Adresse waere die erste Mail aus dem falschen Postfach"). Ohne Absender
   *    kann Instantly nichts versenden, also braucht dieses Werkzeug sie --
   *    und zwar NAMENTLICH, nie geraten: entweder stehen sie schon am Entwurf
   *    (jemand hat sie in der App gewaehlt) oder sie kommen als Argument. Jede
   *    genannte Adresse wird gegen die Postfaecher des Workspaces geprueft;
   *    was Instantly nicht kennt, ist ein Fehler, der die vorhandenen
   *    aufzaehlt. Ein Tippfehler ergaebe sonst eine Kampagne, die niemals
   *    senden kann.
   *
   * WAS ES WEITERHIN NICHT TUT: aktivieren. Eine frisch angelegte
   * Instantly-Kampagne verschickt nichts (siehe .../activate/route.ts); der
   * Knopf dafuer steht in der App und nirgends sonst.
   */
  publish_campaign: {
    title: "Publish campaign to Instantly",
    description: TOOL_DESCRIPTIONS.publish_campaign,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        campaign_id: { type: "string", description: "The draft's campaign_id from create_campaign or get_sequence." },
        mailboxes: {
          type: "array",
          description:
            "The sending addresses, each one an account that exists in this workspace's Instantly. Leave it out to use the ones already stored on the draft; a dry_run lists what is available.",
          items: { type: "string" },
          maxItems: MAX_MAILBOXES,
        },
        dry_run: {
          type: "boolean",
          description:
            "True creates nothing and uploads nothing, and returns how many leads would be uploaded, how many are held back, and what is still missing. Default false.",
        },
      },
      required: ["workspace_id", "campaign_id"],
      additionalProperties: false,
    },
    annotations: {
      title: "Publish campaign to Instantly",
      readOnlyHint: false,
      // Nichts wird geloescht: der Entwurf wird zur Kampagne, dieselbe Zeile.
      destructiveHint: false,
      // Zweimal aufgerufen entstuenden zwei Instantly-Kampagnen fuer dieselben
      // Empfaenger -- der zweite Aufruf laeuft deshalb in ladeEntwurf ("ist
      // kein Entwurf mehr") und legt nichts an.
      idempotentHint: false,
      // Das einzige Werkzeug dieses Servers, das eine fremde API aufruft.
      openWorldHint: true,
    },
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const campaignId = readString(args, "campaign_id");
      if (!campaignId) {
        return fail('Argument "campaign_id" is required. Call create_campaign or get_sequence to get one.');
      }
      const probelauf = readFlag(args, "dry_run", false);
      if (!probelauf.ok) return fail(probelauf.message);

      let genannt: string[] | null = null;
      if (args.mailboxes !== undefined && args.mailboxes !== null) {
        if (!Array.isArray(args.mailboxes)) {
          return fail('Argument "mailboxes" must be a list of email addresses.');
        }
        if (args.mailboxes.length > MAX_MAILBOXES) {
          return fail(`Argument "mailboxes" has more than ${MAX_MAILBOXES} entries.`);
        }
        const gesammelt: string[] = [];
        for (const eintrag of args.mailboxes) {
          if (typeof eintrag !== "string" || eintrag.trim() === "") {
            return fail('Every entry of "mailboxes" must be a non-empty email address.');
          }
          gesammelt.push(eintrag.trim());
        }
        genannt = [...new Set(gesammelt)];
        if (genannt.length === 0) {
          return fail('Argument "mailboxes" must not be empty. Leave it out to use the draft\'s own mailboxes.');
        }
      }

      // Gehoert dem Workspace, ist noch ein Entwurf, laeuft noch nicht:
      // dieselben drei Bedingungen wie bei den anderen Kampagnen-Werkzeugen.
      const entwurf = await ladeEntwurf(supabase, tor.workspaceId, campaignId, "publish_campaign");
      if (!entwurf.ok) return entwurf.result;

      // Die Listen, aus denen die Empfaenger kommen. campaign_searches traegt
      // keine workspace_id (Migration 0050); die campaign_id ist durch
      // ladeEntwurf gegangen, deshalb ist die Abfrage hier gedeckt.
      const { data: zuordnung, error: zuordnungFehler } = await supabase
        .from("campaign_searches")
        .select("search_id")
        .eq("campaign_id", campaignId);
      if (zuordnungFehler) return dbFail("publish_campaign", zuordnungFehler);
      const searchIds = [...new Set((zuordnung ?? []).map((z) => z.search_id as string))];
      if (searchIds.length === 0) {
        return fail(
          "This draft is not linked to any lead list, so there would be nobody to send to. Create a new draft with create_campaign."
        );
      }

      const { data: schritte, error: schrittFehler } = await supabase
        .from("campaign_steps")
        .select("wait_days, subject, body, variants")
        .eq("campaign_id", campaignId)
        .order("step_order", { ascending: true });
      if (schrittFehler) return dbFail("publish_campaign", schrittFehler);
      if ((schritte ?? []).length === 0) {
        // Eine Kampagne ohne Mails anzulegen ist ein Fehler, kein Sonderfall:
        // sie stuende bei Instantly als leere Sequenz, und der Entwurf waere
        // verbraucht.
        return fail(
          "This draft has no emails yet. Write the sequence with set_campaign_sequence before publishing it."
        );
      }

      /**
       * Der Entwurf als das, was das Kampagnenformular abschicken wuerde.
       *
       * Ueber campaignFormValueFromDraft und nicht von Hand zusammengesetzt:
       * dort stecken zwei Umrechnungen, die man sonst vergisst. Postgres
       * liefert "09:00:00", Instantly will "09:00" (toHhMm), und die Vorgabe
       * der Spalte "Europe/Berlin" ist bei Instantly gar kein gueltiger Wert
       * (normalizeInstantlyTimezone, gemessen am 2026-07-21).
       */
      const formular = campaignFormValueFromDraft(
        {
          name: entwurf.campaign.name,
          mailboxes: entwurf.campaign.mailboxes,
          days: entwurf.campaign.days,
          send_window_start: entwurf.campaign.send_window_start,
          send_window_end: entwurf.campaign.send_window_end,
          timezone: entwurf.campaign.timezone,
          daily_limit: entwurf.campaign.daily_limit,
          open_tracking: entwurf.campaign.open_tracking,
          link_tracking: entwurf.campaign.link_tracking,
        },
        (schritte ?? []) as unknown as CampaignDraftStep[],
        LEERES_KAMPAGNENFORMULAR
      );

      // Die Schranke, die in der Route vor dem Instantly-Aufruf sitzt -- hier
      // ueber die user_id aus dem Token statt ueber die Sitzung.
      const abo = await getBillingStatusForUser(supabase, ctx.userId);
      if (!abo?.isActive && !probelauf.value) {
        return fail(
          "This account's subscription has expired, so no campaign can be created in Instantly. Pick a plan in Frostbreaker under Settings > Billing; the draft stays as it is."
        );
      }

      const apiKey = await getApiKey(supabase, tor.workspaceId, "instantly");
      if (!apiKey) {
        return fail(
          "This workspace has no Instantly API key stored, so the campaign cannot be created. Add it in Frostbreaker under Settings > API keys."
        );
      }

      const postfaecher = await ladeInstantlyPostfaecher(apiKey);
      if (!postfaecher.ok) return fail(postfaecher.message);

      const gewuenscht = genannt ?? formular.mailboxes;
      const { gewaehlt, unbekannt } = ordnePostfaecherZu(gewuenscht, postfaecher.emails);
      if (unbekannt.length > 0) {
        return fail(
          `Instantly has no account for ${unbekannt.join(", ")} in this workspace. Available: ${
            postfaecher.emails.join(", ") || "none"
          }.`
        );
      }
      if (gewaehlt.length === 0 && !probelauf.value) {
        return fail(
          postfaecher.emails.length > 0
            ? `This draft has no sending mailbox yet. Call again with mailboxes, naming which of these should send: ${postfaecher.emails.join(", ")}.`
            : "This workspace has no mailbox connected in Instantly, so a campaign could not send anything. Connect one in Frostbreaker under Instantly > Mailboxes."
        );
      }

      const ergebnis = await createInstantlyCampaign(supabase, apiKey, abo, {
        workspaceId: tor.workspaceId,
        name: formular.name,
        searchIds,
        mailboxes: gewaehlt,
        steps: formular.steps,
        days: formular.days,
        from: formular.from,
        to: formular.to,
        timezone: formular.timezone,
        dailyLimit: Number(formular.dailyLimit) || null,
        openTracking: formular.openTracking,
        linkTracking: formular.linkTracking,
        // Dieser Entwurf wird die Kampagne: dieselbe Zeile, dieselbe
        // campaign_id, dieselben Protokollzeilen.
        draftId: campaignId,
        dryRun: probelauf.value,
      });

      if (!ergebnis.ok) return fail(erklaereFehlschlag(ergebnis));

      if (ergebnis.dryRun) {
        return okJson({
          dry_run: true,
          campaign_id: campaignId,
          name: formular.name,
          lead_lists: searchIds,
          would_upload: ergebnis.leadsAdded,
          held_back: {
            suppressed_or_unsubscribed: ergebnis.skippedSuppressed,
            already_replied_or_declined: ergebnis.skippedEngaged,
            invalid_address: ergebnis.skippedUnverified,
          },
          mailboxes: gewaehlt,
          available_mailboxes: postfaecher.emails,
          subscription_active: abo?.isActive === true,
          // Leer heisst: ein echter Aufruf wuerde jetzt durchlaufen.
          blockers: ergebnis.blockers,
          note: "Nothing was created and nothing was uploaded. Call again without dry_run to create the campaign in Instantly.",
        });
      }

      await protokolliere(supabase, ctx, tor.workspaceId, {
        campaign_id: ergebnis.campaignId ?? campaignId,
        field: "campaigns.published",
        // Es gab vorher keine Instantly-Kampagne; eine erfundene Null waere
        // kein alter Wert. undo_writes laesst campaigns.* ohnehin in Ruhe.
        old_value: null,
        new_value: ergebnis.instantlyCampaignId,
      });

      return okJson({
        campaign_id: ergebnis.campaignId,
        instantly_campaign_id: ergebnis.instantlyCampaignId,
        name: formular.name,
        lead_lists: searchIds,
        leads_uploaded: ergebnis.leadsAdded,
        held_back: {
          suppressed_or_unsubscribed: ergebnis.skippedSuppressed,
          already_replied_or_declined: ergebnis.skippedEngaged,
          invalid_address: ergebnis.skippedUnverified,
        },
        mailboxes: gewaehlt,
        discarded_drafts: ergebnis.discardedDrafts,
        written: true,
        next_steps:
          "The campaign now exists in Instantly and has sent nothing: a newly created campaign stays idle until someone starts it. Starting it happens in Frostbreaker under Instantly > Campaigns and in no tool here.",
      });
    },
  },

  // ── undo_writes ────────────────────────────────────────────────────────
  /**
   * ═════════════════════════════════════════════════════════════════════
   * DER GRUND, WARUM ES set_lead_icebreakers GEBEN DARF
   * ═════════════════════════════════════════════════════════════════════
   *
   * Ein Mengenwerkzeug ist genau so lange vertretbar, wie sein Ergebnis
   * zuruecknehmbar ist (die vollstaendige Begruendung steht in
   * lib/mcp/untrusted.ts). Dieses Werkzeug ist diese Zuruecknahme, und es hat
   * drei Eigenschaften, die es davor bewahren, selbst zur Gefahr zu werden:
   *
   * 1. ES UEBERSCHREIBT NIEMALS EINEN MENSCHEN. Vor jedem Zurueckschreiben
   *    wird geprueft, ob in der Spalte noch genau das steht, was der
   *    Schreibvorgang hinterlassen hat. Hat jemand danach in der App etwas
   *    anderes eingetragen, bleibt es stehen und die Zeile wird als
   *    "changed_since" gemeldet.
   * 2. ES DREHT SICH NICHT SELBST ZURUECK. Jede Wiederherstellung wird
   *    protokolliert und traegt in undo_of die Zeile, die sie zuruecknimmt
   *    (Migration 0101). Ein zweiter Aufruf mit demselben Fenster findet die
   *    Zeilen als bereits zurueckgedreht vor und laesst sie in Ruhe -- sonst
   *    waere undo_writes ein Kippschalter.
   * 3. ES KENNT NUR DIE FELDER, DIE ES KENNT. UNDOABLE_FIELDS ist eine
   *    Erlaubnisliste; alles andere (eine Notiz, eine Kampagne) wird mit
   *    Grund uebersprungen statt "irgendwie" zurueckgeschrieben.
   */
  undo_writes: {
    title: "Undo writes",
    description: TOOL_DESCRIPTIONS.undo_writes,
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: WORKSPACE_PROPERTY,
        since_minutes: {
          type: "integer",
          description: `How far back to undo, in minutes. Default ${DEFAULT_UNDO_MINUTES}, maximum ${MAX_UNDO_MINUTES}.`,
          minimum: 1,
          maximum: MAX_UNDO_MINUTES,
        },
        log_ids: {
          type: "array",
          description: "Specific log entry ids to undo, instead of a time window.",
          items: { type: "string" },
          minItems: 1,
          maxItems: MAX_UNDO_ROWS,
        },
        dry_run: {
          type: "boolean",
          description: "True writes nothing and returns what would be restored. Default false.",
        },
      },
      required: ["workspace_id"],
      additionalProperties: false,
    },
    // Zweimal aufgerufen passiert beim zweiten Mal nichts mehr: die Zeilen
    // sind dann als zurueckgedreht markiert.
    annotations: WRITE_ANNOTATIONS("Undo writes", true),
    scope: "read_write",
    async handler(supabase, ctx, args) {
      const tor = gate(ctx, args, "read_write");
      if (!tor.ok) return tor.result;

      const probelauf = readFlag(args, "dry_run", false);
      if (!probelauf.ok) return fail(probelauf.message);

      const idsAngegeben = args.log_ids !== undefined && args.log_ids !== null;
      const fensterAngegeben = args.since_minutes !== undefined && args.since_minutes !== null;
      if (idsAngegeben && fensterAngegeben) {
        return fail('Give either "since_minutes" or "log_ids", not both. They would contradict each other.');
      }

      let logIds: string[] = [];
      if (idsAngegeben) {
        if (!Array.isArray(args.log_ids)) return fail('Argument "log_ids" must be a list of ids.');
        if (args.log_ids.length === 0) return fail('Argument "log_ids" must not be empty.');
        if (args.log_ids.length > MAX_UNDO_ROWS) {
          return fail(`Argument "log_ids" has more than ${MAX_UNDO_ROWS} entries. Split it up.`);
        }
        for (const id of args.log_ids) {
          if (typeof id !== "string" || id.trim() === "") {
            return fail('Every entry of "log_ids" must be a non-empty id from an earlier response.');
          }
          logIds.push(id.trim());
        }
        logIds = [...new Set(logIds)];
      }

      const minuten = readCount(args, "since_minutes", DEFAULT_UNDO_MINUTES, MAX_UNDO_MINUTES);
      if (!minuten.ok) return fail(minuten.message);
      if (minuten.value === 0) return fail('Argument "since_minutes" must be at least 1.');
      const seit = new Date(Date.now() - minuten.value * 60_000).toISOString();

      let abfrage = supabase
        .from("mcp_write_log")
        .select("id, field, old_value, new_value, business_id, contact_id, offer_id, campaign_id, undo_of, created_at")
        // Der Zaun: das Protokoll traegt eine eigene workspace_id, und ohne
        // diesen Filter dreht ein Aufruf fremde Schreibvorgaenge zurueck.
        .eq("workspace_id", tor.workspaceId)
        .order("created_at", { ascending: false });
      abfrage = idsAngegeben ? abfrage.in("id", logIds) : abfrage.gte("created_at", seit);
      // Eine mehr als erlaubt, damit "es sind zu viele" von "es sind genau
      // so viele" unterscheidbar bleibt.
      const { data: zeilen, error: leseFehler } = await abfrage.limit(MAX_UNDO_ROWS + 1);
      if (leseFehler) return dbFail("undo_writes", leseFehler);

      const alleZeilen = (zeilen ?? []) as unknown as WriteLogRow[];
      if (alleZeilen.length === 0) {
        return okJson({
          dry_run: probelauf.value,
          restored: 0,
          note: idsAngegeben
            ? "None of those log ids belong to this workspace, so nothing was undone."
            : `No writes in the last ${minuten.value} minutes, so there is nothing to undo.`,
        });
      }
      if (alleZeilen.length > MAX_UNDO_ROWS) {
        return fail(
          `More than ${MAX_UNDO_ROWS} writes fall into that window. Nothing was undone. Use a shorter since_minutes, or pass log_ids for the writes you mean.`
        );
      }
      if (idsAngegeben) {
        const gefunden = new Set(alleZeilen.map((z) => z.id));
        const fehlend = logIds.filter((id) => !gefunden.has(id));
        if (fehlend.length > 0) {
          // Alles oder nichts, wie beim Mengenwerkzeug: einen Teil
          // zurueckzudrehen und den Rest zu verschweigen waere die
          // schlechtere Auskunft.
          return fail(
            `${fehlend.length} of ${logIds.length} log_ids are not in this workspace's write log. Nothing was undone.`
          );
        }
      }

      /**
       * EINE WIEDERHERSTELLUNG WIRD NICHT ZURUECKGEDREHT.
       *
       * Ohne diese Zeile waere das Werkzeug ein Kippschalter: eine
       * Wiederherstellung ist selbst ein protokollierter Schreibvorgang, sie
       * liegt im selben Zeitfenster, und der zweite Aufruf wuerde sie
       * zuruecknehmen -- also den urspruenglichen Text wieder hinschreiben.
       * Zurueckgedreht wird nur, was von einem Schreibwerkzeug stammt
       * (undo_of ist null); die uebrigen Zeilen werden mit Grund gemeldet.
       */
      const protokoll = alleZeilen.filter((z) => z.undo_of === null);
      const wiederherstellungen = alleZeilen
        .filter((z) => z.undo_of !== null)
        .map((z) => ({ field: z.field, log_id: z.id, reason: "is_itself_a_restore" }));
      if (protokoll.length === 0) {
        return okJson({
          dry_run: probelauf.value,
          restored: 0,
          note: "Those log entries are restores, not writes. Undoing a restore would write the old text back again, so nothing was done.",
          skipped: wiederherstellungen,
        });
      }

      /**
       * Was davon wurde schon zurueckgedreht?
       *
       * Eine Wiederherstellung traegt in undo_of die Zeile, die sie
       * zuruecknimmt. Ohne diese Abfrage waere ein zweiter Aufruf mit
       * demselben Fenster ein Wiederholen des Schreibvorgangs.
       */
      const { data: markierungen, error: markierungsFehler } = await supabase
        .from("mcp_write_log")
        .select("undo_of")
        .eq("workspace_id", tor.workspaceId)
        .in("undo_of", protokoll.map((z) => z.id));
      if (markierungsFehler) return dbFail("undo_writes", markierungsFehler);
      const zurueckgedreht = new Set(
        (markierungen ?? []).map((m) => m.undo_of as string).filter(Boolean)
      );

      const gruppen = gruppiereNachZiel(protokoll);
      const aktuell = await ladeAktuelleWerte(supabase, tor.workspaceId, gruppen);
      if (!aktuell.ok) return dbFail("undo_writes", aktuell.error);

      const plan: UndoPlan[] = [];
      const uebersprungen: { field: string; log_id: string; reason: string }[] = [
        ...wiederherstellungen,
      ];

      for (const gruppe of gruppen) {
        // Zeilen absteigend: die neueste sagt, was jetzt dastehen muesste,
        // die aelteste, worauf zurueckgestellt wird. Bei einer Kette
        // A->B->C ist das Ergebnis wieder A.
        const neueste = gruppe.rows[0];
        const aelteste = gruppe.rows[gruppe.rows.length - 1];
        if (zurueckgedreht.has(neueste.id)) {
          uebersprungen.push({ field: gruppe.field, log_id: neueste.id, reason: "already_restored" });
          continue;
        }
        if (!gruppe.ziel) {
          uebersprungen.push({
            field: gruppe.field,
            log_id: neueste.id,
            reason:
              gruppe.field === "notes.body"
                ? "notes_are_append_only"
                : gruppe.field.startsWith("campaigns.") || gruppe.field === "campaign_steps"
                  ? "campaigns_are_changed_in_the_app"
                  : "field_cannot_be_restored",
          });
          continue;
        }
        const jetzt = aktuell.werte.get(gruppe.key);
        if (jetzt === undefined) {
          uebersprungen.push({ field: gruppe.field, log_id: neueste.id, reason: "row_no_longer_exists" });
          continue;
        }
        if (jetzt !== neueste.new_value) {
          // Der wichtigste der drei Faelle: hier hat ein Mensch in der App
          // gearbeitet. Sein Text ist nicht das, was zurueckgenommen werden
          // soll.
          uebersprungen.push({ field: gruppe.field, log_id: neueste.id, reason: "changed_since" });
          continue;
        }
        if (aelteste.old_value === null && gruppe.ziel.table === "contacts") {
          // contacts.outreach_status ist "not null" (Migration 0018); ein
          // fehlender alter Wert liesse sich nur mit einem erfundenen fuellen.
          uebersprungen.push({ field: gruppe.field, log_id: neueste.id, reason: "no_previous_value" });
          continue;
        }
        plan.push({
          key: gruppe.key,
          field: gruppe.field,
          ziel: gruppe.ziel,
          from: jetzt,
          to: aelteste.old_value,
          log_id: neueste.id,
          covers: gruppe.rows.map((r) => r.id),
        });
      }

      if (probelauf.value) {
        return okJson({
          dry_run: true,
          restored: 0,
          would_restore: plan.length,
          note: "Nothing was written. Call again without dry_run to restore these values.",
          changes: plan.map(beschreibePlan),
          ...(uebersprungen.length > 0 ? { skipped: uebersprungen } : {}),
        });
      }

      const erledigt: UndoPlan[] = [];
      const fehlgeschlagen: { field: string; log_id: string }[] = [];
      // Nach Zeile zusammengefasst: zwei eigene Angebotsfelder derselben
      // Zeile ergeben EIN Update, sonst wuerde das zweite das erste aus dem
      // jsonb wieder herauswerfen (Lesen-Aendern-Schreiben).
      for (const [, buendel] of buendleNachZeile(plan, aktuell.customFields)) {
        const { table, rowId, patch } = buendel;
        const { error } = await supabase
          .from(table)
          .update(patch)
          .eq("id", rowId)
          // Beide Bedingungen; die id allein traefe mit Service-Role jede
          // Zeile der Datenbank.
          .eq("workspace_id", tor.workspaceId);
        if (error) {
          console.error(`[mcp] undo_writes: ${table}/${rowId} nicht zurueckgeschrieben:`, error.message);
          for (const eintrag of buendel.eintraege) {
            fehlgeschlagen.push({ field: eintrag.field, log_id: eintrag.log_id });
          }
          continue;
        }
        erledigt.push(...buendel.eintraege);
      }

      if (erledigt.length > 0) {
        await protokolliereViele(
          supabase,
          ctx,
          tor.workspaceId,
          erledigt.map((e) => ({
            business_id: e.ziel.table === "businesses" ? e.ziel.rowId : null,
            contact_id: e.ziel.table === "contacts" ? e.ziel.rowId : null,
            offer_id: e.ziel.table === "offers" ? e.ziel.rowId : null,
            field: e.field,
            old_value: e.from,
            new_value: e.to,
            // Die Markierung, an der der naechste Aufruf erkennt, dass hier
            // schon zurueckgedreht wurde.
            undo_of: e.log_id,
          }))
        );
      }

      return okJson({
        dry_run: false,
        restored: erledigt.length,
        ...(fehlgeschlagen.length > 0
          ? {
              failed: fehlgeschlagen,
              note: "Some values could not be written back. The others were.",
            }
          : {}),
        changes: erledigt.map(beschreibePlan),
        ...(uebersprungen.length > 0
          ? {
              skipped: uebersprungen,
              skipped_note:
                "changed_since means someone edited that value in Frostbreaker after the write; it was deliberately left alone. Notes and campaigns are not undone here.",
            }
          : {}),
      });
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Kleinkram
// ─────────────────────────────────────────────────────────────────────────

/**
 * PostgREST liefert eine eingebettete Beziehung je nach erkannter Kardinalitaet
 * als Objekt ODER als einelementiges Array. Beides hier abfangen, statt sich
 * auf eine Form zu verlassen, die sich mit einem Schema-Umbau aendern kann.
 */
function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

/** businesses(count) kommt als [{ count: n }]. */
function leadCount(relation: unknown): number {
  const erste = firstRelation(relation as { count?: number } | { count?: number }[]);
  return typeof erste?.count === "number" ? erste.count : 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Die Summen eines Workspaces
// ─────────────────────────────────────────────────────────────────────────

/**
 * DREI ZAHLEN, DIE NICHT DASSELBE SIND (gemessen am 2026-08-22)
 *
 * Workspace 2d9bb9ae-811a-45ff-b1bf-1584e89f51ca, 64 Listen:
 *   3053 Firmen (businesses)
 *   3007 Ansprechpartner (contacts)
 *   1650 Ansprechpartner MIT E-Mail -- nur die sind anschreibbar
 *   1916 der 3053 Firmen liegen in ARCHIVIERTEN Listen
 *
 * Auf "wie viele Leads habe ich" kam bisher 3053. Die Zahl war richtig, die
 * Frage war meist eine andere. Deshalb liefert list_lead_lists alle vier
 * Groessen nebeneinander, statt dass ein Modell 64 Zeilen addiert und dabei
 * eine fuenfte Zahl erfindet.
 */
type LeadTotals = {
  companies: number;
  contacts: number;
  contacts_with_email: number;
  active: { companies: number; contacts: number; contacts_with_email: number };
};

/** Inline und nicht in tool-descriptions.ts, wie die uebrigen note-Texte
 *  dieser Datei: es gehoert zur Antwort und nicht zur Werkzeugliste. Der
 *  Wortlaut darf gern der copywriter schaerfen, die drei Einheiten muessen
 *  drinbleiben. */
const TOTALS_NOTE =
  "companies counts businesses, one row per company. contacts counts the people found at those companies. contacts_with_email counts the contacts that have an email address and is the only one of the three that answers 'how many can actually be emailed'. active repeats all three for the lead lists that are not archived. These totals are counted over the whole workspace, so they stay exact even when the list below is capped, and they include the sub-searches of a bundled search.";

/**
 * Sechs Zaehlabfragen, keine je Liste.
 *
 * head: true holt NUR den Zaehler, keine Zeilen -- sechs davon parallel kosten
 * weniger als die eine Listenabfrage daneben. Der Zaun ist wie ueberall in
 * dieser Datei das ausdrueckliche .eq("workspace_id", …); der Join auf
 * searches grenzt nur ab, WELCHE Listen zaehlen.
 *
 * Der Papierkorb (searches.deleted_at, Migration 0010) faellt raus, wie in der
 * Liste daneben. Teilsuchen fallen NICHT raus: sie sind fuer den Nutzer keine
 * eigene Liste, ihre Firmen sind aber echte Leads.
 *
 * BEKANNTE GRENZE: archiviert wird in der App nur die sichtbare Zeile
 * (searches-list.tsx setzt archived_at auf den Zeilen aus search_overview, und
 * das sind die Eltern). Die Teilsuchen einer archivierten Gruppe tragen den
 * Zeitpunkt also nicht und zaehlen weiter als aktiv. Der Fall ist selten und
 * eine Korrektur waere ein zweiter Rundlauf ueber die Elternzeilen; lieber
 * hier aufgeschrieben als still falsch.
 *
 * NICHT gegen den Produktivstand geprueft (2026-08-22), dieselbe Luecke wie
 * bei businesses(count): ohne Service-Role-Schluessel gibt es lokal nichts zu
 * pruefen. Deshalb gibt diese Funktion bei einem Fehler null zurueck statt zu
 * werfen -- list_lead_lists liefert dann seine Listen ohne Summen weiter,
 * statt am Zusatz zu scheitern.
 */
async function leadTotals(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<LeadTotals | null> {
  const firmen = (nurAktive: boolean) => {
    const q = supabase
      .from("businesses")
      .select("id, searches!inner(id)", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("searches.deleted_at", null);
    return nurAktive ? q.is("searches.archived_at", null) : q;
  };

  const personen = (nurAktive: boolean, nurMitEmail: boolean) => {
    let q = supabase
      .from("contacts")
      .select("id, businesses!inner(searches!inner(id))", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("businesses.searches.deleted_at", null);
    if (nurAktive) q = q.is("businesses.searches.archived_at", null);
    // Leerer String kommt hier nicht vor: der Worker schreibt entweder eine
    // Adresse oder null (parse_persons in find_decisionmaker.py, parse_hunter_
    // emails in hunt_persons.py).
    if (nurMitEmail) q = q.not("email", "is", null);
    return q;
  };

  const ergebnisse = await Promise.all([
    firmen(false),
    firmen(true),
    personen(false, false),
    personen(false, true),
    personen(true, false),
    personen(true, true),
  ]);

  const gescheitert = ergebnisse.find((e) => e.error);
  if (gescheitert) {
    console.error("[mcp] Summen fehlgeschlagen:", gescheitert.error?.message ?? gescheitert.error);
    return null;
  }

  const zahl = (i: number) => ergebnisse[i].count ?? 0;
  return {
    companies: zahl(0),
    contacts: zahl(2),
    contacts_with_email: zahl(3),
    active: { companies: zahl(1), contacts: zahl(4), contacts_with_email: zahl(5) },
  };
}

/**
 * Die Fassungen eines Sequenzschritts, mit Rueckfall auf subject/body.
 *
 * variants gibt es erst seit Migration 0071; Zeilen von davor haben ein leeres
 * Array und fuehren ihren einzigen Text weiterhin in den beiden Spalten.
 * Dieselbe Ueberlegung wie in mirroredVariants (api/instantly/campaigns/[id]).
 */
function readVariants(step: {
  subject?: string | null;
  body?: string | null;
  variants?: unknown;
}): { subject: string; body: string; disabled?: boolean }[] {
  const gespeichert = step.variants;
  if (Array.isArray(gespeichert) && gespeichert.length > 0) {
    return gespeichert.map((v) => {
      const eintrag = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
      return {
        // Der Spiegel haelt Klartext (das Formular schickt Klartext, die
        // Umwandlung nach HTML passiert erst beim Senden an Instantly). Der
        // Aufruf hier ist trotzdem richtig: instantlyHtmlToPlainText gibt
        // Text ohne Tags unveraendert zurueck und faengt die Zeilen ab, die
        // ueber den Umweg Instantly hereingekommen sind.
        subject: typeof eintrag.subject === "string" ? eintrag.subject : "",
        body: instantlyHtmlToPlainText(typeof eintrag.body === "string" ? eintrag.body : ""),
        ...(eintrag.disabled === true ? { disabled: true } : {}),
      };
    });
  }
  return [
    {
      subject: step.subject ?? "",
      body: instantlyHtmlToPlainText(step.body ?? ""),
    },
  ];
}

/**
 * Ein Kampagnen-ENTWURF, oder ein Fehler, der sagt warum nicht.
 *
 * Drei Bedingungen, alle drei mit eigenem Satz:
 *
 * 1. aktiviert (activated_at gesetzt oder status nicht 'draft') -- was eine
 *    laufende Kampagne tut, entscheidet Instantly; hier daran zu drehen waere
 *    eine Aenderung, die niemand sieht und die niemand rueckgaengig macht.
 * 2. bei Instantly vorhanden (instantly_campaign_id gesetzt) -- gemessen in
 *    api/instantly/campaigns/[id]/route.ts: die Kampagnenseite liest die
 *    Sequenz LIVE von Instantly und nimmt aus campaign_steps nur, was dort
 *    leer ist. Ein Schreibvorgang hier waere wirkungslos UND wuerde das
 *    Sicherheitsnetz gegen verschwundene Entwuerfe ueberschreiben.
 * 3. gar nicht vorhanden -- gleiche Formulierung wie ueberall, damit sich
 *    "gibt es nicht" und "gehoert einem anderen Workspace" nicht
 *    unterscheiden lassen.
 */
type KampagnenZeile = {
  id: string;
  name: string;
  status: string;
  activated_at: string | null;
  instantly_campaign_id: string | null;
  daily_limit: number | null;
  send_window_start: string | null;
  send_window_end: string | null;
  timezone: string | null;
  /** Die vier Spalten, die erst publish_campaign braucht: sie fuellen das
   *  Kampagnenformular, das dieses Werkzeug an Instantly weitergibt. */
  mailboxes: string[] | null;
  days: number[] | null;
  open_tracking: boolean | null;
  link_tracking: boolean | null;
};

async function ladeEntwurf(
  supabase: SupabaseClient,
  workspaceId: string,
  campaignId: string,
  werkzeug: string
): Promise<{ ok: true; campaign: KampagnenZeile } | { ok: false; result: ToolCallResult }> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, status, activated_at, instantly_campaign_id, daily_limit, send_window_start, send_window_end, timezone, mailboxes, days, open_tracking, link_tracking")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return { ok: false, result: dbFail(werkzeug, error) };
  if (!data) {
    return {
      ok: false,
      result: fail(
        "Unknown campaign_id in this workspace. Call get_sequence for the workspace to see its campaigns."
      ),
    };
  }
  const zeile = data as unknown as KampagnenZeile;
  if (zeile.activated_at !== null || zeile.status !== "draft") {
    return {
      ok: false,
      result: fail(
        `This campaign is not a draft any more (status ${zeile.status}${zeile.activated_at ? `, activated ${zeile.activated_at}` : ""}). A campaign that has been started is changed in Frostbreaker under Instantly > Campaigns, and no tool here can activate, pause or stop it.`
      ),
    };
  }
  if (zeile.instantly_campaign_id !== null) {
    return {
      ok: false,
      result: fail(
        "This campaign already exists in Instantly, so its text and schedule live there. Change it in Frostbreaker under Instantly > Campaigns; a write here would not reach Instantly."
      ),
    };
  }
  return { ok: true, campaign: zeile };
}

/**
 * Die Postfaecher, die dieser Workspace bei Instantly hat.
 *
 * Ein Fremdaufruf je publish_campaign, auch im Probelauf. Er ist die einzige
 * Moeglichkeit zu pruefen, ob eine genannte Absenderadresse dort ueberhaupt
 * existiert: ob Instantly eine unbekannte Adresse in email_list von sich aus
 * ablehnt, ist NICHT gemessen -- und eine Kampagne mit einem Tippfehler im
 * Absender koennte niemals senden, ohne dass es jemandem auffiele. Eine
 * zusaetzliche Anfrage von den 20 je Minute, die Instantly je Workspace
 * zulaesst, ist dafuer ein guter Tausch.
 *
 * limit=100 wie in api/instantly/accounts: wer mehr Postfaecher hat, waehlt
 * sie in der App aus.
 */
async function ladeInstantlyPostfaecher(
  apiKey: string
): Promise<{ ok: true; emails: string[] } | { ok: false; message: string }> {
  try {
    const antwort = await instantlyRequest<{ items?: { email?: string | null }[] }>(
      apiKey,
      "/api/v2/accounts?limit=100"
    );
    const emails = (antwort?.items ?? [])
      .map((a) => (typeof a?.email === "string" ? a.email : null))
      .filter((e): e is string => Boolean(e));
    return { ok: true, emails };
  } catch (err) {
    const status = err instanceof InstantlyApiError ? err.status : 0;
    console.error("[mcp] publish_campaign: Postfaecher nicht abrufbar:", (err as Error).message);
    return {
      ok: false,
      message:
        status === 401 || status === 403
          ? "Instantly rejected this workspace's API key, so nothing was created. Check the key in Frostbreaker under Settings > API keys."
          : "Instantly did not answer, so nothing was created. Try again in a minute.",
    };
  }
}

/** Genannte Adressen auf die Schreibweise abbilden, unter der Instantly das
 *  Konto fuehrt. Gross- und Kleinschreibung spielt bei einer E-Mail-Adresse
 *  keine Rolle, in email_list aber sehr wohl: dort muss stehen, wie das Konto
 *  dort heisst. */
function ordnePostfaecherZu(
  gewuenscht: string[],
  vorhanden: string[]
): { gewaehlt: string[]; unbekannt: string[] } {
  const nachKlein = new Map(vorhanden.map((e) => [e.toLowerCase(), e]));
  const gewaehlt: string[] = [];
  const unbekannt: string[] = [];
  for (const wunsch of gewuenscht) {
    const treffer = nachKlein.get(wunsch.trim().toLowerCase());
    if (treffer) gewaehlt.push(treffer);
    else unbekannt.push(wunsch);
  }
  return { gewaehlt: [...new Set(gewaehlt)], unbekannt };
}

/**
 * Der Fehlschlag des gemeinsamen Ablaufs, auf Englisch und fuer ein Modell.
 *
 * createInstantlyCampaign traegt den deutschen Satz fuer die Oberflaeche; hier
 * zaehlt der Grund. Nur bei "instantly_failed" wird der Originaltext
 * durchgereicht: er kommt von Instantly, ist englisch und nennt die Ursache
 * genauer, als es eine Uebersetzung koennte.
 */
function erklaereFehlschlag(fehler: Extract<CreateCampaignResult, { ok: false }>): string {
  switch (fehler.reason) {
    case "subscription_inactive":
      return "This account's subscription has expired, so no campaign can be created in Instantly. Pick a plan in Frostbreaker under Settings > Billing; the draft stays as it is.";
    case "search_not_found":
      return "At least one lead list behind this draft no longer exists in this workspace. Nothing was created.";
    case "search_already_linked":
    case "list_has_campaign":
      return "One of this draft's lead lists already feeds a campaign in Instantly, and a second one would send the same people everything twice. Nothing was created; open the existing campaign in Frostbreaker under Instantly > Campaigns.";
    case "draft_gone":
      return "This draft no longer exists. Nothing was created.";
    case "draft_not_a_draft":
      return "This campaign is no longer a draft; it was created in Instantly in the meantime. Nothing was created.";
    case "no_sendable_leads":
      return "None of the leads in these lists may be emailed: every address is on the suppression list, has unsubscribed, has already replied or declined, or is known to be invalid. Nothing was created.";
    case "incomplete_variant":
      return "One step of the sequence has no subject or no body. Fix it with set_campaign_sequence, then publish again.";
    case "missing_fields":
      return "The draft is missing something the campaign needs: a name, a schedule, a sequence or a mailbox. Nothing was created.";
    case "mirror_failed":
      return `The campaign was created in Instantly (id ${fehler.instantlyCampaignId}), but Frostbreaker could not store it. Do not publish again; open Instantly > Campaigns in the app and check what is there.`;
    case "instantly_failed":
      return `Instantly refused the request: ${fehler.error} The campaign may exist there without its leads, so check Instantly > Campaigns in Frostbreaker before trying again.`;
  }
  // Unerreichbar, solange jeder Grund oben steht -- und der Compiler haelt
  // das fest: kaeme einer dazu, waere die Zuweisung an never ein Fehler.
  const unbehandelt: never = fehler.reason;
  return `The campaign could not be created (${String(unbehandelt)}). Nothing was created.`;
}

/** Fuer das Protokoll: aus einem Spaltenwert wird Text, aus null bleibt null.
 *  daily_limit ist eine Zahl, name ein Text -- old_value ist beides Mal text. */
function alsText(wert: unknown): string | null {
  if (wert === null || wert === undefined) return null;
  return String(wert);
}

/**
 * Wie lang ein Wert in einer ERGEBNISLISTE hoechstens sein darf.
 *
 * Nicht zu verwechseln mit MAX_FOREIGN_TEXT_CHARS: hier geht es nicht um
 * Fremdtext, sondern um die Groesse der Antwort. 50 Eintraege mit altem und
 * neuem Icebreaker à 2000 Zeichen waeren 200.000 Zeichen, und Claude Code
 * bricht eine Werkzeugausgabe bei 25.000 Token HART ab -- mitten im JSON. Ein
 * Icebreaker ist real 200 bis 300 Zeichen (der Generator im Worker darf 35
 * Woerter, Migration 0094), 300 trifft also fast nie zu.
 */
const PREVIEW_CHARS = 300;

function vorschau(text: string | null): string | null {
  if (text === null) return null;
  if (text.length <= PREVIEW_CHARS) return text;
  return text.slice(0, PREVIEW_CHARS) + TRUNCATION_MARK;
}

// ─────────────────────────────────────────────────────────────────────────
// undo_writes: vom Protokolleintrag zur Spalte
// ─────────────────────────────────────────────────────────────────────────

/** Eine Zeile aus mcp_write_log, auf das reduziert, was hier gelesen wird. */
type WriteLogRow = {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  business_id: string | null;
  contact_id: string | null;
  offer_id: string | null;
  campaign_id: string | null;
  undo_of: string | null;
  created_at: string;
};

/** Wohin ein Protokolleintrag zurueckgeschrieben wird. key nur bei
 *  offers.custom_fields.<schluessel>. */
type UndoZiel = {
  table: "businesses" | "contacts" | "offers";
  rowId: string;
  column: string;
  key?: string;
};

type UndoGruppe = {
  key: string;
  field: string;
  ziel: UndoZiel | null;
  /** Absteigend, neueste zuerst. */
  rows: WriteLogRow[];
};

type UndoPlan = {
  key: string;
  field: string;
  ziel: UndoZiel;
  from: string | null;
  to: string | null;
  /** Die Zeile, die zurueckgenommen wird -- sie landet in undo_of. */
  log_id: string;
  /** Alle Zeilen dieser Kette, damit im Ergebnis steht, was abgedeckt ist. */
  covers: string[];
};

/**
 * Der Pfad aus mcp_write_log.field, uebersetzt in Tabelle und Spalte.
 *
 * Streng: was nicht in UNDOABLE_FIELDS oder in OFFER_TEXT_FIELDS steht, ist
 * null und wird uebersprungen. Mit Service-Role waere ein "probier es halt"
 * die gefaehrlichste Zeile dieses Servers -- der Feldname stammt aus einer
 * Datenbankspalte, die ein frueherer Werkzeugaufruf gefuellt hat.
 */
function zielFuerFeld(row: WriteLogRow): UndoZiel | null {
  const bekannt = (UNDOABLE_FIELDS as Record<string, { table: string; column: string } | undefined>)[row.field];
  if (bekannt) {
    const rowId = bekannt.table === "businesses" ? row.business_id : row.contact_id;
    if (!rowId) return null;
    return { table: bekannt.table as "businesses" | "contacts", rowId, column: bekannt.column };
  }
  if (!row.offer_id) return null;
  const CUSTOM_PREFIX = "offers.custom_fields.";
  if (row.field.startsWith(CUSTOM_PREFIX)) {
    const key = row.field.slice(CUSTOM_PREFIX.length);
    return key ? { table: "offers", rowId: row.offer_id, column: "custom_fields", key } : null;
  }
  if (row.field.startsWith("offers.")) {
    const spalte = row.field.slice("offers.".length);
    return (OFFER_TEXT_FIELDS as readonly string[]).includes(spalte)
      ? { table: "offers", rowId: row.offer_id, column: spalte }
      : null;
  }
  return null;
}

/**
 * Mehrere Schreibvorgaenge auf dasselbe Feld derselben Zeile gehoeren
 * zusammen.
 *
 * A -> B -> C zurueckzudrehen heisst A, nicht B: die neueste Zeile sagt, was
 * jetzt dastehen muesste, die aelteste, worauf zurueckgestellt wird. Wuerde
 * jede Zeile einzeln zurueckgeschrieben, haenge das Ergebnis von der
 * Reihenfolge ab, in der die Updates durchlaufen.
 *
 * Zeilen ohne Ziel bilden je eine eigene Gruppe: sie werden einzeln mit Grund
 * gemeldet, statt in einer Sammelgruppe zu verschwinden.
 */
function gruppiereNachZiel(rows: WriteLogRow[]): UndoGruppe[] {
  const gruppen = new Map<string, UndoGruppe>();
  for (const row of rows) {
    const ziel = zielFuerFeld(row);
    const key = ziel ? `${row.field}|${ziel.rowId}` : `${row.field}|${row.id}`;
    const vorhanden = gruppen.get(key);
    if (vorhanden) vorhanden.rows.push(row);
    else gruppen.set(key, { key, field: row.field, ziel, rows: [row] });
  }
  return [...gruppen.values()];
}

/**
 * Was JETZT in den betroffenen Spalten steht.
 *
 * Eine Abfrage je Tabelle statt einer je Zeile, und jede mit dem
 * Workspace-Filter. Der Vergleich mit dem Protokoll entscheidet danach, ob
 * zurueckgeschrieben werden darf: steht dort etwas anderes, hat ein Mensch in
 * der App gearbeitet, und sein Text bleibt stehen.
 */
async function ladeAktuelleWerte(
  supabase: SupabaseClient,
  workspaceId: string,
  gruppen: UndoGruppe[]
): Promise<
  | { ok: true; werte: Map<string, string | null>; customFields: Map<string, Record<string, string>> }
  | { ok: false; error: { message?: string } | null }
> {
  const werte = new Map<string, string | null>();
  const customFields = new Map<string, Record<string, string>>();
  const ids = { businesses: new Set<string>(), contacts: new Set<string>(), offers: new Set<string>() };
  for (const g of gruppen) {
    if (g.ziel) ids[g.ziel.table].add(g.ziel.rowId);
  }

  if (ids.businesses.size > 0) {
    const { data, error } = await supabase
      .from("businesses")
      .select("id, personalization")
      .eq("workspace_id", workspaceId)
      .in("id", [...ids.businesses]);
    if (error) return { ok: false, error };
    for (const zeile of data ?? []) {
      werte.set(`businesses.personalization|${zeile.id}`, (zeile.personalization as string | null) ?? null);
    }
  }

  if (ids.contacts.size > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, outreach_status")
      .eq("workspace_id", workspaceId)
      .in("id", [...ids.contacts]);
    if (error) return { ok: false, error };
    for (const zeile of data ?? []) {
      werte.set(`contacts.outreach_status|${zeile.id}`, (zeile.outreach_status as string | null) ?? null);
    }
  }

  if (ids.offers.size > 0) {
    // OFFER_COLUMNS als Literal, nicht zusammengebaut: sonst faellt Supabase
    // auf GenericStringError zurueck (die Falle steht in lib/offers.ts).
    const { data, error } = await supabase
      .from("offers")
      .select(OFFER_COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("id", [...ids.offers]);
    if (error) return { ok: false, error };
    for (const roh of data ?? []) {
      const zeile = roh as unknown as Record<string, unknown>;
      const id = zeile.id as string;
      const custom =
        typeof zeile.custom_fields === "object" && zeile.custom_fields !== null && !Array.isArray(zeile.custom_fields)
          ? (zeile.custom_fields as Record<string, string>)
          : {};
      customFields.set(id, custom);
      for (const feld of OFFER_TEXT_FIELDS) {
        werte.set(`offers.${feld}|${id}`, typeof zeile[feld] === "string" ? (zeile[feld] as string) : null);
      }
      for (const [schluessel, wert] of Object.entries(custom)) {
        werte.set(`offers.custom_fields.${schluessel}|${id}`, typeof wert === "string" ? wert : null);
      }
    }
    // Ein eigenes Feld, dessen Schluessel in custom_fields gar nicht (mehr)
    // steht, gilt als leer und nicht als "Zeile weg": der Schreibvorgang von
    // damals hat ihn angelegt, jemand hat ihn danach entfernt.
    for (const g of gruppen) {
      if (g.ziel?.table === "offers" && g.ziel.key && customFields.has(g.ziel.rowId) && !werte.has(g.key)) {
        werte.set(g.key, null);
      }
    }
  }

  return { ok: true, werte, customFields };
}

/**
 * Ein Update je betroffener ZEILE, nicht je Feld.
 *
 * Zwei eigene Angebotsfelder derselben Zeile schreiben beide auf dasselbe
 * jsonb; nacheinander ausgefuehrt wuerde das zweite Update das erste wieder
 * herauswerfen, weil beide von demselben gelesenen Stand ausgehen.
 */
function buendleNachZeile(
  plan: UndoPlan[],
  customFields: Map<string, Record<string, string>>
): Map<
  string,
  { table: string; rowId: string; patch: Record<string, unknown>; eintraege: UndoPlan[] }
> {
  const buendel = new Map<
    string,
    { table: string; rowId: string; patch: Record<string, unknown>; eintraege: UndoPlan[] }
  >();
  for (const eintrag of plan) {
    const key = `${eintrag.ziel.table}|${eintrag.ziel.rowId}`;
    const vorhanden = buendel.get(key) ?? {
      table: eintrag.ziel.table,
      rowId: eintrag.ziel.rowId,
      patch: {} as Record<string, unknown>,
      eintraege: [] as UndoPlan[],
    };
    if (eintrag.ziel.key) {
      const bisher =
        (vorhanden.patch.custom_fields as Record<string, string> | undefined) ??
        { ...(customFields.get(eintrag.ziel.rowId) ?? {}) };
      // Kein alter Wert heisst: den Schluessel gab es vorher nicht. Ihn auf
      // null zu setzen waere ein leeres Feld, das es nie gab -- er wird
      // entfernt.
      if (eintrag.to === null) delete bisher[eintrag.ziel.key];
      else bisher[eintrag.ziel.key] = eintrag.to;
      vorhanden.patch.custom_fields = bisher;
    } else {
      vorhanden.patch[eintrag.ziel.column] = eintrag.to;
    }
    vorhanden.eintraege.push(eintrag);
    buendel.set(key, vorhanden);
  }
  return buendel;
}

/** Eine Zeile der Ergebnisliste von set_lead_icebreakers. Gekuerzt aus
 *  demselben Grund wie beschreibePlan: 50 Eintraege mit vollem Text waeren
 *  eine Antwort, die der Client hart abschneidet. */
function beschreibeIcebreaker(g: {
  business_id: string;
  company: string | null;
  previous_icebreaker: string | null;
  icebreaker: string;
  unchanged: boolean;
}) {
  return {
    business_id: g.business_id,
    company: g.company,
    previous_icebreaker: vorschau(g.previous_icebreaker),
    icebreaker: vorschau(g.icebreaker),
    unchanged: g.unchanged,
  };
}

function beschreibePlan(p: UndoPlan) {
  return {
    field: p.field,
    target_id: p.ziel.rowId,
    current_value: vorschau(p.from),
    restored_value: vorschau(p.to),
    log_ids: p.covers,
  };
}

/** Ein einzelner Wert aus offers.custom_fields, ohne Annahme ueber die Form
 *  der Spalte: sie ist jsonb und koennte alles enthalten. */
function leseCustomField(custom: unknown, key: string): string | null {
  if (typeof custom !== "object" || custom === null || Array.isArray(custom)) return null;
  const wert = (custom as Record<string, unknown>)[key];
  return typeof wert === "string" ? wert : null;
}

/**
 * Eine Zeile ins mcp_write_log.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DAS EIN FEHLER SEIN DARF, DER NUR IM SERVER-LOG LANDET
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Das Protokoll ist Nebensache fuer den Aufrufer, aber der einzige Nachweis
 * fuer den Menschen. Ein Fehler hier macht den Schreibvorgang nicht
 * rueckgaengig -- er ist bereits passiert; ihn dem Modell als Fehlschlag zu
 * melden, waere die schlechtere Auskunft, weil es dann ein zweites Mal
 * schriebe.
 *
 * Die drei Ziel-Spalten schliessen einander aus: business_id fuer einen Lead,
 * contact_id fuer einen Kontakt, offer_id fuer ein Angebot (Migration 0100).
 * Eine Notiz an einer Firma traegt business_id, eine an einer Person
 * contact_id -- so, wie es in notes selbst steht.
 */
type WriteLogEintrag = {
  business_id?: string | null;
  contact_id?: string | null;
  offer_id?: string | null;
  campaign_id?: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  /** Nur bei einer Wiederherstellung: die Zeile, die zurueckgenommen wird
   *  (Migration 0101). Sie ist die Markierung, an der undo_writes erkennt,
   *  dass hier schon zurueckgedreht wurde. */
  undo_of?: string | null;
};

async function protokolliere(
  supabase: SupabaseClient,
  ctx: McpToolContext,
  workspaceId: string,
  eintrag: WriteLogEintrag
): Promise<void> {
  await protokolliereViele(supabase, ctx, workspaceId, [eintrag]);
}

/**
 * Mehrere Protokollzeilen in EINEM Insert.
 *
 * Fuer set_lead_icebreakers und undo_writes: die Spur bleibt genauso fein wie
 * bei einem Einzelwerkzeug (eine Zeile je geaendertem Datensatz), kostet aber
 * eine Rundreise statt fuenfzig.
 */
async function protokolliereViele(
  supabase: SupabaseClient,
  ctx: McpToolContext,
  workspaceId: string,
  eintraege: WriteLogEintrag[]
): Promise<void> {
  if (eintraege.length === 0) return;
  const { error } = await supabase.from("mcp_write_log").insert(
    eintraege.map((eintrag) => ({
      token_id: ctx.tokenId,
      user_id: ctx.userId,
      workspace_id: workspaceId,
      business_id: eintrag.business_id ?? null,
      contact_id: eintrag.contact_id ?? null,
      offer_id: eintrag.offer_id ?? null,
      campaign_id: eintrag.campaign_id ?? null,
      field: eintrag.field,
      old_value: eintrag.old_value,
      new_value: eintrag.new_value,
      undo_of: eintrag.undo_of ?? null,
    }))
  );
  if (error) console.error("[mcp] mcp_write_log nicht geschrieben:", error.message);
}

/** Die Werkzeugliste fuer tools/list, in der Reihenfolge der Registry. */
export function listTools() {
  return (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    name,
    title: TOOLS[name].title,
    description: TOOLS[name].description,
    inputSchema: TOOLS[name].inputSchema,
    annotations: TOOLS[name].annotations,
  }));
}

/**
 * Dieselbe Liste, aber nur mit dem, was dieser Token auch ausfuehren darf.
 *
 * Die Spezifikation erlaubt das ausdruecklich: die Werkzeugmenge "MAY vary by
 * the authorization presented on the request", weil Zugangsdaten pro Anfrage
 * kommen und nicht an einer Verbindung haengen. Ein Nur-Lese-Token sieht
 * set_lead_icebreaker deshalb gar nicht erst -- besser, als es anzubieten und
 * dann jeden Aufruf abzulehnen.
 */
export function listToolsForScope(scope: McpScope | string) {
  return listTools().filter((tool) => requireScope(scope, TOOLS[tool.name].scope));
}

export function isToolName(name: unknown): name is ToolName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(TOOLS, name);
}

/**
 * Ein Werkzeug ausfuehren, mit dem Netz drumherum.
 *
 * Eine unerwartete Ausnahme (Netzabbruch zur Datenbank, kaputtes JSON aus
 * einer Spalte) wird zum Werkzeugfehler und nicht zu einem 500er: das Modell
 * kann es dann nochmal versuchen, statt die Verbindung fuer tot zu halten.
 */
export async function callTool(
  supabase: SupabaseClient,
  ctx: McpToolContext,
  name: unknown,
  args: unknown
): Promise<ToolCallResult> {
  if (!isToolName(name)) {
    return fail(
      `Unknown tool "${String(name)}". Call tools/list for the tools this server offers.`
    );
  }
  const argumente =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as ToolArgs)
      : {};
  try {
    return await TOOLS[name].handler(supabase, ctx, argumente);
  } catch (err) {
    console.error(`[mcp] ${name} warf eine Ausnahme:`, err);
    return fail(`The tool "${name}" failed unexpectedly. Try again.`);
  }
}
