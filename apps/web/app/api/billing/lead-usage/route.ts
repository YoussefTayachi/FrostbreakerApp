import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLeadUsage } from "@/lib/billing";

export async function GET() {
  const supabase = await createClient();
  const usage = await getLeadUsage(supabase);
  if (!usage) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(usage);
}
