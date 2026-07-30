// Duenner Client fuer die Instantly API v2 (https://developer.instantly.ai).
// BYOK: jeder Workspace bringt seinen eigenen Instantly-API-Key mit (genau
// wie Google Maps/Hunter/OpenAI/NeverBounce), Thaw sendet nichts ueber einen
// eigenen, zentralen Instantly-Account. Das haelt Haftung/Reputation pro
// Kunde getrennt, siehe instantly_native_integration_plan.md Punkt 0.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiKey } from "./api-keys";
import { getCurrentWorkspace, type WorkspaceSummary } from "./workspace/server";

const BASE_URL = "https://api.instantly.ai";

/** Holt und entschluesselt den fuer diesen Workspace hinterlegten Instantly-Key. */
export async function getInstantlyApiKey(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  return getApiKey(supabase, workspaceId, "instantly");
}

export class InstantlyApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Generischer, authentifizierter Request gegen die Instantly API. */
export async function instantlyRequest<T = unknown>(
  apiKey: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      // Nur setzen, wenn tatsaechlich ein Body mitgeschickt wird -- z.B.
      // DELETE /api/v2/campaigns/{id} hat keinen Body, lehnt mit
      // "Content-Type: application/json" ohne Inhalt aber trotzdem mit
      // "body must be null" ab (anders als POST-Aufrufe ohne Body wie
      // pause/activate, die das tolerieren).
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      (body && (body.message || body.error)) || `Instantly-API-Fehler (${res.status})`;
    throw new InstantlyApiError(message, res.status);
  }
  return body as T;
}

/**
 * Gemeinsamer Einstiegspunkt fuer so gut wie jede /api/instantly/*-Route:
 * prueft Login, ermittelt den aktuellen Workspace und laedt dessen
 * entschluesselten Instantly-Key. Vorher war dieser Block in jeder Route
 * (accounts, accounts/bulk, accounts/[email], accounts/warmup, campaigns/*)
 * separat kopiert -- an einer Stelle halten, damit z.B. eine Aenderung an der
 * Fehlermeldung oder der Workspace-Ermittlung nicht in sechs Dateien
 * synchron gehalten werden muss.
 */
export async function requireInstantlyContext(
  supabase: SupabaseClient
): Promise<
  | { error: NextResponse }
  | { user: { id: string }; workspace: WorkspaceSummary; apiKey: string }
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return { error: NextResponse.json({ error: "Kein Workspace" }, { status: 400 }) };

  const apiKey = await getInstantlyApiKey(supabase, ws.workspace.id);
  if (!apiKey) {
    return {
      error: NextResponse.json(
        { error: "Kein Instantly-API-Key in den Einstellungen hinterlegt." },
        { status: 400 }
      ),
    };
  }

  return { user, workspace: ws.workspace, apiKey };
}
