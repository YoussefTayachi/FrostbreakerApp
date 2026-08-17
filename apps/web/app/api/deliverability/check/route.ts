import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDeliverabilityCheck } from "@/lib/deliverability";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const domain = (body?.domain as string | undefined)?.trim();
  const dkimSelector = (body?.dkimSelector as string | undefined)?.trim() || undefined;
  if (!domain) return NextResponse.json({ error: "Domain fehlt." }, { status: 400 });

  try {
    const report = await runDeliverabilityCheck(domain, dkimSelector);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
