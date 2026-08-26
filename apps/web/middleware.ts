import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  /**
   * Den Pfad als Request-Header durchreichen.
   *
   * Das Root-Layout ist eine Server Component und hat damit kein
   * usePathname(); es kann aber headers() lesen. Gebraucht wird das genau an
   * einer Stelle: /oauth/authorize soll ohne die App-Huelle erscheinen. Eine
   * Zustimmungsseite mit Seitenleiste, Workspace-Waehler und Suchfeld
   * daneben laedt zum Weiterklicken ein, und der eine Klick, um den es geht,
   * verschwindet zwischen fuenfzehn anderen.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
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
          // Auch hier die ergaenzten Header weiterreichen, sonst faellt
          // x-pathname genau in dem Fall weg, in dem Supabase die Sitzung
          // erneuert -- und das Layout saehe den Pfad dann sporadisch nicht.
          response = NextResponse.next({ request: { headers: requestHeaders } });
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
    // Wohin es nach der Anmeldung zurueckgehen soll. Vorher wurde nur der
    // Pfad auf /login gesetzt und der Rest der Adresse behalten -- die
    // Suchparameter ueberlebten also, das Ziel selbst nicht. Fuer das
    // Dashboard war das folgenlos (nach dem Login geht es ohnehin auf "/"),
    // fuer /oauth/authorize ist es toedlich: dort steckt der ganze Auftrag in
    // Pfad UND Parametern, und ein Konnektor, der seinen Nutzer zum Anmelden
    // schickt, bekaeme ihn nach dem Login auf dem Dashboard wieder -- ohne
    // Zustimmungsseite und ohne Code.
    const next = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = "";
    if (next !== "/") url.searchParams.set("next", next);
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
  // z.B. Signup-Benachrichtigung), api/unsubscribe (per Klick aus einer
  // Kampagnen-Mail) und api/mcp/ (der eigene Claude des Nutzers) werden ohne
  // Supabase-Session aufgerufen — ohne diesen Ausschluss redirected die
  // Auth-Middleware jeden Aufruf auf /login, bevor die Route ueberhaupt
  // laeuft. Alle pruefen ihre eigene Authentifizierung selbst
  // (Stripe-Signatur, CRON_SECRET/INTERNAL_NOTIFY_SECRET, api/mcp/ prueft
  // seinen eigenen Bearer-Token gegen mcp_tokens, bzw. beim Opt-out-Link
  // braucht es bewusst gar keine — CAN-SPAM verlangt einen Opt-out ohne
  // zusaetzliche Huerden).
  //
  // api/mcp steht hier OHNE abschliessenden Schraegstrich, anders als
  // api/cron/ und api/internal/: die beiden haben nur Unterrouten, der
  // MCP-Endpunkt ist selbst die Route (/api/mcp). Mit "api/mcp/" wuerde die
  // Ausnahme genau den einen Pfad verfehlen, um den es geht, und Claude
  // bekaeme statt einer Antwort eine Umleitung auf /login.
  //
  // .well-known/ und api/oauth/ kamen am 2026-08-26 dazu, als der MCP-Zugang
  // ein Konnektor wurde. Vorher gemessen: ein GET auf
  // /.well-known/oauth-protected-resource antwortete mit 307 auf /login. Ein
  // Client, der dort die Metadaten des geschuetzten Endpunkts sucht, bekam
  // also eine Umleitung auf eine HTML-Anmeldeseite -- und meldete daraufhin
  // nicht "keine Metadaten", sondern einen kaputten Server. Diese Dokumente
  // sind oeffentlich (RFC 9728 / RFC 8414 verlangen das ausdruecklich: sie
  // muessen ohne Zugangsdaten lesbar sein), eine Anmeldung davor ist ein
  // Widerspruch in sich.
  //
  // api/oauth/ pruefen ihre Auth selbst und muessen es auch: /register ist
  // laut RFC 7591 offen, /token authentifiziert ueber Code und PKCE statt
  // ueber eine Sitzung, und /authorize liest die Supabase-Sitzung im Handler,
  // weil eine 307 auf /login als Antwort auf ein fetch() aus der
  // Zustimmungsseite nur eine Anmeldeseite in den JSON-Parser schiebt.
  //
  // NICHT ausgenommen ist die Seite /oauth/authorize: dort ist die Umleitung
  // auf /login genau das Gewuenschte -- wer zustimmen soll, muss angemeldet
  // sein.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/|api/billing/webhook|api/cron/|api/internal/|api/mcp|api/oauth/|api/unsubscribe).*)",
  ],
};
