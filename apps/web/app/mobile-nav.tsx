"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Nav from "./nav";
import LogoutButton from "./logout-button";
import ThemeToggle from "./theme-toggle";
import WorkspaceSwitcher from "./workspace-switcher";
import { LanguageToggle } from "./language-provider";
import { IconClose, IconMenu, IconSearch } from "./icons";
import { useT } from "./language-provider";

/**
 * Die Navigation auf dem Handy.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DIESE DATEI GIBT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Die Seitenleiste in layout.tsx ist `hidden ... md:flex`. Unter 768 Pixeln
 * gab es damit KEINE Navigation: der Kopf trug Logo, Workspace-Waehler und
 * Abmelden, und das war alles. Wer auf dem Handy auf dem Dashboard landete,
 * kam von dort auf keine einzige andere Seite -- ausser ueber die Kacheln,
 * die zufaellig irgendwohin verlinken, oder ueber die Adresszeile. Fuenfzehn
 * Ansichten waren mobil schlicht unerreichbar.
 *
 * Eine Schublade und keine untere Leiste: fuenf Gruppen mit zusammen zwanzig
 * Zielen passen in keine Leiste mit vier Symbolen, und eine Leiste, die nur
 * die vier haeufigsten zeigt, macht die restlichen sechzehn wieder
 * unerreichbar. Die Schublade zeigt dieselbe Gliederung wie die
 * Seitenleiste -- wer beides benutzt, lernt die App nur einmal.
 *
 * Dieselbe <Nav /> wie die Seitenleiste, bewusst keine gekuerzte Fassung:
 * zwei Navigationen laufen auseinander, sobald jemand einen Menuepunkt nur in
 * einer von beiden ergaenzt.
 */
export default function MobileNav({ email }: { email: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Seitenwechsel schliesst. Ohne das bleibt die Schublade ueber der Seite
  // stehen, die man gerade angesteuert hat.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    // Der Hintergrund darf nicht mitscrollen: sonst wischt man in der
    // Schublade und die Seite darunter wandert weg.
    const vorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        // Zurueck auf den Knopf, sonst steht der Fokus nach dem Schliessen im
        // Nichts und die naechste Tabulatortaste faengt oben auf der Seite an.
        buttonRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);

    // Fokus in die Schublade. Sie liegt ueber der ganzen Seite; bleibt der
    // Fokus dahinter, wandert die Tabulatortaste durch Inhalte, die niemand
    // sieht.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = vorher;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.nav.menu}
        aria-expanded={open}
        // h-10 w-10: das Mindestmass fuer ein Ziel, das mit dem Daumen
        // getroffen werden muss. Die 18px des Symbols allein waeren zu wenig.
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-edge2 text-soft transition-colors hover:border-edge3 hover:text-ink"
      >
        <IconMenu className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Der Schleier schliesst bei Beruehrung. Er ist die Flaeche, die
              jeder zuerst antippt, wenn er wieder heraus will. */}
          <button
            type="button"
            aria-label={t.nav.closeMenu}
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/50 backdrop-blur-[2px]"
          />
          {/* Von links, wie die Seitenleiste, die sie vertritt. w-[19rem] statt
              der 16rem der Leiste: auf dem Handy ist die Schublade die ganze
              Navigation und nicht die schmale Spalte neben dem Inhalt.
              max-w-[85vw] laesst am Rand einen Streifen der Seite stehen, damit
              erkennbar bleibt, dass darunter etwas liegt.

              onClickCapture faengt jeden Klick im Inneren ab, auch den auf den
              Link zur Seite, auf der man schon steht: dort aendert sich
              pathname nicht, und der Effekt oben wuerde die Schublade offen
              stehen lassen. */}
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={t.nav.menu}
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
            className="absolute inset-y-0 left-0 flex w-[19rem] max-w-[85vw] flex-col overflow-hidden border-r border-edge/60 bg-panel2 shadow-2xl outline-none"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4">
              <span className="text-3xl font-extrabold tracking-tighter text-[#0EA5E9]">frostbreaker</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.nav.closeMenu}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge2 text-soft transition-colors hover:border-edge3 hover:text-ink"
              >
                <IconClose className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="shrink-0 px-4 pt-3">
              <WorkspaceSwitcher className="mb-3" />
              {/* Eigener Knopf statt CommandPaletteTrigger: der zeigt ⌘K, und
                  auf einem Handy gibt es keine Befehlstaste. Die Palette
                  selbst funktioniert dort, nur ihr Kuerzel nicht. */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event("open-command-palette"));
                }}
                className="mb-3 flex w-full items-center gap-2.5 rounded-lg border border-edge/60 bg-panel px-3 py-2.5 text-left text-sm text-faint transition-colors hover:border-edge2 hover:text-ink"
              >
                <IconSearch className="h-4 w-4 shrink-0" />
                <span className="flex-1">{t.commandPalette.triggerLabel}</span>
              </button>
            </div>

            {/* Der scrollende Teil, wie in der Seitenleiste. min-h-0 ist auch
                hier der Punkt, an dem es sonst scheitert: ohne das weigert
                sich das Flex-Kind, kleiner als sein Inhalt zu werden, und der
                Fuss mit dem Abmelden wandert aus dem Bild. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
              <Nav />
            </div>

            {/* pb mit safe-area: auf iPhones liegt sonst die Abmelden-Zeile
                unter dem Balken fuer die Wischgeste. */}
            <div className="shrink-0 border-t border-edge/60 px-4 pt-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-faint" title={email}>
                  {email}
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
        </div>
      )}
    </>
  );
}
