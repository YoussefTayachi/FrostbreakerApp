import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Einen MCP-Token widerrufen.
 *
 * DELETE loescht hier NICHTS, sondern setzt revoked_at. Der Grund steht in
 * Migration 0099: mcp_write_log.token_id zeigt auf diese Zeile. Ein Protokoll,
 * dessen Urheber verschwunden ist, beantwortet die einzige Frage nicht mehr,
 * fuer die es angelegt wurde -- "wer hat diesen Icebreaker ueberschrieben".
 * Deshalb bleibt die Zeile stehen und wird nur entwertet.
 *
 * Die Wirkung ist sofort: lib/mcp/authorize.ts prueft revoked_at bei JEDEM
 * Werkzeugaufruf, der Server haelt keine Verbindung offen, die noch
 * weiterlaufen koennte.
 *
 * Session-Client wie in ../route.ts, damit RLS greift; zusaetzlich explizit
 * auf user_id gefiltert.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // is("revoked_at", null) bewahrt den Zeitpunkt des ERSTEN Widerrufs: ein
  // zweiter Aufruf soll ihn nicht auf jetzt schieben. Er trifft dann keine
  // Zeile, und die Oberflaeche laedt die Liste neu -- dort steht der Token
  // ohnehin schon als widerrufen.
  const { data, error } = await supabase
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Nicht gefunden oder bereits widerrufen" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
