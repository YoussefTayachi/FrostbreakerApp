import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateToken } from "@/lib/mcp/token";
import type { McpScope } from "@/lib/mcp/authorize";

/**
 * Die Token-Verwaltung fuer den MCP-Server: anlegen, auflisten, widerrufen.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIESE ROUTE NICHT UNTER app/api/mcp/ LIEGT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * app/api/mcp/ ist im Matcher von middleware.ts ausgenommen, damit der
 * MCP-Server ohne Supabase-Session erreichbar ist -- er authentifiziert sich
 * ueber den Bearer-Token, den er selbst prueft. Eine Route, die Token ERZEUGT
 * und WIDERRUFT, darf genau das nicht: sie muss hinter der Session-Pruefung
 * bleiben, sonst koennte sich jeder ohne Login einen Zugang ausstellen.
 *
 * Deshalb liegt sie unter app/api/settings/. Wer sie spaeter "der Ordnung
 * halber" nach app/api/mcp/ verschiebt, hebt damit die Auth der gesamten
 * Token-Verwaltung auf, ohne eine Zeile Code zu aendern.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * SESSION-CLIENT, NICHT SERVICE-ROLE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Hier gibt es eine Session, also greift RLS (Policies in Migration 0099) --
 * inklusive der Pruefung beim INSERT, dass eine gesetzte workspace_id zu einer
 * echten Mitgliedschaft gehoert. Zusaetzlich filtert jede Abfrage hier
 * explizit auf user_id: RLS ist die Absicherung, nicht der Filter (siehe
 * CLAUDE.md, "haeufigste Fehlerquelle").
 */

/** Was der Client sehen darf. token_hash und refresh_token_hash stehen bewusst
 *  NICHT drin: ein Hash ist zwar kein Klartext, aber er ist der Wert, gegen den
 *  der Server vergleicht -- er hat im Browser nichts verloren.
 *
 *  kind und refresh_expires_at kamen mit dem Konnektor dazu (Migration 0105).
 *  Ohne sie zeigte die Liste eine Konnektor-Verbindung eine Stunde nach dem
 *  Verbinden als "abgelaufen" an: der Zugriffstoken laeuft tatsaechlich nach
 *  einer Stunde ab, aber der Konnektor erneuert ihn selbsttaetig, und die
 *  Verbindung besteht so lange weiter, wie refresh_expires_at in der Zukunft
 *  liegt. Ein "abgelaufen" an einer Verbindung, die einwandfrei arbeitet, ist
 *  genau die Sorte Anzeige, nach der jemand einen funktionierenden Zugang
 *  wegwirft und neu einrichtet. */
const PUBLIC_COLUMNS =
  "id, name, token_prefix, scope, workspace_id, created_at, last_used_at, expires_at, revoked_at, kind, refresh_expires_at";

/** Der Name dient nur der Wiedererkennung in der Liste. 80 Zeichen sind mehr,
 *  als in eine Tabellenzelle passen; alles darueber ist ein Versehen oder ein
 *  Versuch, die Liste zu sprengen. */
const MAX_NAME_LENGTH = 80;

const SCOPES: readonly McpScope[] = ["read", "read_write"];

/** Genau die Werte, die das Formular anbietet (t.settings.mcp.expiry30/90/365).
 *  Eine freie Zahl anzunehmen hiesse, eine Gueltigkeit zu erzeugen, die die
 *  Oberflaeche spaeter nicht mehr abbilden kann. */
const EXPIRY_DAYS: readonly number[] = [30, 90, 365];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("mcp_tokens")
    .select(PUBLIC_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: "Ungültiger Name" }, { status: 400 });
  }

  const scope: McpScope = SCOPES.includes(body.scope) ? body.scope : "read";

  // Gesetzte workspace_id ist eine EINSCHRAENKUNG, keine Rechteerweiterung
  // (siehe Kopfkommentar von Migration 0099). Ob der Mensch dort ueberhaupt
  // Mitglied ist, entscheidet die INSERT-Policy -- hier steht bewusst keine
  // zweite Mitgliedschaftspruefung, die mit ihr auseinanderlaufen koennte.
  const workspaceId = typeof body.workspace_id === "string" && body.workspace_id ? body.workspace_id : null;

  let expiresAt: string | null = null;
  if (body.expires_in_days !== null && body.expires_in_days !== undefined) {
    const days = Number(body.expires_in_days);
    if (!EXPIRY_DAYS.includes(days)) {
      return NextResponse.json({ error: "Ungültige Gültigkeit" }, { status: 400 });
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const generated = generateToken();

  const { data, error } = await supabase
    .from("mcp_tokens")
    .insert({
      user_id: user.id,
      workspace_id: workspaceId,
      name,
      token_hash: generated.hash,
      token_prefix: generated.prefix,
      scope,
      expires_at: expiresAt,
    })
    .select(PUBLIC_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // DER EINZIGE MOMENT, in dem der Klartext-Token existiert. Gespeichert sind
  // nur Hash und Praefix; ab der naechsten Antwort ist er weg -- auch fuer den
  // Support, auch fuer die Datenbank. Wer ihn verliert, legt einen neuen an.
  return NextResponse.json({ token: generated.token, row: data });
}
