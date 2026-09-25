import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { groupByWeek, isoWeekNumber, REGION_SCHEDULE, type Region, type Sender } from "@/lib/wiederkontakt";
import { createBucket, loadWaiting } from "@/lib/wiederkontakt-server";

/**
 * Wiederkontakt, mit Sitzung: die Wartenden nach Woche und Absender lesen
 * (GET) und eine Woche als Liste plus Entwurf anlegen (POST). Der Wochen-Cron
 * (app/api/cron/wiederkontakt) macht dasselbe ohne Sitzung ueber dieselben
 * Funktionen in lib/wiederkontakt-server.ts.
 */
export async function GET() {
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 401 });

  const waiting = await loadWaiting(supabase, ws.workspace.id);
  const buckets = groupByWeek(waiting, new Date()).map((b) => ({
    week: b.week,
    kw: isoWeekNumber(b.week),
    sender: b.sender,
    region: b.region,
    region_label: REGION_SCHEDULE[b.region].label,
    window: `${REGION_SCHEDULE[b.region].from} bis ${REGION_SCHEDULE[b.region].to}`,
    contacts: b.contacts.map((c) => ({
      id: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
      email: c.email,
      business_name: c.business_name,
      business_id: c.business_id,
      ooo_until: c.ooo_until,
      ooo_estimated: c.ooo_estimated,
      campaign_name: c.campaign_name,
    })),
  }));
  return NextResponse.json({ buckets, total: waiting.length });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { week?: string; sender?: string; region?: string };
  const week = typeof body.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week) ? body.week : null;
  const sender = body.sender === "berat" || body.sender === "ramy" ? (body.sender as Sender) : null;
  const region: Region = body.region === "uk" ? "uk" : "us";
  if (!week || !sender) return NextResponse.json({ error: "week und sender fehlen" }, { status: 400 });

  // Die Kontakte aus dem aktuellen Stand, nicht aus dem Request: was der
  // Browser vor einer Minute sah, kann inzwischen eine Kopie haben.
  const waiting = await loadWaiting(supabase, ws.workspace.id);
  const bucket = groupByWeek(waiting, new Date()).find((b) => b.week === week && b.sender === sender && b.region === region);
  if (!bucket) return NextResponse.json({ error: "Diese Woche hat keine Wartenden mehr" }, { status: 404 });

  try {
    const result = await createBucket(supabase, ws.workspace.id, week, sender, bucket.contacts.map((c) => c.id), region);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
