import type { SupabaseClient } from "@supabase/supabase-js";
import { fernetDecrypt } from "./fernet";

/** Holt und entschluesselt den fuer diesen Workspace hinterlegten BYOK-Key
 *  eines Providers (google_maps/openai/hunter/neverbounce/instantly/...).
 *  Einzige Stelle, die api_keys.key_ciphertext liest. Vorher gab es dafuer
 *  eine fest auf "instantly" verdrahtete Kopie in lib/instantly.ts und eine
 *  zweite, inline, in app/api/personalize-test/route.ts fuer "openai". */
export async function getApiKey(
  supabase: SupabaseClient,
  workspaceId: string,
  provider: string
): Promise<string | null> {
  const { data } = await supabase
    .from("api_keys")
    .select("key_ciphertext")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .single();
  if (!data) return null;
  return fernetDecrypt(process.env.APP_ENCRYPTION_KEY!, data.key_ciphertext);
}
