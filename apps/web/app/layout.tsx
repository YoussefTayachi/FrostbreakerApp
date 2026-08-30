import "./globals.css";
import "@fontsource-variable/inter";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getLangServer } from "@/lib/i18n/lang";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import Nav from "./nav";
import MobileNav from "./mobile-nav";
import LogoutButton from "./logout-button";
import ThemeToggle from "./theme-toggle";
import { LanguageProvider, LanguageToggle } from "./language-provider";
import CommandPalette, { CommandPaletteTrigger } from "./command-palette";
import { ToastProvider } from "./toast-provider";
import { WorkspaceProvider } from "./workspace-provider";
import WorkspaceSwitcher from "./workspace-switcher";

export const metadata = {
  title: "Frostbreaker · Lead-Gen & Outreach",
  description: "B2B Leads finden, anreichern und kontaktieren",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const lang = await getLangServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const themeScript =
    "try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}";

  /**
   * Seiten, die ohne die App-Huelle erscheinen, obwohl jemand angemeldet ist.
   *
   * Bisher entschied allein "kein user" darueber (Anmeldung, Registrierung).
   * /oauth/authorize kam am 2026-08-26 dazu und ist der umgekehrte Fall: dort
   * MUSS jemand angemeldet sein, und trotzdem gehoert die Huelle weg. Auf dem
   * Live-Stand nachgesehen, wie es ohne diese Zeile aussah: die
   * Zustimmungsseite stand mitten in Seitenleiste, Workspace-Waehler und
   * Suchfeld -- eine Aufforderung zum Weiterklicken auf einer Seite, deren
   * ganzer Zweck eine einzige bewusste Entscheidung ist.
   *
   * Der Pfad kommt als Header aus der Middleware; eine Server Component hat
   * kein usePathname().
   */
  const pathname = (await headers()).get("x-pathname") ?? "";
  const ohneHuelle = pathname.startsWith("/oauth/");

  if (!user || ohneHuelle) {
    return (
      <html lang={lang} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body>
          <LanguageProvider lang={lang}>
            <ToastProvider>{children}</ToastProvider>
          </LanguageProvider>
        </body>
      </html>
    );
  }

  const ws = await getCurrentWorkspace(supabase);

  // Sollte durch den Signup-Trigger (handle_new_user) praktisch nie vorkommen;
  // trotzdem sauber abfangen statt mit einem undefined-Zugriff abzustuerzen.
  if (!ws) {
    return (
      <html lang={lang} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body>
          <LanguageProvider lang={lang}>
            <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-faint">
              Kein Workspace gefunden. Bitte kontaktiere den Support.
            </div>
          </LanguageProvider>
        </body>
      </html>
    );
  }

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <LanguageProvider lang={lang}>
          <WorkspaceProvider workspaceId={ws.workspace.id} workspaceName={ws.workspace.name} workspaces={ws.workspaces}>
            <ToastProvider>
            <CommandPalette />
            <div className="flex min-h-screen">
              {/* Drei Zonen, und nur die mittlere scrollt.
                  Bis zum 2026-08-09 war die Leiste ein einziger Block: die
                  Navigation ist mit jeder neuen Ansicht gewachsen, bis sie bei
                  100 % Zoom hoeher war als das Fenster. Weil das aside fixiert
                  ist und nichts ueberlief, wurde der Fuss schlicht abgeschnitten
                  — Konto, Sprache, Nachtmodus und Abmelden waren erst ab 90 %
                  Zoom zu sehen, also ausgerechnet nicht in der Standardansicht.
                  Kopf und Fuss stehen deshalb fest (shrink-0), dazwischen darf
                  gescrollt werden. min-h-0 ist dabei der Punkt, an dem es sonst
                  scheitert: ohne das weigert sich ein Flex-Kind, kleiner als
                  sein Inhalt zu werden, und der Fuss wandert wieder hinaus. */}
              <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col overflow-hidden border-r border-edge/60 bg-panel2 px-4 py-4 md:flex">
                <div className="mb-3 flex shrink-0 items-center gap-2 px-2">
                  <span className="text-3xl font-extrabold tracking-tighter text-[#0EA5E9]">frostbreaker</span>
                </div>
                <WorkspaceSwitcher className="mb-3 shrink-0" />
                <CommandPaletteTrigger />
                <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
                  <Nav />
                </div>
                <div className="mt-3 shrink-0 border-t border-edge/60 pt-3">
                  {/* Konto und Abmelden untereinander statt nebeneinander:
                      der Knopf hat jetzt einen Rahmen und braucht die ganze
                      Breite, sonst quetscht ihn eine lange Adresse. */}
                  <div className="px-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs text-faint" title={user.email}>
                        {user.email}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <LanguageToggle />
                        <ThemeToggle />
                      </div>
                    </div>
                    <div className="mt-2">
                      <LogoutButton />
                    </div>
                  </div>
                </div>
              </aside>
              <div className="min-w-0 flex-1 md:pl-64">
                {/* Der mobile Kopf.

                    Der Workspace-Waehler ist aus ihm herausgewandert und steht
                    jetzt in der Schublade. Grund: bei 375 Pixeln teilten sich
                    Logo (rund 150), Waehler und zwei Knoepfe eine Zeile, und
                    der Waehler bekam davon rund 90 Pixel -- genug fuer
                    "Frostbr…" und sonst nichts. In der Schublade hat er die
                    volle Breite, und der Kopf traegt nur noch das, was
                    dauerhaft sichtbar sein muss.

                    Abmelden ist mit ihm gewandert, aus demselben Grund: es ist
                    der seltenste Handgriff der drei und stand im Kopf an der
                    prominentesten Stelle.

                    px-4 statt px-6: der Kopf muss mit dem Inhalt darunter
                    fluchten, und der steht mobil auf px-4. */}
                <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-edge/60 bg-surface/80 px-4 backdrop-blur md:hidden">
                  <MobileNav email={user.email ?? ""} />
                  <span className="min-w-0 flex-1 truncate text-3xl font-extrabold tracking-tighter text-[#0EA5E9]">
                    frostbreaker
                  </span>
                </header>
                {/* px-4 auf dem Handy statt px-8: die 64 Pixel Rand von px-8
                    sind auf einem 375er Bildschirm ein Sechstel der Breite,
                    und genau die fehlt jeder Tabelle und jedem Textfeld
                    darunter. py-5 statt py-7 aus demselben Grund fuer die
                    Hoehe: mobil ist jeder Zentimeter, den man nicht scrollen
                    muss, ein gewonnener.

                    pb mit safe-area: sonst endet die letzte Zeile jeder Seite
                    unter dem Wischbalken des iPhones. */}
                <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 md:px-8 md:py-7 [padding-bottom:calc(1.25rem+env(safe-area-inset-bottom))] md:[padding-bottom:1.75rem]">
                  {children}
                </main>
              </div>
            </div>
            </ToastProvider>
          </WorkspaceProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
