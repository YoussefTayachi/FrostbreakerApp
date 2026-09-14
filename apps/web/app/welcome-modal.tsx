"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "./language-provider";

const DISMISS_KEY = "fb_welcome_modal_dismissed";

/**
 * Begruessung beim allerersten Dashboard-Aufruf. Zeigt dieselben vier Schritte
 * wie die Checkliste darunter, aber unuebersehbar: neue Accounts landeten
 * bisher auf einem leeren Dashboard, ohne dass klar war, dass ohne API-Keys
 * gar nichts laufen kann.
 *
 * Der "schon gesehen"-Merker liegt im localStorage statt in der Datenbank:
 * ein einmaliger UI-Hinweis rechtfertigt keine Migration, und im schlimmsten
 * Fall erscheint er auf einem zweiten Geraet noch einmal.
 */
export default function WelcomeModal({ openSteps }: { openSteps: string[] }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;
    setOpen(true);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.welcome.heading}
      className="scrim-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in w-full max-w-md rounded-2xl border border-edge/70 bg-panel p-5 shadow-2xl sm:p-6"
      >
        <h2 className="text-xl font-semibold tracking-tight text-ink">{t.welcome.heading}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-faint">{t.welcome.body}</p>

        <ol className="mt-5 space-y-2.5">
          {openSteps.map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-sm text-soft">
              <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-2xs font-semibold text-sky-600 dark:text-sky-300">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link href="/settings" onClick={dismiss} className={primaryBtnCls}>
            {t.welcome.primaryCta}
          </Link>
          <Link href="/guide" onClick={dismiss} className={secondaryBtnCls}>
            {t.welcome.guideCta}
          </Link>
          <button
            onClick={dismiss}
            className="ml-auto rounded-lg px-3 py-2.5 text-sm text-faint transition-colors hover:text-ink"
          >
            {t.welcome.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
