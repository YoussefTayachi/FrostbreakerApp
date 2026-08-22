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
import { instantlyHtmlToPlainText } from "@/lib/instantly/campaigns";
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
 * Kein zod: das Repo hat es nicht, und eine Abhaengigkeit fuer vierzehn
 * Werkzeuge mit zusammen gut zwanzig Argumenten waere ein schlechter Tausch.
 * Die Pruefer unten (readString, readCount) sind die einzige Stelle, an der
 * Eingaben angefasst werden.
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

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
/** Deckel fuer die beiden Werkzeuge ohne eigene Blaetterung (Listen-Uebersicht
 *  und Kampagnenzahlen). Beide liefern je Zeile nur Zahlen und kurze Namen,
 *  keine Freitexte -- 200 Zeilen davon bleiben deutlich unter der
 *  Ausgabegrenze, waehrend 200 LEADS sie reissen wuerden. */
const LIST_CAP = 200;
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

      const { data, error } = await supabase
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
        .limit(LIST_CAP);
      if (error) return dbFail("list_lead_lists", error);

      const listen = data ?? [];
      return okJson({
        // Ohne offset in diesem Werkzeug: waere der Deckel erreicht, fehlten
        // Listen, ohne dass es jemandem auffiele. Der Hinweis sagt es.
        ...(listen.length >= LIST_CAP
          ? {
              note: `Only the ${LIST_CAP} most recent lead lists are shown. Older ones exist in Frostbreaker.`,
            }
          : {}),
        lead_lists: listen.map((s) => ({
          search_id: s.id,
          // searches.name ist optional; die App zeigt dann die Suchanfrage,
          // und ein Modell braucht denselben Ersatz.
          name: s.name ?? s.query,
          query: s.query,
          location: s.location,
          source: s.source,
          status: s.status,
          lead_count: leadCount(s.businesses),
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

      const { data, error, count } = await supabase
        .from("businesses")
        .select(
          "id, name, website, company_summary, personalization, decisionmaker_status, hunter_status, created_at, contacts(id, full_name, title, email, seniority, source)",
          { count: "exact" }
        )
        .eq("workspace_id", tor.workspaceId)
        .eq("search_id", searchId)
        // Zweites Sortierkriterium, damit die Seiten nicht ineinander rutschen:
        // created_at ist bei einem Suchlauf fuer viele Zeilen identisch, und
        // ohne eindeutigen Tie-Break liefert Postgres bei range() nicht
        // zwingend dieselbe Reihenfolge.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset.value, offset.value + limit.value - 1);
      if (error) return dbFail("get_leads", error);

      const leads = (data ?? []).map((b) => ({
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
        })),
      }));
      const total = count ?? leads.length;

      return okUntrusted("leads", {
        search_id: searchId,
        total,
        limit: limit.value,
        offset: offset.value,
        has_more: offset.value + leads.length < total,
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
        leads_without_icebreaker: {
          count: ohneIcebreaker.count ?? 0,
          note: "Counted across every lead list of this workspace, including archived ones.",
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
async function protokolliere(
  supabase: SupabaseClient,
  ctx: McpToolContext,
  workspaceId: string,
  eintrag: {
    business_id?: string | null;
    contact_id?: string | null;
    offer_id?: string | null;
    field: string;
    old_value: string | null;
    new_value: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("mcp_write_log").insert({
    token_id: ctx.tokenId,
    user_id: ctx.userId,
    workspace_id: workspaceId,
    business_id: eintrag.business_id ?? null,
    contact_id: eintrag.contact_id ?? null,
    offer_id: eintrag.offer_id ?? null,
    field: eintrag.field,
    old_value: eintrag.old_value,
    new_value: eintrag.new_value,
  });
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
