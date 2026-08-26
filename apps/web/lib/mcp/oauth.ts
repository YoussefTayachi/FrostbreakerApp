import crypto from "crypto";
import { hashToken } from "@/lib/mcp/token";
import type { McpScope } from "@/lib/mcp/authorize";

/**
 * Der OAuth-Teil des MCP-Zugangs: was ein Konnektor braucht, damit ein Mensch
 * ihn mit einem Klick verbindet statt mit einem kopierten Token.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DAS HIER UEBERHAUPT STEHT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis zum 2026-08-26 kannte dieser Server nur statische Bearer-Token, und im
 * Kopf von app/api/mcp/route.ts stand ausdruecklich, dass OAuth fehlt und das
 * Absicht sei. Die Begruendung war richtig, solange es keinen OAuth-Fluss gab:
 * ein WWW-Authenticate mit OAuth-Metadaten haette claude.ai in eine Anmeldung
 * geschickt, die ins Leere laeuft.
 *
 * Der Preis dafuer war aber, dass es keinen Konnektor geben konnte. claude.ai
 * und Claude Desktop haben in ihrer Konnektor-Maske kein Feld fuer einen
 * eigenen Header -- sie kennen genau zwei Faelle: offen oder OAuth. Wer den
 * Server trotzdem nutzen wollte, musste ihn ueber mcp-remote einbinden, also
 * ueber ein npx-Paket, das den Token als Umgebungsvariable durchreicht, bei
 * Leerzeichen in Windows-Pfaden zerbricht und bei jedem Start neu aus dem Netz
 * geladen wird. Das ist die Quelle der wiederkehrenden Fehler gewesen, nicht
 * der Server.
 *
 * Also: der Fluss existiert jetzt, und damit darf die 401 auch darauf zeigen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WAS BEWUSST FEHLT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Kein client_secret. Alle Clients sind "public" im Sinne von RFC 6749: eine
 * Desktop-App und eine Weboberflaeche koennen ein Geheimnis nicht geheim
 * halten, und ein Geheimnis, das im Auslieferungspaket steht, ist keins. Die
 * Absicherung leistet stattdessen PKCE (RFC 7636, S256) -- der Code allein
 * nuetzt niemandem, der den Verifier nicht hat.
 *
 * Kein "plain" als code_challenge_method. Die MCP-Autorisierungsspezifikation
 * verlangt S256; plain anzubieten hiesse, die eine Schutzwirkung von PKCE
 * abwaehlbar zu machen.
 *
 * Diese Datei hat keinen Datenbankzugriff und kein IO, damit jede Entscheidung
 * ueber ein Geheimnis in oauth.test.ts nachpruefbar bleibt.
 */

// ─────────────────────────────────────────────────────────────────────────
// Scopes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Die beiden OAuth-Scopes und ihre Entsprechung in mcp_tokens.scope.
 *
 * Absichtlich dieselbe Zweiteilung wie beim manuell angelegten Token: was der
 * Konnektor darf, ist genau das, was ein Token darf. Eine dritte Abstufung
 * waere eine zweite Wahrheit darueber, wer was schreiben kann.
 */
export const OAUTH_SCOPE_READ = "mcp:read";
export const OAUTH_SCOPE_WRITE = "mcp:read_write";
export const SUPPORTED_SCOPES = [OAUTH_SCOPE_READ, OAUTH_SCOPE_WRITE] as const;

/**
 * Aus dem angefragten scope-String den Scope des Tokens.
 *
 * Leer oder unbekannt ergibt "read", nicht einen Fehler: RFC 6749 laesst den
 * Parameter ausdruecklich weg-lassbar und ueberlaesst dem Server die
 * Voreinstellung. Die sichere Voreinstellung ist die kleinere.
 */
export function mcpScopeFromOAuthScope(raw: unknown): McpScope {
  if (typeof raw !== "string") return "read";
  const wanted = raw.split(/\s+/).filter(Boolean);
  return wanted.includes(OAUTH_SCOPE_WRITE) ? "read_write" : "read";
}

/** Was in der Token-Antwort als gewaehrter scope zurueckgeht. Nach RFC 6749
 *  muss der Server das nennen, sobald er etwas anderes gewaehrt als
 *  angefragt -- und das tut er hier immer, weil er auf eine der beiden
 *  bekannten Formen normalisiert. */
export function grantedScopeString(scope: McpScope): string {
  return scope === "read_write" ? OAUTH_SCOPE_WRITE : OAUTH_SCOPE_READ;
}

// ─────────────────────────────────────────────────────────────────────────
// Lebensdauern
// ─────────────────────────────────────────────────────────────────────────

/**
 * Der Autorisierungscode. RFC 6749 erlaubt bis zu zehn Minuten und empfiehlt
 * "short"; eine Minute reicht fuer jeden Browser-Rueckweg und verkuerzt das
 * Fenster, in dem ein aus der Adresszeile abgeschriebener Code noch etwas wert
 * waere. Er ist ausserdem einmal verwendbar (consumed_at).
 */
export const CODE_TTL_SECONDS = 60;

/**
 * Der Zugriffstoken. Eine Stunde, nicht unbegrenzt wie beim manuell
 * angelegten Token: der Konnektor hat ein Refresh-Token und erneuert
 * selbsttaetig, der Mensch merkt davon nichts. Damit wirkt ein Entzug
 * spaetestens nach einer Stunde auch dann, wenn niemand den Client anfasst.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** Das Refresh-Token. 90 Tage ohne Nutzung; jede Nutzung erneuert es (siehe
 *  Rotation unten), ein taeglich benutzter Konnektor laeuft also nie ab. */
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

// ─────────────────────────────────────────────────────────────────────────
// Geheimnisse
// ─────────────────────────────────────────────────────────────────────────

/** Praefixe, damit ein Wert im Log oder in einem Issue sofort zuzuordnen ist.
 *  Gleiche Idee wie TOKEN_PREFIX in token.ts. */
export const REFRESH_PREFIX = "fbk_ref_";
export const CODE_PREFIX = "fbk_code_";

/**
 * 32 Byte aus dem CSPRNG, base64url, mit Praefix. Gehasht gespeichert wird
 * ueberall dasselbe SHA-256 wie bei den Zugriffstoken -- die Begruendung
 * (256 Zufallsbits brauchen keinen Langsam-Hash) steht im Kopf von
 * Migration 0099 und gilt hier unveraendert.
 */
export function generateSecret(prefix: string): { value: string; hash: string } {
  const value = `${prefix}${crypto.randomBytes(32).toString("base64url")}`;
  return { value, hash: hashToken(value) };
}

/** Die client_id ist KEIN Geheimnis (RFC 6749 sagt das ausdruecklich) und wird
 *  deshalb im Klartext gespeichert. Zufaellig ist sie trotzdem, damit sie
 *  nicht erratbar ueber Kunden hinweg durchzaehlbar ist. */
export function generateClientId(): string {
  return `fbk_client_${crypto.randomBytes(16).toString("base64url")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// PKCE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Prueft einen code_verifier gegen die beim /authorize hinterlegte
 * code_challenge.
 *
 * Der Vergleich laeuft ueber timingSafeEqual. Das ist hier keine Formsache:
 * ein zeichenweise abbrechender Vergleich verraet ueber die Antwortzeit, wie
 * viele Zeichen stimmen, und der Angreifer darf beliebig oft raten, solange
 * der Code gueltig ist. Ungleiche Laengen ergeben sofort false, weil
 * timingSafeEqual bei ungleicher Laenge wirft.
 *
 * RFC 7636 verlangt fuer den Verifier 43 bis 128 Zeichen aus einem engen
 * Alphabet. Das wird hier mitgeprueft, damit ein leerer oder trivialer
 * Verifier nicht durch eine sonst korrekte Rechnung rutscht.
 */
export function verifyPkce(
  codeVerifier: unknown,
  storedChallenge: string,
  method: string = "S256"
): boolean {
  if (method !== "S256") return false;
  if (typeof codeVerifier !== "string") return false;
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false;

  const computed = crypto.createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(storedChallenge, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Eine code_challenge, wie sie ankommen darf: base64url in der Laenge eines
 *  SHA-256, also 43 Zeichen ohne Polsterung. */
export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-_]{43}$/.test(value);
}

// ─────────────────────────────────────────────────────────────────────────
// Weiterleitungsziele
// ─────────────────────────────────────────────────────────────────────────

/**
 * Darf an dieses redirect_uri weitergeleitet werden?
 *
 * EXAKTER Zeichenvergleich gegen die bei der Registrierung genannten Adressen.
 * Kein Praefixvergleich, keine Platzhalter: ein Praefixvergleich auf
 * "https://claude.ai/" liesse "https://claude.ai/../boese" und jede andere
 * Bastelei durch, und der Autorisierungscode geht genau dorthin. Das ist die
 * Stelle, an der ein zu grosszuegiger Vergleich den ganzen Fluss aushebelt.
 */
export function redirectUriAllowed(registered: readonly string[], requested: unknown): boolean {
  if (typeof requested !== "string" || requested === "") return false;
  return registered.includes(requested);
}

/**
 * Taugt eine Adresse ueberhaupt als Weiterleitungsziel?
 *
 * https ueberall, http nur auf dem eigenen Rechner. Der Grund fuer die
 * Ausnahme: Desktop-Clients (Claude Desktop, mcp-remote, Claude Code) fangen
 * den Rueckweg auf einem lokalen Port ab, und "http://127.0.0.1:33418/callback"
 * ist dort der Normalfall. Der Grund fuer die Regel: ueber ein http-Ziel im
 * Netz waere der Autorisierungscode im Klartext unterwegs.
 *
 * Fragmente sind verboten, weil RFC 6749 das so vorschreibt -- der Server
 * haengt beim Rueckweg selbst eines an und wuerde ein vorhandenes zerstoeren.
 */
export function isUsableRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw === "") return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash !== "") return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Die eigene Adresse
// ─────────────────────────────────────────────────────────────────────────

/**
 * Unter welcher Adresse dieser Server von aussen erreichbar ist.
 *
 * Klingt nach einer Nebensaechlichkeit, ist aber der issuer: jede der drei
 * Adressen in den Metadaten haengt daran, und ein Client vergleicht den issuer
 * aus dem Metadatendokument mit dem, ueber den er es geholt hat. Weicht er ab,
 * bricht er ab -- und das zu Recht, denn ein Metadatendokument, das auf einen
 * fremden Aussteller zeigt, waere die Uebernahme des Flusses.
 *
 * Deshalb NICHT aus request.url: hinter dem Vercel-Proxy steht dort die
 * interne Adresse der Funktion, nicht app.frostbreaker.app. x-forwarded-host
 * traegt den Namen, den der Nutzer eingetippt hat, und ist genau der, den auch
 * der Client verwendet hat.
 */
export function publicOrigin(headers: { get(name: string): string | null }, fallbackUrl: string): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    // Bei mehreren Proxys steht in beiden Headern eine kommaseparierte Kette;
    // der erste Eintrag ist der urspruengliche Aufrufer.
    return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  }
  return new URL(fallbackUrl).origin;
}

// ─────────────────────────────────────────────────────────────────────────
// Die beiden Metadaten-Dokumente
// ─────────────────────────────────────────────────────────────────────────

/**
 * RFC 9728, Protected Resource Metadata. Das ist das Dokument, auf das die
 * 401 des MCP-Endpunkts per WWW-Authenticate zeigt, und die einzige
 * Verbindung zwischen "der Endpunkt will Zugangsdaten" und "hier ist die
 * Stelle, die sie ausstellt".
 *
 * resource MUSS exakt die URL des geschuetzten Endpunkts sein, gegen die der
 * Client spaeter seinen resource-Parameter setzt (RFC 8707). Weicht sie ab,
 * lehnt ein sorgfaeltiger Client den Token als "fuer eine andere Ressource
 * ausgestellt" ab.
 */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Frostbreaker",
    resource_documentation: `${origin}/settings/mcp`,
  };
}

/**
 * RFC 8414, Authorization Server Metadata. Sagt dem Client, wo er
 * registrieren, autorisieren und tauschen kann -- und was dieser Server dabei
 * verlangt.
 *
 * code_challenge_methods_supported nennt NUR S256. Das ist die maschinenlesbare
 * Fassung der Entscheidung im Kopf dieser Datei; ein Client, der plain
 * bevorzugt, sieht hier, dass es das nicht gibt, statt es zu versuchen und
 * abgewiesen zu werden.
 *
 * registration_endpoint ist der Grund, warum der Nutzer nichts eintragen muss:
 * ohne dynamische Registrierung (RFC 7591) muesste er sich in Frostbreaker
 * eine client_id ausstellen lassen und sie in claude.ai eintippen.
 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // "none" = public client ohne Geheimnis. Siehe Kopfkommentar.
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${origin}/settings/mcp`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fehlerformen
// ─────────────────────────────────────────────────────────────────────────

/**
 * Die Fehlerantwort des Token-Endpunkts nach RFC 6749 §5.2: ein flaches
 * Objekt mit error und error_description, HTTP 400 (bzw. 401 bei
 * invalid_client). Absichtlich NICHT die JSON-RPC-Fehlerform des
 * MCP-Endpunkts -- hier spricht OAuth, nicht MCP, und ein Client parst
 * genau das eine Format.
 */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_scope"
  /** RFC 8707: der resource-Parameter zeigt woanders hin als auf diesen
   *  Server. */
  | "invalid_target"
  | "access_denied"
  | "server_error";

export function oauthError(code: OAuthErrorCode, description: string) {
  return { error: code, error_description: description };
}

/**
 * Der Rueckweg zum Client im Fehlerfall (RFC 6749 §4.1.2.1).
 *
 * Nur wenn redirect_uri UND client_id geprueft sind, darf der Fehler dorthin
 * weitergeleitet werden. Ist eines von beiden faul, muss der Fehler auf der
 * eigenen Seite bleiben -- sonst wird der Autorisierungsendpunkt zur
 * Umleitungsmaschine fuer beliebige Adressen.
 */
export function errorRedirect(
  redirectUri: string,
  code: OAuthErrorCode,
  description: string,
  state?: string | null
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", code);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/** Der Rueckweg im Erfolgsfall. state wird unveraendert durchgereicht: es ist
 *  der CSRF-Schutz des Clients und gehoert nicht uns. */
export function successRedirect(redirectUri: string, code: string, state?: string | null): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
