import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-Role-Client -- umgeht RLS komplett. NUR fuer server-seitigen Code
// ohne User-Session, der App-uebergreifend schreiben muss (z.B. der Stripe-
// Webhook, der keinen eingeloggten User hat). Niemals an den Client durchreichen.
export function createServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen in den Umgebungsvariablen.");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
