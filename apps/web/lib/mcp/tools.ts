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
 * Kein zod: das Repo hat es nicht, und eine Abhaengigkeit fuer sieben
 * Werkzeuge mit zusammen elf Argumenten waere ein schlechter Tausch. Die
 * Pruefer unten (readString, readCount) sind die einzige Stelle, an der
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
        .select("id, name, query, location, source, status, created_at, archived_at, instantly_campaign_id, businesses(count)")
        .eq("workspace_id", tor.workspaceId)
        // Der Papierkorb (Migration 0010) ist in der App unsichtbar und soll
        // es hier auch sein.
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return dbFail("list_lead_lists", error);

      return okJson({
        lead_lists: (data ?? []).map((s) => ({
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
        .limit(200);
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
    annotations: {
      title: "Set lead icebreaker",
      readOnlyHint: false,
      // Es ueberschreibt ein Textfeld, es loescht nichts und legt nichts an.
      destructiveHint: false,
      // Zweimal derselbe Text ergibt denselben Zustand.
      idempotentHint: true,
      openWorldHint: false,
    },
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

      // Das Protokoll ist Nebensache fuer den Aufrufer, aber der einzige
      // Nachweis fuer den Menschen. Ein Fehler hier macht den Schreibvorgang
      // nicht rueckgaengig -- er ist bereits passiert; ihn zu verschweigen
      // waere schlimmer als eine Zeile ohne Protokolleintrag.
      const { error: logFehler } = await supabase.from("mcp_write_log").insert({
        token_id: ctx.tokenId,
        user_id: ctx.userId,
        workspace_id: tor.workspaceId,
        business_id: businessId,
        field: "businesses.personalization",
        old_value: vorher.personalization ?? null,
        new_value: icebreaker,
      });
      if (logFehler) console.error("[mcp] mcp_write_log nicht geschrieben:", logFehler.message);

      return okJson({
        business_id: businessId,
        company: vorher.name,
        previous_icebreaker: vorher.personalization ?? null,
        icebreaker,
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
