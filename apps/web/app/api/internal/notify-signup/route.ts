import crypto from "crypto";
import { NextResponse } from "next/server";
import { sendSlackNotification } from "@/lib/notify";

// Wird von handle_new_user() (supabase/migrations/0048_signup_notify.sql) per
// pg_net asynchron aufgerufen, sobald ein neuer auth.users-Eintrag entsteht;
// gleiche Konvention wie api/cron/instantly-sync (Bearer-Secret aus supabase_vault).
function isAuthorized(req: Request): boolean {
  const secret = process.env.INTERNAL_NOTIFY_SECRET;
  if (!secret) return false;
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" && body.email ? body.email : "unbekannt";
  await sendSlackNotification(`🆕 Neue Anmeldung: ${email}`);
  return NextResponse.json({ ok: true });
}
