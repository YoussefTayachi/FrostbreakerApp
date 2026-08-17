import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBillingStatus } from "@/lib/billing";

export async function GET() {
  const supabase = await createClient();
  const status = await getBillingStatus(supabase);
  if (!status) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(status);
}
