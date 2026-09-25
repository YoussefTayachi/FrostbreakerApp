import crypto from "crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { backfillOutOfOffice, createCurrentWeek } from "@/lib/wiederkontakt-server";

/**
 * Wochen-Cron fuer den Wiederkontakt (Migration 0123: jeden Montag 06:00 UTC).
 *
 * Fuer jeden Workspace mit Wartenden die Listen der laufenden Woche als
 * Entwurf anlegen. Nur anlegen, nie starten: welche Postfaecher senden und
 * wann es losgeht, entscheidet ein Mensch unter Instantly > Kampagnen, wie
 * bei jedem anderen Entwurf.
 *
 * `{"backfill": true}` im Body laesst vorher alle bekannten Abwesenheits-
 * antworten noch einmal durch die Datumserkennung und legt Kontakte fuer
 * Antworten ohne Kontakt an. Einmal nach Migration 0123 gebraucht, danach
 * bei Bedarf; idempotent.
 *
 * Auth wie worker-ops: CRON_SECRET als Bearer, Service-Role-Client, weil
 * hier keine Sitzung existiert. Route ist in middleware.ts unter api/cron/*
 * vom Login ausgenommen.
 */
export const maxDuration = 60;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { backfill?: boolean; workspace_id?: string; create?: boolean };
  const supabase = createServiceClient();

  let workspaceIds: string[];
  if (body.workspace_id) {
    workspaceIds = [body.workspace_id];
  } else {
    // Nur Workspaces, in denen ueberhaupt jemand abwesend ist.
    const { data } = await supabase
      .from("contacts")
      .select("workspace_id")
      .eq("outreach_status", "out_of_office")
      .is("reengaged_at", null)
      .limit(5000);
    workspaceIds = [...new Set(((data ?? []) as { workspace_id: string }[]).map((r) => r.workspace_id))];
  }

  const out: Record<string, unknown>[] = [];
  for (const workspaceId of workspaceIds) {
    const eintrag: Record<string, unknown> = { workspace_id: workspaceId };
    try {
      if (body.backfill) eintrag.backfill = await backfillOutOfOffice(supabase, workspaceId);
      if (body.create !== false) eintrag.created = await createCurrentWeek(supabase, workspaceId, new Date());
    } catch (e) {
      eintrag.error = (e as Error).message;
    }
    out.push(eintrag);
  }
  return NextResponse.json({ workspaces: out });
}
