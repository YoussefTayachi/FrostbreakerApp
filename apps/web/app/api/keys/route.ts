import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { fernetEncrypt } from "@/lib/fernet";

const PROVIDERS = ["google_maps", "openai", "hunter", "apollo", "neverbounce", "instantly"];

/**
 * Kurzer, nicht-sensibler Hinweis auf den Key (z.B. "sk-a1b2...9xZ3"), damit
 * man in den Settings unterscheiden kann, welcher Key hinterlegt ist, ohne
 * den vollen Key je wieder im Klartext zu zeigen oder erneut entschluesseln
 * zu muessen. Zeigt bewusst nur wenige Zeichen an jedem Ende.
 */
function makeKeyHint(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return k.slice(0, 2) + "…" + k.slice(-2);
  return k.slice(0, 4) + "…" + k.slice(-4);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { provider, key } = await req.json();
  if (!PROVIDERS.includes(provider) || typeof key !== "string" || key.length < 8) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const key_ciphertext = fernetEncrypt(process.env.APP_ENCRYPTION_KEY!, key.trim());
  const key_hint = makeKeyHint(key);
  const { error } = await supabase
    .from("api_keys")
    .upsert({ workspace_id: ws.workspace.id, provider, key_ciphertext, key_hint }, { onConflict: "workspace_id,provider" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, key_hint });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { provider } = await req.json();
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("workspace_id", ws.workspace.id)
    .eq("provider", provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
