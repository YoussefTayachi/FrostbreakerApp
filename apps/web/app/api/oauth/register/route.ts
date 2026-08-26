import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateClientId, isUsableRedirectUri, oauthError } from "@/lib/mcp/oauth";

/**
 * RFC 7591, dynamische Client-Registrierung.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIESER ENDPUNKT OFFEN IST
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Er ist der Grund, warum der Nutzer beim Verbinden nichts eintippt. claude.ai
 * bekommt vom Nutzer nur die Adresse des Servers, holt sich die Metadaten, und
 * registriert sich hier selbst. Waere der Endpunkt geschlossen, muesste sich
 * der Mensch in Frostbreaker eine client_id ausstellen lassen und sie
 * drueberkopieren -- also wieder das Abtippen, das dieser ganze Umbau
 * abschafft.
 *
 * Offen heisst nicht gefaehrlich. Eine Registrierung gewaehrt NICHTS. Sie
 * erlaubt genau eine Sache: einen Menschen um Zustimmung zu fragen. Ohne dass
 * jemand auf /oauth/authorize klickt, entsteht kein Code und kein Token. Und
 * wohin ein Code nach der Zustimmung ginge, entscheidet nicht der Registrant,
 * sondern der exakte Vergleich gegen die hier hinterlegten redirect_uris.
 *
 * Die eigentliche Huerde liegt also bei redirect_uris, und deshalb wird dort
 * geprueft: https ueberall, http nur auf dem eigenen Rechner (Desktop-Clients
 * fangen den Rueckweg auf einem lokalen Port ab). Ein Angreifer, der sich hier
 * registriert, kann seinem Opfer eine Zustimmungsseite unterschieben -- aber
 * die Seite nennt Namen und Ziel, und das ist genau der Moment, in dem ein
 * Mensch entscheiden soll.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mehr als das nimmt kein Client entgegen, und mehr als das anzunehmen hiesse,
 *  einen offenen Endpunkt beliebig viel Text schlucken zu lassen. */
const MAX_BODY_BYTES = 8 * 1024;
const MAX_REDIRECT_URIS = 10;

export async function POST(request: Request) {
  const roh = await request.text();
  if (roh.length > MAX_BODY_BYTES) {
    return json(oauthError("invalid_request", "Registration request is too large."), 400);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(roh);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json(oauthError("invalid_request", "Request body must be a JSON object."), 400);
  }

  // ── redirect_uris: das einzige Pflichtfeld, das wirklich etwas entscheidet ──
  const roheUris = body.redirect_uris;
  if (!Array.isArray(roheUris) || roheUris.length === 0) {
    return json(
      oauthError("invalid_request", 'Field "redirect_uris" is required and must be a non-empty array.'),
      400
    );
  }
  if (roheUris.length > MAX_REDIRECT_URIS) {
    return json(
      oauthError("invalid_request", `At most ${MAX_REDIRECT_URIS} redirect_uris are accepted.`),
      400
    );
  }
  const untauglich = roheUris.find((u) => !isUsableRedirectUri(u));
  if (untauglich !== undefined) {
    return json(
      oauthError(
        "invalid_request",
        `Unusable redirect_uri: ${String(untauglich)}. Use https, or http only on localhost/127.0.0.1, and no URL fragment.`
      ),
      400
    );
  }
  const redirectUris = roheUris as string[];

  // ── Alles Weitere ist Beschriftung ──────────────────────────────────────
  // client_name landet auf der Zustimmungsseite und ist damit Fremdtext. Hier
  // nur gekuerzt; die Seite rendert ihn als Text und nie als Markup (React tut
  // das von sich aus, solange niemand dangerouslySetInnerHTML einfuehrt).
  const clientName =
    typeof body.client_name === "string" && body.client_name.trim() !== ""
      ? body.client_name.trim().slice(0, 120)
      : "Unnamed MCP client";

  // Wir stellen keine Geheimnisse aus (siehe lib/mcp/oauth.ts). Verlangt ein
  // Client ausdruecklich eine Methode mit Geheimnis, ist das kein Fehler
  // wert -- RFC 7591 erlaubt dem Server, abweichend zu antworten, und die
  // Antwort unten sagt klar "none".
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[oauth/register] Service-Client nicht erzeugbar:", err);
    return json(oauthError("server_error", "The server is not configured correctly."), 500);
  }

  const clientId = generateClientId();
  const { error } = await supabase.from("mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
  });
  if (error) {
    console.error("[oauth/register] Anlegen fehlgeschlagen:", error.message);
    return json(oauthError("server_error", "Could not register the client."), 500);
  }

  // 201 mit genau den Feldern, die RFC 7591 §3.2.1 fuer eine Antwort ohne
  // Geheimnis vorsieht. client_secret fehlt bewusst und darf auch nicht als
  // null dastehen: manche Clients pruefen auf Anwesenheit des Schluessels,
  // nicht auf seinen Wert, und wechseln dann in den vertraulichen Fluss.
  return json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}
