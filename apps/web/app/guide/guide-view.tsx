"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { GuideSection } from "@/lib/guide/content";
import type { Dictionary } from "@/lib/i18n/dict";

/**
 * Aufklappbare Abschnitte statt einer langen Seite: wer nur wissen will, was
 * Warmup ist, soll nicht an acht anderen Kapiteln vorbeiscrollen. Der erste
 * Abschnitt ist offen, damit die Seite nicht wie eine leere Liste wirkt.
 *
 * Der Zustand liegt absichtlich nicht in der URL -- es ist ein Nachschlagewerk,
 * kein Zustand, den man teilen oder zurueckspringen will.
 */
export default function GuideView({
  sections,
  labels,
}: {
  sections: GuideSection[];
  labels: Dictionary["guide"];
}) {
  const [openId, setOpenId] = useState<string | null>(sections[0]?.id ?? null);

  // Tiefe Verlinkung (/guide#warmup) aus der App heraus: ohne das landet man
  // auf der Seite, aber der gemeinte Abschnitt ist zugeklappt -- und ein
  // Sprunganker greift nicht, weil der Inhalt dann gar nicht gerendert ist.
  // Erst oeffnen, dann scrollen (nach dem Render, daher der Timeout-freie
  // Umweg ueber einen zweiten Effekt-Durchlauf).
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (id && sections.some((s) => s.id === id)) setOpenId(id);
  }, [sections]);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (id && openId === id) {
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [openId]);

  return (
    <div className="space-y-2.5">
      {sections.map((section) => {
        const open = openId === section.id;
        return (
          <section
            key={section.id}
            id={section.id}
            className={
              "scroll-mt-4 overflow-hidden rounded-lg border bg-panel transition-colors " +
              (open ? "border-sky-500/40" : "border-edge/60 hover:border-edge2")
            }
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : section.id)}
              aria-expanded={open}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
            >
              <span aria-hidden className="mt-0.5 text-lg leading-none">
                {section.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{section.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-faint">
                  {section.summary}
                </span>
              </span>
              <span
                aria-hidden
                className={
                  "mt-1 shrink-0 text-mute transition-transform " + (open ? "rotate-90" : "")
                }
              >
                ›
              </span>
            </button>

            {open && (
              <div className="space-y-4 border-t border-edge/60 px-4 py-4 pl-[3.25rem]">
                {section.body.map((paragraph) => (
                  <p key={paragraph.slice(0, 40)} className="text-sm leading-relaxed text-soft">
                    {paragraph}
                  </p>
                ))}

                {section.steps && (
                  <ol className="space-y-2">
                    {section.steps.map((step, i) => (
                      <li key={step.slice(0, 40)} className="flex items-start gap-2.5 text-sm text-soft">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-semibold text-sky-600 dark:text-sky-300">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ol>
                )}

                {section.warning && (
                  <p className="rounded-lg border-l-2 border-amber-500/60 bg-amber-500/5 px-3 py-2.5 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                    <span className="font-medium">{labels.noteLabel}</span> {section.warning}
                  </p>
                )}

                {section.href && (
                  <Link
                    href={section.href}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-medium text-white transition-all hover:brightness-110 active:scale-[0.98]"
                  >
                    {section.hrefLabel} <span aria-hidden>→</span>
                  </Link>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
