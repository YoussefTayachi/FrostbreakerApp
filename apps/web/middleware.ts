import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const publicPaths = ["/login", "/signup"];
  const isPublicPath = publicPaths.includes(request.nextUrl.pathname);

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Gegenrichtung: wer bereits eingeloggt ist, hat auf /login und /signup
  // nichts mehr verloren. Ohne diese Regel rendert das Root-Layout die volle
  // App-Huelle (Sidebar, Nav) und darin das Registrierungsformular -- und ein
  // erneutes signUp() mit der schon registrierten Adresse liefert aus
  // Sicherheitsgruenden (Schutz vor E-Mail-Enumeration) ein Erfolgs-Objekt
  // ohne Session zurueck, ohne eine Mail zu verschicken. Die Seite zeigt dann
  // "Bestaetigungsmail verschickt", obwohl keine kommt und auch keine noetig
  // waere. Hier abgefangen statt in beiden Seiten einzeln, damit die Huelle
  // gar nicht erst gerendert wird.
  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // api/billing/webhook (Stripe) und api/cron/* (pg_cron) werden ohne
  // Supabase-Session aufgerufen -- ohne diesen Ausschluss redirected die
  // Auth-Middleware jeden Aufruf auf /login, bevor die Route ueberhaupt
  // laeuft. Beide pruefen ihre eigene Authentifizierung selbst (Stripe-
  // Signatur bzw. CRON_SECRET).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/billing/webhook|api/cron/).*)"],
};
