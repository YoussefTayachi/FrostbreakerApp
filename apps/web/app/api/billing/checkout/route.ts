import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdFor, type PlanId } from "@/lib/billing";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const plan = body?.plan as PlanId;
  if (plan !== "starter" && plan !== "agency") {
    return NextResponse.json({ error: "Ungueltiger Plan." }, { status: 400 });
  }

  const stripe = getStripe();
  const origin = new URL(req.url).origin;

  // Bestehende Stripe-Customer-ID wiederverwenden, falls schon vorhanden
  // (z.B. nach abgebrochenem Checkout oder Plan-Wechsel).
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("owner_id", user.id)
    .single();

  let customerId = sub?.stripe_customer_id as string | null | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_owner_id: user.id },
    });
    customerId = customer.id;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceIdFor(plan), quantity: 1 }],
      success_url: `${origin}/settings?billing=success`,
      cancel_url: `${origin}/pricing?billing=cancelled`,
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_owner_id: user.id, plan } },
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
