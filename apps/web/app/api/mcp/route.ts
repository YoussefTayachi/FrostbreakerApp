import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  allowedWorkspaceIds,
  isTokenUsable,
  type McpTokenRow,
} from "@/lib/mcp/authorize";
import { hashToken, parseBearer } from "@/lib/mcp/token";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/tool-descriptions";
import { callTool, listToolsForScope, type McpToolContext } from "@/lib/mcp/tools";
import {
  detectEra,
  discoverResult,
  initializeResult,
  isNotification,
  parseRpcBody,
  rpcError,
  rpcResult,
  RPC_ERRORS,
  validateModernHeaders,
  withEra,
  type Era,
  type JsonRpcId,
  type JsonRpcRequest,
  type RpcErrorShape,
  type ServerInfo,
} from "@/lib/mcp/protocol";

/**
 * Der MCP-Endpunkt: ein Nutzer liest seine Frostbreaker-Daten aus SEINEM
 * Claude und schreibt genau ein Feld zurueck.
 *
 * Diese Datei haelt nur Reihenfolge und IO. Alles Entscheidbare liegt in
 * lib/mcp/* und ist dort getestet: das Protokoll in protocol.ts, der Zuschnitt
 * in authorize.ts, die Werkzeuge in tools.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * KEIN OAUTH, UND DAS MIT ABSICHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ein fehlender oder falscher Token ergibt eine nackte 401 -- OHNE
 * WWW-Authenticate mit OAuth-Metadaten und ohne
 * /.well-known/oauth-protected-resource. Beides waere die ausdrueckliche
 * Einladung an claude.ai, einen OAuth-Fluss zu starten, den es hier nicht
 * gibt: der Nutzer bekaeme statt "Token falsch" ein Anmeldefenster, das ins
 * Leere laeuft.
 *
 * nodejs-Runtime, nicht Edge: hashToken nutzt node:crypto.
 */
export const runtime = "nodejs";

const SERVER_INFO: ServerInfo = { name: "frostbreaker", version: "1.0.0" };

/**
 * Woher ein Browser diesen Endpunkt ansprechen duerfte.
 *
 * Der Normalfall hat GAR KEINEN Origin: Claude Code und claude.ai rufen
 * serverseitig auf, ein Origin-Header entsteht dabei nicht. Fehlt er, ist das
 * also in Ordnung. Ist er da und steht nicht auf dieser Liste, kommt der
 * Aufruf aus einer fremden Seite im Browser eines eingeloggten Nutzers --
 * dagegen die 403.
 */
const ALLOWED_ORIGINS = [
  "https://app.frostbreaker.app",
  "https://system3-app.vercel.app",
  "http://localhost:3000",
  "http://localhost:3200",
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
].filter((o): o is string => Boolean(o));

/** Ab wann last_used_at wieder fortgeschrieben wird. Ohne diese Drosselung
 *  kostete JEDER Werkzeugaufruf einen zusaetzlichen Schreibvorgang auf
 *  mcp_tokens, nur um eine Anzeige in den Einstellungen zu aktualisieren, die
 *  auf die Minute genau niemanden interessiert. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Antworthelfer
// ─────────────────────────────────────────────────────────────────────────

/** Immer JSON, nie SSE, und niemals eine Mcp-Session-Id: dieser Server ist
 *  zustandslos, eine Sitzungskennung waere ein Versprechen, das er nicht
 *  einloest. */
function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fehlerAntwort(id: JsonRpcId | undefined, fehler: RpcErrorShape) {
  return json(rpcError(id, fehler), fehler.httpStatus);
}

function nichtAngemeldet() {
  return json(
    {
      error: "unauthorized",
      message:
        "Missing or invalid bearer token. Create one in Frostbreaker under Settings and send it as 'Authorization: Bearer fbk_mcp_...'.",
    },
    401
  );
}

// ─────────────────────────────────────────────────────────────────────────
// POST: der einzige Weg hinein
// ─────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: "forbidden_origin" }, 403);
  }

  // ── 1. Token ──────────────────────────────────────────────────────────
  const klartext = parseBearer(request.headers.get("authorization"));
  if (!klartext) return nichtAngemeldet();

  /**
   * Service-Role ist hier zwingend, nicht bequem.
   *
   * Der Aufruf kommt ohne Supabase-Session: es gibt kein Cookie und keinen
   * User-JWT, auth.uid() ist NULL. Jede Policy dieser App laeuft ueber
   * is_workspace_member(), das damit false ergibt -- der session-gebundene
   * Client aus lib/supabase/server.ts bekaeme null Zeilen zurueck, und zwar
   * ohne Fehlermeldung. Der Server saehe eine leere, scheinbar korrekte
   * Datenbank.
   *
   * Der Ausgleich dafuer steht in lib/mcp/tools.ts: RLS sagt nicht mehr nein,
   * also filtert JEDE Abfrage zusaetzlich auf eine workspace_id, die vorher
   * durch assertWorkspaceAllowed gegangen ist (Schnittmenge aus
   * workspace_members und der Einschraenkung des Tokens). Wer diesen Client
   * behaelt und den Filter weglaesst, liefert fremde Leads aus.
   */
  /**
   * createServiceClient wirft, wenn SUPABASE_SERVICE_ROLE_KEY fehlt. Ohne
   * dieses catch quittiert Next das mit einer nackten 500 ohne Body, und ein
   * MCP-Client zeigt dem Nutzer dann nur "server error" -- gemessen am
   * 2026-08-22 auf dem Dev-Server, wo die Variable in .env.local nicht steht.
   * Auf Vercel ist sie gesetzt (api/billing/webhook, api/cron/instantly-sync
   * und api/unsubscribe laufen dort ueber denselben Client), der Fall trifft
   * also vor allem lokale Einrichtung -- und genau da hilft ein klarer Satz.
   */
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[mcp] Service-Client nicht erzeugbar:", err);
    return json(
      {
        error: "server_misconfigured",
        message: "The Frostbreaker MCP server is not configured correctly. Contact the workspace owner.",
      },
      500
    );
  }

  const { data: token, error: tokenFehler } = await supabase
    .from("mcp_tokens")
    .select("id, user_id, workspace_id, scope, expires_at, revoked_at, last_used_at")
    .eq("token_hash", hashToken(klartext))
    .maybeSingle<McpTokenRow & { last_used_at: string | null }>();

  if (tokenFehler) {
    console.error("[mcp] Token-Lookup fehlgeschlagen:", tokenFehler.message);
    return json({ error: "internal_error" }, 500);
  }
  // Unbekannt, abgelaufen und widerrufen ergeben dieselbe Antwort: ein
  // Unterschied verriete, welche Token existieren.
  if (!token || !isTokenUsable(token)) return nichtAngemeldet();

  // ── 2. Reichweite, bei JEDEM Aufruf neu ───────────────────────────────
  // Der Server ist zustandslos; ein "Verbinden", bei dem man das einmal
  // festhalten koennte, gibt es nicht. Genau deshalb wirkt das Entfernen
  // eines Mitglieds ab dem naechsten Werkzeugaufruf.
  const { data: mitgliedschaften, error: mitgliedFehler } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", token.user_id);
  if (mitgliedFehler) {
    console.error("[mcp] workspace_members nicht lesbar:", mitgliedFehler.message);
    return json({ error: "internal_error" }, 500);
  }

  const ctx: McpToolContext = {
    allowedWorkspaceIds: allowedWorkspaceIds(
      (mitgliedschaften ?? []).map((m) => m.workspace_id as string),
      token.workspace_id
    ),
    scope: token.scope,
    tokenId: token.id,
    userId: token.user_id,
  };

  await markiereBenutzung(supabase, token);

  // ── 3. Body ───────────────────────────────────────────────────────────
  const roh = await request.text();
  const geparst = parseRpcBody(roh);
  if (!geparst.ok) return fehlerAntwort(undefined, geparst.error);
  const rpc = geparst.request;

  // Eine Notification erwartet keine Antwort. 202 ohne Body ist die einzige
  // Form, die JSON-RPC dafuer zulaesst -- ein Ergebnisobjekt waere ein
  // Protokollfehler, den manche Clients als Zuordnungsfehler melden.
  if (isNotification(rpc)) return new NextResponse(null, { status: 202 });

  // ── 4. Zeitalter ──────────────────────────────────────────────────────
  const era = detectEra(rpc);
  if (era === "modern") {
    const kopfFehler = validateModernHeaders(request.headers, rpc);
    if (kopfFehler) return fehlerAntwort(rpc.id, kopfFehler);
  }

  return dispatch(supabase, ctx, rpc, era);
}

// ─────────────────────────────────────────────────────────────────────────
// Die Methoden
// ─────────────────────────────────────────────────────────────────────────

async function dispatch(
  supabase: ReturnType<typeof createServiceClient>,
  ctx: McpToolContext,
  rpc: JsonRpcRequest,
  era: Era
) {
  switch (rpc.method) {
    /**
     * Der Ersatz fuer den abgeschafften Handshake. MUSS beantwortet werden:
     * ein moderner Client erfaehrt nur hier, welche Versionen dieser Server
     * kann und was er anbietet.
     */
    case "server/discover":
      return json(rpcResult(rpc.id, discoverResult(SERVER_INFO, SERVER_INSTRUCTIONS)));

    /** Das alte Zeitalter. Antwort ohne resultType -- den kennt es nicht. */
    case "initialize":
      return json(
        rpcResult(
          rpc.id,
          initializeResult(rpc.params?.protocolVersion, SERVER_INFO, SERVER_INSTRUCTIONS)
        )
      );

    case "tools/list":
      /**
       * Nur die Werkzeuge, die DIESER Token auch ausfuehren darf.
       *
       * Die Spezifikation erlaubt das ausdruecklich: die Werkzeugmenge "MAY
       * vary by the authorization presented on the request", weil Zugangsdaten
       * hier pro Anfrage kommen und nicht an einer Verbindung haengen. Ein
       * Nur-Lese-Token sieht set_lead_icebreaker deshalb gar nicht erst --
       * besser, als es anzubieten und jeden Aufruf abzulehnen. Der Handler
       * prueft den Scope trotzdem nochmal; diese Zeile ist Bequemlichkeit fuer
       * das Modell, nicht die Absicherung.
       */
      return json(rpcResult(rpc.id, withEra(era, { tools: listToolsForScope(ctx.scope) })));

    case "tools/call": {
      const ergebnis = await callTool(supabase, ctx, rpc.params?.name, rpc.params?.arguments);
      // isError gehoert IN das Ergebnis, nicht in einen JSON-RPC-Fehler: ein
      // fachlicher Fehler ("Workspace nicht erlaubt") soll das Modell lesen
      // und sich korrigieren koennen, statt die Verbindung als kaputt
      // erscheinen zu lassen.
      return json(rpcResult(rpc.id, withEra(era, ergebnis)));
    }

    /** Ein Lebenszeichen, mehr nicht. Beide Zeitalter kennen es. */
    case "ping":
      return json(rpcResult(rpc.id, withEra(era, {})));

    default:
      return fehlerAntwort(rpc.id, {
        code: RPC_ERRORS.METHOD_NOT_FOUND,
        message: `Unknown method: ${rpc.method}.`,
        // Modern verlangt ausdruecklich 404 fuer eine unbekannte Methode; im
        // alten Zeitalter traegt der Fehler im Body die Nachricht und HTTP
        // bleibt 200, sonst halten aeltere Clients die Antwort fuer einen
        // Transportfehler und melden gar keinen Methodenfehler.
        httpStatus: era === "modern" ? 404 : 200,
      });
  }
}

/**
 * last_used_at gedrosselt fortschreiben.
 *
 * Ein Fehler dabei ist folgenlos und darf den Aufruf nicht scheitern lassen --
 * es ist eine Anzeige in den Einstellungen, keine Zugriffsentscheidung.
 */
async function markiereBenutzung(
  supabase: ReturnType<typeof createServiceClient>,
  token: McpTokenRow & { last_used_at?: string | null }
) {
  const zuletzt = token.last_used_at ? Date.parse(token.last_used_at) : NaN;
  const frisch = !Number.isNaN(zuletzt) && Date.now() - zuletzt < LAST_USED_THROTTLE_MS;
  if (frisch) return;
  const { error } = await supabase
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", token.id);
  if (error) console.error("[mcp] last_used_at nicht gesetzt:", error.message);
}

// ─────────────────────────────────────────────────────────────────────────
// Alles andere
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET waere im alten Zeitalter der SSE-Kanal fuer Servernachrichten, DELETE
 * das Beenden einer Sitzung. Dieser Server hat weder das eine noch das andere:
 * er antwortet auf jeden POST einmal und vergisst danach alles. 405 sagt genau
 * das -- die Route gibt es, diese Methode nicht.
 */
export async function GET() {
  return json({ error: "method_not_allowed", message: "This MCP endpoint only accepts POST." }, 405);
}

export async function DELETE() {
  return json({ error: "method_not_allowed", message: "This MCP endpoint only accepts POST." }, 405);
}
