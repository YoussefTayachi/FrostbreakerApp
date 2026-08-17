import { createClient } from "@/lib/supabase/server";
import { getBillingStatus } from "@/lib/billing";
import PricingClient from "./pricing-client";

export default async function PricingPage() {
  const supabase = await createClient();
  const status = await getBillingStatus(supabase);
  return <PricingClient status={status} />;
}
