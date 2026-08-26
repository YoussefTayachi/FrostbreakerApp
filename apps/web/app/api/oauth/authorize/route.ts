import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  CODE_PREFIX,
  CODE_TTL_SECONDS,
  errorRedirect,
  generateSecret,
  isValidCodeChallenge,
  publicOrigin,
  redirectUriAllowed,
  successRedirect,
} from "@/lib/mcp/oauth";

/**
 * Die Zustimmung entgegennehmen und daraus einen Autorisierungscode machen.
 *
 * Nimmt die Absendung des Formulars aus /oauth/authorize entgegen und
 * antwortet mit einer 303 auf den Rueckweg des Clients -- mit Code, oder mit
 * einem Fehler, wenn abgelehnt wurde.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DER ORIGIN-HEADER HIER EINE ZUGRIFFSENTSCHEIDUNG IST
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Diese Route macht mit einem einzigen POST aus einer bestehenden Sitzung
 * einen Zugang. Ohne Gegenwehr waere sie die Vorlage fuer einen klassischen
 * CSRF: eine fremde Seite laesst den Browser eines angemeldeten Nutzers ein
 * verstecktes Formular hierher abschicken, der Nutzer sieht nichts, und der
 * Code landet beim Angreifer.
 *
 * Der Origin-Header ist dagegen wirksam, weil ihn der BROWSER setzt und keine
 * Seite ihn faelschen kann. Er ist bei jedem cross-origin POST vorhanden --
 * anders als beim MCP-Endpunkt nebenan, wo ein fehlender Origin der Normalfall
 * ist (dort ruft ein Server auf, kein Browser). Hier ruft immer ein Browser
 * auf. Deshalb gilt hier die umgekehrte Regel: FEHLT der Origin, ist das
 * verdaechtig, nicht in Ordnung.
 *
 * ALLE Parameter werden erneut gegen die Datenbank geprueft. Dass sie aus
 * versteckten Feldern des eigenen Formulars kommen, heisst nichts: ein
 * verstecktes Feld ist ein Vorschlag des Browsers, keine Tatsache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = publicOrigin(request.headers, request.url);

  // ── CSRF ────────────────────────────────────────────────────────────
  const absender = request.headers.get("origin");
  if (absender !== origin) {
    console.warn(`[oauth/authorize] POST mit fremdem Origin abgewiesen: ${absender ?? "(keiner)"}`);
    return NextResponse.json(
      { error: "invalid_request", error_description: "Cross-origin form submission rejected." },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const clientId = str(form.get("client_id"));
  const redirectUri = str(form.get("redirect_uri"));
  const codeChallenge = str(form.get("code_challenge"));
  const state = str(form.get("state"));
  const resource = str(form.get("resource"));
  const decision = str(form.get("decision"));
  const scope = str(form.get("scope")) === "read_write" ? "read_write" : "read";
  const workspaceId = str(form.get("workspace_id"));

  if (!clientId || !redirectUri || !isValidCodeChallenge(codeChallenge)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "The authorization request is incomplete." },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  // ── Client und Rueckweg erneut pruefen ───────────────────────────────
  const { data: client } = await service
    .from("mcp_oauth_clients")
    .select("client_id, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle<{ client_id: string; redirect_uris: string[] }>();

  if (!client || !redirectUriAllowed(client.redirect_uris, redirectUri)) {
    // Bleibt hier. Ein ungeprueftes Ziel bekommt keine Weiterleitung, auch
    // keine mit einem Fehler darin.
    return NextResponse.json(
      { error: "invalid_request", error_description: "Unknown client or redirect_uri." },
      { status: 400 }
    );
  }

  // ── Wer ist das ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Kann passieren, wenn die Sitzung zwischen Anzeige und Absenden ablaeuft.
    // Der Client erfaehrt es und kann neu anfangen.
    return NextResponse.redirect(
      errorRedirect(redirectUri, "access_denied", "The session expired before consent was given.", state),
      303
    );
  }

  // ── Abgelehnt ────────────────────────────────────────────────────────
  if (decision !== "allow") {
    return NextResponse.redirect(
      errorRedirect(redirectUri, "access_denied", "The user declined the request.", state),
      303
    );
  }

  // ── Die Einschraenkung auf einen Workspace muss echt sein ────────────
  // Ohne diese Pruefung liesse sich ueber ein verstelltes Formularfeld ein
  // Code auf eine fremde workspace_id ausstellen. Er saehe dank der
  // Schnittmenge in lib/mcp/authorize.ts zwar nichts, aber eine Zeile, die
  // etwas Falsches behauptet, gehoert gar nicht erst in die Tabelle -- das ist
  // dieselbe Begruendung wie bei der Insert-Policy in Migration 0099.
  let gewaehlterWorkspace: string | null = null;
  if (workspaceId) {
    const { data: mitglied } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .maybeSingle<{ id: string }>();
    if (!mitglied) {
      return NextResponse.redirect(
        errorRedirect(redirectUri, "invalid_scope", "The selected workspace is not available.", state),
        303
      );
    }
    gewaehlterWorkspace = mitglied.id;
  }

  // ── Der Code ─────────────────────────────────────────────────────────
  const code = generateSecret(CODE_PREFIX);
  const { error } = await service.from("mcp_oauth_codes").insert({
    code_hash: code.hash,
    client_id: clientId,
    user_id: user.id,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope,
    workspace_id: gewaehlterWorkspace,
    resource: resource ?? null,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  });

  if (error) {
    console.error("[oauth/authorize] Code anlegen fehlgeschlagen:", error.message);
    return NextResponse.redirect(
      errorRedirect(redirectUri, "server_error", "Could not issue an authorization code.", state),
      303
    );
  }

  // 303 und nicht 302: nach einem POST muss der Browser den Rueckweg als GET
  // gehen. Mit 302 wiederholen manche Browser die Methode, und der Client
  // bekaeme einen POST auf seinen Callback, mit dem er nichts anfaengt.
  return NextResponse.redirect(successRedirect(redirectUri, code.value, state), 303);
}

/** FormData liefert string | File | null. Alles, was kein nichtleerer String
 *  ist, gilt hier als nicht vorhanden. */
function str(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
