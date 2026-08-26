import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { hashToken } from "@/lib/mcp/token";

/**
 * RFC 7009, Token-Widerruf.
 *
 * Wird von einem Client aufgerufen, wenn der Mensch die Verbindung dort
 * trennt. Der Weg ueber die Frostbreaker-Einstellungen bleibt daneben
 * bestehen; das hier ist der Weg von der anderen Seite.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM DIESE ROUTE IMMER 200 ANTWORTET
 * ═══════════════════════════════════════════════════════════════════════
 *
 * RFC 7009 §2.2 schreibt das ausdruecklich vor: ein unbekannter Token ist
 * KEIN Fehler. Der Grund ist die Sicht des Clients -- er will erreichen, dass
 * der Token nicht mehr gilt, und das ist bei einem unbekannten Token bereits
 * der Fall. Ein 404 wuerde ausserdem verraten, welche Token existieren, und
 * damit diesen offenen Endpunkt zum Orakel machen.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let token: string | null = null;
  try {
    const roh = await request.text();
    const typ = request.headers.get("content-type") ?? "";
    if (typ.includes("application/json")) {
      const obj = JSON.parse(roh) as Record<string, unknown>;
      token = typeof obj.token === "string" ? obj.token : null;
    } else {
      token = new URLSearchParams(roh).get("token");
    }
  } catch {
    // Auch ein unlesbarer Body endet in der 200 unten. Siehe Kopfkommentar.
  }

  if (token) {
    try {
      const supabase = createServiceClient();
      const hash = hashToken(token);
      const jetzt = new Date().toISOString();
      // Der Client weiss nicht unbedingt, ob er gerade den Zugriffs- oder den
      // Refresh-Token in der Hand hat (RFC 7009 laesst token_type_hint
      // ausdruecklich weg-lassbar). Beide Spalten zu pruefen ist billiger als
      // die Rueckfrage, und in beiden Faellen ist dieselbe Zeile gemeint.
      await supabase
        .from("mcp_tokens")
        .update({ revoked_at: jetzt })
        .or(`token_hash.eq.${hash},refresh_token_hash.eq.${hash}`)
        .is("revoked_at", null);
    } catch (err) {
      console.error("[oauth/revoke] Widerruf fehlgeschlagen:", err);
    }
  }

  return new NextResponse(null, {
    status: 200,
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
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
