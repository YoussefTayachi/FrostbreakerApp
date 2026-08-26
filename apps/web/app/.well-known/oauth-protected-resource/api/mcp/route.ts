import { NextResponse } from "next/server";
import { protectedResourceMetadata, publicOrigin } from "@/lib/mcp/oauth";

/**
 * Dasselbe Dokument wie eine Ebene hoeher, zweiter Pfad.
 *
 * RFC 9728 §3.1 schreibt vor, wo ein Client die Metadaten einer Ressource mit
 * einem PFAD sucht: der Pfad wird an /.well-known/oauth-protected-resource
 * ANGEHAENGT. Fuer https://app.frostbreaker.app/api/mcp ist das also
 * /.well-known/oauth-protected-resource/api/mcp -- nicht der nackte Pfad.
 *
 * Welchen der beiden ein Client tatsaechlich fragt, ist Fassungssache: die
 * aelteren nehmen den nackten, die neueren den mit Pfad, einige probieren
 * beide. Beide zu bedienen ist billiger als die Sorte Fehler, die nur bei
 * jedem zweiten Client auftritt und beim Nachstellen verschwindet.
 *
 * Ausgeschrieben statt aus ../../route re-exportiert: die Segmentoptionen
 * (runtime, dynamic) muessen von Next statisch erkennbar sein, und ob ein
 * Re-Export das noch ist, haengt an der Fassung. Zwanzig Zeilen Wiederholung
 * sind hier weniger Risiko als eine Option, die still nicht greift -- der
 * gemeinsame Inhalt steht ohnehin in lib/mcp/oauth.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = publicOrigin(request.headers, request.url);
  return NextResponse.json(protectedResourceMetadata(origin), {
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
