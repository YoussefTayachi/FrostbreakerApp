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
  // Ohne Login erreichbar.
  const publicPaths = ["/login", "/signup", "/unsubscribe"];
  // Davon die Teilmenge, auf der ein eingeloggter Nutzer nichts verloren hat.
  // /unsubscribe gehoert ausdruecklich NICHT dazu: die Seite bestaetigt einem
  // Empfaenger, dass seine Abmeldung angekommen ist. Wer zufaellig in der App
  // eingeloggt ist — etwa weil er sie selbst nutzt — landete sonst
  // wortlos auf dem Dashboard und sah nie, ob die Abmeldung geklappt hat.
  const loggedInMustLeavePaths = ["/login", "/signup"];
  const isPublicPath = publicPaths.includes(request.nextUrl.pathname);
  // /auth/callback tauscht den Bestaetigungs-Code gegen eine Session — vor
  // diesem Tausch existiert noch keine Session, die Middleware wuerde sonst
  // jeden Aufruf faelschlich auf /login umleiten, bevor die Route laeuft.
  if (request.nextUrl.pathname === "/auth/callback") {
    return response;
  }

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Gegenrichtung: wer bereits eingeloggt ist, hat auf /login und /signup
  // nichts mehr verloren. Ohne diese Regel rendert das Root-Layout die volle
  // App-Huelle (Sidebar, Nav) und darin das Registrierungsformular — und ein
  // erneutes signUp() mit der schon registrierten Adresse liefert aus
  // Sicherheitsgruenden (Schutz vor E-Mail-Enumeration) ein Erfolgs-Objekt
  // ohne Session zurueck, ohne eine Mail zu verschicken. Die Seite zeigt dann
  // "Bestaetigungsmail verschickt", obwohl keine kommt und auch keine noetig
  // waere. Hier abgefangen statt in beiden Seiten einzeln, damit die Huelle
  // gar nicht erst gerendert wird.
  if (user && loggedInMustLeavePaths.includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // api/billing/webhook (Stripe), api/cron/* (pg_cron), api/internal/* (pg_net,
  // z.B. Signup-Benachrichtigung) und api/unsubscribe (per Klick aus einer
  // Kampagnen-Mail) werden ohne Supabase-Session aufgerufen — ohne diesen
  // Ausschluss redirected die Auth-Middleware jeden Aufruf auf /login, bevor
  // die Route ueberhaupt laeuft. Alle pruefen ihre eigene Authentifizierung
  // selbst (Stripe-Signatur, CRON_SECRET/INTERNAL_NOTIFY_SECRET, bzw. beim
  // Opt-out-Link braucht es bewusst gar keine — CAN-SPAM verlangt einen
  // Opt-out ohne zusaetzliche Huerden).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/billing/webhook|api/cron/|api/internal/|api/unsubscribe).*)",
  ],
};
