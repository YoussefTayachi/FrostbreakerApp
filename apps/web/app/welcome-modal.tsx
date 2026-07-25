"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-up w-full max-w-md rounded-xl border border-edge/60 bg-panel p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-ink">{t.welcome.heading}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-faint">{t.welcome.body}</p>

        <ol className="mt-5 space-y-2.5">
          {openSteps.map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-sm text-soft">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-semibold text-sky-600 dark:text-sky-300">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>

        <div className="mt-6 flex items-center gap-3">
          <Link
            href="/settings"
            onClick={dismiss}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-surface transition-all hover:opacity-85 active:scale-[0.99]"
          >
            {t.welcome.primaryCta}
          </Link>
          <button
            onClick={dismiss}
            className="rounded-lg px-3 py-2.5 text-sm text-faint transition-colors hover:text-ink"
          >
            {t.welcome.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}
