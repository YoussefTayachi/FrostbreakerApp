import { NextResponse } from "next/server";
import { authorizationServerMetadata, publicOrigin } from "@/lib/mcp/oauth";

/**
 * RFC 8414, Authorization Server Metadata.
 *
 * Der zweite Halt: hier erfaehrt der Client, wo er sich registriert, wohin er
 * den Menschen zum Zustimmen schickt und wo er den Code tauscht. Ohne dieses
 * Dokument muesste der Nutzer drei Adressen von Hand eintragen -- also genau
 * das Abtippen, das der Konnektor abschafft.
 *
 * Oeffentlich aus demselben Grund wie das Ressourcendokument nebenan.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = publicOrigin(request.headers, request.url);
  return NextResponse.json(authorizationServerMetadata(origin), {
    headers: {
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
