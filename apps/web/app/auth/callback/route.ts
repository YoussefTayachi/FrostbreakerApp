import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Ziel des `emailRedirectTo` beim Signup (siehe app/signup/page.tsx). Supabase
// haengt an den Bestaetigungslink einen `code` an; ohne diesen Tausch bleibt
// der Nutzer nach dem Klick auf den Link uneingeloggt und landet ueber die
// Middleware auf /login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
}
