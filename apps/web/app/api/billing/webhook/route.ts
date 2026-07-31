import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, planFromPriceId } from "@/lib/billing";
import { createServiceClient } from "@/lib/supabase/service";
import { sendSlackNotification } from "@/lib/notify";

// Stripe-Webhook. Braucht den RAW Request-Body fuer die Signaturpruefung --
// req.text() liefert den unangetasteten Body, solange hier kein bodyParser
// dazwischenhaengt (App-Router-Routen parsen den Body nicht automatisch).
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET fehlt." }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", secret);
  } catch (e) {
    return NextResponse.json({ error: `Signaturpruefung fehlgeschlagen: ${(e as Error).message}` }, { status: 400 });
  }

  const supabase = createServiceClient();

  async function upsertFromSubscription(sub: Stripe.Subscription, ownerIdHint?: string) {
    const ownerId = ownerIdHint ?? (sub.metadata?.supabase_owner_id as string | undefined);
    if (!ownerId) return; // Ohne owner_id koennen wir die Zeile nicht zuordnen.

    const priceId = sub.items.data[0]?.price?.id;
    const plan = priceId ? planFromPriceId(priceId) : null;
    const item = sub.items.data[0];

    await supabase
      .from("subscriptions")
      .update({
        stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        stripe_subscription_id: sub.id,
        plan: plan ?? "trial",
        status: sub.status === "trialing" ? "trialing" : mapStripeStatus(sub.status),
        current_period_end: item?.current_period_end
          ? new Date(item.current_period_end * 1000).toISOString()
          : null,
      })
      .eq("owner_id", ownerId);
  }

  function mapStripeStatus(s: Stripe.Subscription.Status): "trialing" | "active" | "past_due" | "canceled" | "incomplete" {
    if (s === "active") return "active";
    if (s === "past_due" || s === "unpaid") return "past_due";
    if (s === "canceled" || s === "incomplete_expired") return "canceled";
    if (s === "trialing") return "trialing";
    return "incomplete";
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        await upsertFromSubscription(sub, session.client_reference_id ?? undefined);
        const priceId = sub.items.data[0]?.price?.id;
        const plan = priceId ? planFromPriceId(priceId) : null;
        const email = session.customer_details?.email ?? session.customer_email ?? "unbekannt";
        await sendSlackNotification(`💳 Neues Abo: ${email} (${plan ?? "unbekannter Plan"})`);
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created": {
      const sub = event.data.object as Stripe.Subscription;
      await upsertFromSubscription(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const ownerId = sub.metadata?.supabase_owner_id as string | undefined;
      if (ownerId) {
        await supabase.from("subscriptions").update({ status: "canceled" }).eq("owner_id", ownerId);
      }
      break;
    }
    default:
      break; // andere Events ignorieren wir bewusst
  }

  return NextResponse.json({ received: true });
}
