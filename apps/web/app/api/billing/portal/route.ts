import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/billing";

// Oeffnet das Stripe-Billing-Portal (Rechnungen, Zahlungsmethode aendern,
// Abo kuendigen) fuer bereits zahlende Kunden.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("owner_id", user.id)
    .single();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json(
      { error: "Noch kein Stripe-Kunde vorhanden. Bitte zuerst ein Abo abschliessen." },
      { status: 400 }
    );
  }

  const stripe = getStripe();
  const origin = new URL(req.url).origin;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/settings`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
