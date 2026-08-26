import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { TOKEN_PREFIX, hashToken } from "@/lib/mcp/token";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  generateSecret,
  grantedScopeString,
  oauthError,
  publicOrigin,
  verifyPkce,
} from "@/lib/mcp/oauth";
import type { McpScope } from "@/lib/mcp/authorize";

/**
 * Der Token-Endpunkt: Code gegen Zugriffstoken, und Refresh gegen neuen
 * Zugriffstoken.
 *
 * Die schaerfste Stelle des ganzen Flusses. Was hier durchrutscht, ist ein
 * Zugang zu fremden Leads. Deshalb steht jede Pruefung ausgeschrieben da,
 * statt sich hinter einer Hilfsfunktion zu verstecken, und die Reihenfolge
 * unten ist die aus RFC 6749 §4.1.3 -- nicht die bequemste.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DER CODE WIRD IN DER DATENBANK VERBRAUCHT, NICHT IM CODE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Einmaligkeit erzwingt ein UPDATE ... WHERE consumed_at IS NULL
 * RETURNING, kein "erst lesen, dann pruefen, dann schreiben". Der Unterschied
 * zaehlt genau dann, wenn zwei Anfragen mit demselben Code gleichzeitig
 * ankommen: beim Lesen-dann-Schreiben sehen beide "noch nicht verbraucht" und
 * beide bekommen einen Token. Beim UPDATE gewinnt einer, und der andere
 * bekommt null Zeilen zurueck.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CodeRow = {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: McpScope;
  workspace_id: string | null;
  resource: string | null;
  expires_at: string;
};

export async function POST(request: Request) {
  // RFC 6749 §4.1.3 verlangt application/x-www-form-urlencoded. Manche Clients
  // schicken trotzdem JSON; beides anzunehmen kostet vier Zeilen und spart die
  // Sorte Fehlersuche, bei der am Ende ein Content-Type schuld war.
  let form: URLSearchParams;
  try {
    const roh = await request.text();
    const typ = request.headers.get("content-type") ?? "";
    if (typ.includes("application/json")) {
      const obj = JSON.parse(roh) as Record<string, unknown>;
      form = new URLSearchParams(
        Object.entries(obj).map(([k, v]) => [k, String(v)] as [string, string])
      );
    } else {
      form = new URLSearchParams(roh);
    }
  } catch {
    return json(oauthError("invalid_request", "Could not parse the request body."), 400);
  }

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[oauth/token] Service-Client nicht erzeugbar:", err);
    return json(oauthError("server_error", "The server is not configured correctly."), 500);
  }

  // Beilaeufiges Aufraeumen. Fehler hier sind folgenlos und duerfen den Tausch
  // nicht scheitern lassen -- es ist Hausputz, keine Zugriffsentscheidung.
  void supabase.rpc("purge_expired_oauth_codes").then(
    () => {},
    (err: unknown) => console.error("[oauth/token] Aufraeumen fehlgeschlagen:", err)
  );

  const grantType = form.get("grant_type");
  const origin = publicOrigin(request.headers, request.url);

  if (grantType === "authorization_code") {
    return codeGegenToken(supabase, form, origin);
  }
  if (grantType === "refresh_token") {
    return refreshGegenToken(supabase, form);
  }
  return json(
    oauthError(
      "unsupported_grant_type",
      'Only "authorization_code" and "refresh_token" are supported.'
    ),
    400
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Code gegen Token
// ─────────────────────────────────────────────────────────────────────────

async function codeGegenToken(
  supabase: ReturnType<typeof createServiceClient>,
  form: URLSearchParams,
  origin: string
) {
  const code = form.get("code");
  const clientId = form.get("client_id");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");

  if (!code || !clientId || !redirectUri) {
    return json(
      oauthError("invalid_request", "code, client_id and redirect_uri are required."),
      400
    );
  }
  if (!codeVerifier) {
    // PKCE ist hier nicht optional. Ein Fluss ohne Verifier waere fuer einen
    // oeffentlichen Client ungeschuetzt, und oeffentlich sind hier alle.
    return json(oauthError("invalid_request", "code_verifier is required (PKCE, S256)."), 400);
  }

  const codeHash = hashToken(code);

  // Der Verbrauch. Siehe Kopfkommentar: das WHERE traegt die Einmaligkeit.
  const { data: verbraucht, error: updateFehler } = await supabase
    .from("mcp_oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .select("*")
    .maybeSingle<CodeRow>();

  if (updateFehler) {
    console.error("[oauth/token] Code-Verbrauch fehlgeschlagen:", updateFehler.message);
    return json(oauthError("server_error", "Could not redeem the authorization code."), 500);
  }

  if (!verbraucht) {
    /**
     * Kein Treffer heisst: den Code gibt es nicht -- oder es gab ihn und er ist
     * schon eingeloest. Der zweite Fall ist ein Wiedereinspielversuch, und
     * RFC 6749 §4.1.2 sagt dazu, was zu tun ist: die aus diesem Code
     * ausgestellten Token widerrufen. Der Gedanke dahinter ist, dass ein
     * zweites Einloesen fast immer bedeutet, dass der Code jemandem in die
     * Haende gefallen ist -- und dann ist der bereits ausgestellte Token
     * ebenfalls verdaechtig.
     *
     * Wir widerrufen dabei alle OAuth-Token dieses Menschen fuer diesen
     * Client. Genauer geht es nicht, ohne den Code an den Token zu binden, und
     * gruendlicher zu sein ist hier die richtige Richtung: der Preis ist ein
     * erneutes Verbinden, der Preis der Gegenrichtung ist ein fremder Zugang.
     */
    const { data: bekannt } = await supabase
      .from("mcp_oauth_codes")
      .select("user_id, client_id")
      .eq("code_hash", codeHash)
      .maybeSingle<{ user_id: string; client_id: string }>();

    if (bekannt) {
      console.warn(
        `[oauth/token] Code doppelt eingeloest (client ${bekannt.client_id}) -- widerrufe dessen Token.`
      );
      const { error } = await supabase
        .from("mcp_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", bekannt.user_id)
        .eq("client_id", bekannt.client_id)
        .eq("kind", "oauth")
        .is("revoked_at", null);
      if (error) console.error("[oauth/token] Widerruf nach Doppeleinloesung:", error.message);
    }
    return json(oauthError("invalid_grant", "The authorization code is invalid or already used."), 400);
  }

  // Ab hier ist der Code verbraucht -- auch wenn eine der Pruefungen unten
  // scheitert. Genau so soll es sein: ein Code, an dem herumprobiert wurde,
  // darf nicht beim zweiten Versuch doch noch aufgehen.

  if (Date.parse(verbraucht.expires_at) <= Date.now()) {
    return json(oauthError("invalid_grant", "The authorization code has expired."), 400);
  }
  if (verbraucht.client_id !== clientId) {
    return json(oauthError("invalid_grant", "The code was not issued to this client."), 400);
  }
  if (verbraucht.redirect_uri !== redirectUri) {
    // RFC 6749 §4.1.3: das redirect_uri muss identisch zu dem sein, das beim
    // /authorize dabeistand. Ohne diese Zeile liesse sich ein abgefangener
    // Code an einem anderen Ziel einloesen.
    return json(oauthError("invalid_grant", "redirect_uri does not match the authorization request."), 400);
  }
  if (!verifyPkce(codeVerifier, verbraucht.code_challenge, verbraucht.code_challenge_method)) {
    return json(oauthError("invalid_grant", "code_verifier does not match the code_challenge."), 400);
  }
  if (verbraucht.resource && !zeigtHierher(verbraucht.resource, origin)) {
    // RFC 8707. Ein Token, der fuer eine FREMDE Ressource erbeten wurde, wird
    // hier nicht ausgestellt.
    return json(oauthError("invalid_target", "The requested resource does not match this server."), 400);
  }

  return tokenAusstellen(supabase, {
    userId: verbraucht.user_id,
    clientId: verbraucht.client_id,
    scope: verbraucht.scope,
    workspaceId: verbraucht.workspace_id,
  });
}

/**
 * Meint dieser resource-Parameter (RFC 8707) diesen Server?
 *
 * Verglichen wird die HERKUNFT, nicht die vollstaendige Adresse. Der Grund ist
 * Bestandsaufnahme, nicht Bequemlichkeit: die Clients sind sich uneinig,
 * was sie hineinschreiben. Manche nennen den kanonischen MCP-Endpunkt
 * ("https://app.frostbreaker.app/api/mcp"), manche nur den Server
 * ("https://app.frostbreaker.app"), manche haengen einen Schraegstrich an. Ein
 * zeichengenauer Vergleich haette bei zweien davon einen harten
 * Verbindungsabbruch ergeben, und zwar an der Stelle, an der ein Nutzer
 * bereits zugestimmt hat.
 *
 * Was dabei nicht verlorengeht: der Zweck dieser Pruefung ist, einen Token
 * fuer eine FREMDE Ressource zu verhindern. Dieser Server hat genau eine, und
 * jede Adresse mit unserer Herkunft meint sie eindeutig. Zeigt der Parameter
 * woandershin, faellt er hier weiterhin durch.
 */
function zeigtHierher(resource: string, origin: string): boolean {
  try {
    return new URL(resource).origin === origin;
  } catch {
    // Keine gueltige Adresse: dann ist sie auch nicht unsere.
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Refresh gegen Token
// ─────────────────────────────────────────────────────────────────────────

async function refreshGegenToken(
  supabase: ReturnType<typeof createServiceClient>,
  form: URLSearchParams
) {
  const refresh = form.get("refresh_token");
  const clientId = form.get("client_id");
  if (!refresh) {
    return json(oauthError("invalid_request", "refresh_token is required."), 400);
  }

  const { data: zeile, error } = await supabase
    .from("mcp_tokens")
    .select("id, user_id, client_id, scope, workspace_id, revoked_at, refresh_expires_at")
    .eq("refresh_token_hash", hashToken(refresh))
    .maybeSingle<{
      id: string;
      user_id: string;
      client_id: string | null;
      scope: McpScope;
      workspace_id: string | null;
      revoked_at: string | null;
      refresh_expires_at: string | null;
    }>();

  if (error) {
    console.error("[oauth/token] Refresh-Lookup fehlgeschlagen:", error.message);
    return json(oauthError("server_error", "Could not refresh the token."), 500);
  }
  // Unbekannt, widerrufen und abgelaufen ergeben dieselbe Antwort -- ein
  // Unterschied verriete, welche Refresh-Token existieren.
  if (!zeile || zeile.revoked_at) {
    return json(oauthError("invalid_grant", "The refresh token is invalid or has been revoked."), 400);
  }
  if (zeile.refresh_expires_at && Date.parse(zeile.refresh_expires_at) <= Date.now()) {
    return json(oauthError("invalid_grant", "The refresh token has expired."), 400);
  }
  if (clientId && zeile.client_id && clientId !== zeile.client_id) {
    return json(oauthError("invalid_grant", "The refresh token was not issued to this client."), 400);
  }

  /**
   * Rotation: der neue Refresh-Token ersetzt den alten IN DERSELBEN ZEILE.
   *
   * Damit ist der alte im selben Moment wertlos, in dem der neue entsteht --
   * es gibt keinen Zeitpunkt, an dem beide gelten. Das ist die Empfehlung aus
   * OAuth 2.1 fuer oeffentliche Clients und der Grund, warum ein einmal
   * abgefangener Refresh-Token nicht dauerhaft nutzbar bleibt: benutzt ihn der
   * Angreifer, faellt der echte Client beim naechsten Erneuern auf einen
   * ungueltigen Token und der Mensch verbindet neu.
   */
  const access = generateSecret(TOKEN_PREFIX);
  const neuerRefresh = generateSecret(REFRESH_PREFIX);
  const jetzt = Date.now();

  const { error: updateFehler } = await supabase
    .from("mcp_tokens")
    .update({
      token_hash: access.hash,
      token_prefix: access.value.slice(0, TOKEN_PREFIX.length + 6),
      refresh_token_hash: neuerRefresh.hash,
      expires_at: new Date(jetzt + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      refresh_expires_at: new Date(jetzt + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
      last_used_at: new Date(jetzt).toISOString(),
    })
    .eq("id", zeile.id)
    .is("revoked_at", null);

  if (updateFehler) {
    console.error("[oauth/token] Rotation fehlgeschlagen:", updateFehler.message);
    return json(oauthError("server_error", "Could not refresh the token."), 500);
  }

  return tokenAntwort(access.value, neuerRefresh.value, zeile.scope);
}

// ─────────────────────────────────────────────────────────────────────────
// Ausstellen
// ─────────────────────────────────────────────────────────────────────────

async function tokenAusstellen(
  supabase: ReturnType<typeof createServiceClient>,
  opts: { userId: string; clientId: string; scope: McpScope; workspaceId: string | null }
) {
  const { data: client } = await supabase
    .from("mcp_oauth_clients")
    .select("client_name")
    .eq("client_id", opts.clientId)
    .maybeSingle<{ client_name: string | null }>();

  const access = generateSecret(TOKEN_PREFIX);
  const refresh = generateSecret(REFRESH_PREFIX);
  const jetzt = Date.now();

  const { error } = await supabase.from("mcp_tokens").insert({
    user_id: opts.userId,
    workspace_id: opts.workspaceId,
    // Der Name steht in den Einstellungen neben den von Hand erzeugten Token.
    // Deshalb der Client-Name und nicht die client_id: "Claude" ist das, was
    // der Mensch wiedererkennt, wenn er entscheidet, was er widerruft.
    name: client?.client_name ?? "MCP connector",
    token_hash: access.hash,
    token_prefix: access.value.slice(0, TOKEN_PREFIX.length + 6),
    scope: opts.scope,
    kind: "oauth",
    client_id: opts.clientId,
    refresh_token_hash: refresh.hash,
    expires_at: new Date(jetzt + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refresh_expires_at: new Date(jetzt + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
  });

  if (error) {
    console.error("[oauth/token] Token anlegen fehlgeschlagen:", error.message);
    return json(oauthError("server_error", "Could not issue an access token."), 500);
  }

  void supabase
    .from("mcp_oauth_clients")
    .update({ last_used_at: new Date(jetzt).toISOString() })
    .eq("client_id", opts.clientId)
    .then(
      () => {},
      () => {}
    );

  return tokenAntwort(access.value, refresh.value, opts.scope);
}

function tokenAntwort(access: string, refresh: string, scope: McpScope) {
  return json(
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refresh,
      scope: grantedScopeString(scope),
    },
    200
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      // RFC 6749 §5.1 verlangt beides ausdruecklich: ein zwischengespeicherter
      // Zugriffstoken waere ein Geheimnis in einem Proxy.
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}
