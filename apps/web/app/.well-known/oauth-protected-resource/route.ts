import { NextResponse } from "next/server";
import { protectedResourceMetadata, publicOrigin } from "@/lib/mcp/oauth";

/**
 * RFC 9728, Protected Resource Metadata.
 *
 * Der erste Halt eines Konnektors: die 401 von /api/mcp zeigt per
 * WWW-Authenticate hierher, und hier steht, welcher Aussteller fuer diesen
 * Endpunkt zustaendig ist.
 *
 * Muss ohne Zugangsdaten lesbar sein -- RFC 9728 verlangt das ausdruecklich,
 * und der Sinn der Sache ist ja gerade, dass ein Client OHNE Token erfaehrt,
 * wo er einen bekommt. Deshalb steht ".well-known/" in der Ausnahmeliste der
 * Middleware. Vor dem 2026-08-26 stand sie dort nicht, und dieser Pfad
 * antwortete mit 307 auf /login: der Client bekam eine HTML-Anmeldeseite, wo
 * er JSON erwartete.
 */
export const runtime = "nodejs";

/** Ohne das cached Vercel die Antwort und liefert sie unter einer zweiten
 *  Domain (Vorschau-Deployment) mit dem falschen issuer aus -- der Client
 *  vergleicht den und bricht ab. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = publicOrigin(request.headers, request.url);
  return NextResponse.json(protectedResourceMetadata(origin), {
    headers: {
      // Ein Client darf das Dokument aus dem Browser holen; es ist
      // oeffentlich, und ohne diesen Header scheitert der Abruf aus einer
      // Weboberflaeche an der Same-Origin-Regel.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
