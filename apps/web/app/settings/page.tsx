"use client";
import Link from "next/link";
import { cardCls } from "@/lib/ui";
import { IconAgent, IconCost, IconLock, IconSend, IconSettings, IconShield, IconSparkle, IconUsers } from "../icons";
import { useT } from "../language-provider";
import BillingSection from "./billing-section";
import CustomFields from "./custom-fields";
import HelpLink from "../help-link";

/**
 * Die Einstellungen als Verteiler, nicht mehr als Sammelseite.
 *
 * Bis 2026-08-04 stand hier alles untereinander: Abo, fuenf API-Schluessel,
 * CSV-Import, eigene Felder, Automatisierungen, Antwort-Benachrichtigung,
 * Antwort-Assistent, Branding, Integrationsliste. Ueber 500 Zeilen in einer
 * Datei, und wer die Automatisierungen suchte, scrollte an Farbwerten vorbei.
 *
 * Was blieb, ist das, was zu keinem der neuen Bereiche gehoert: das Abo (eine
 * Sache des Kontos, nicht der Einrichtung) und die eigenen Felder (die
 * betreffen Kontakte, Firmen und Deals gleichermassen und haetten unter jedem
 * Einzelbereich falsch gestanden).
 *
 * Der CSV-Import ist ausgezogen: er gehoert dorthin, wo die anderen
 * Lead-Listen entstehen, also unter Suchen.
 */
const SECTIONS = [
  { href: "/settings/keys", icon: IconLock },
  { href: "/settings/automations", icon: IconSparkle },
  { href: "/settings/branding", icon: IconSettings },
  { href: "/settings/team", icon: IconUsers },
  { href: "/settings/mcp", icon: IconAgent },
  { href: "/blocklist", icon: IconShield },
  { href: "/costs", icon: IconCost },
] as const;

export default function SettingsPage() {
  const { t } = useT();
  const S = t.settings.sections;

  return (
    <div className="fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.settings.title}</h1>
        <p className="mt-1 text-sm text-faint">
          {t.settings.subtitle} <HelpLink section="keys" label={t.guide.helpLink} />
        </p>
      </div>

      <BillingSection />

      {/* Dieselben Bereiche wie in der Seitenleiste, hier mit einem Satz
          dazu — wer auf Einstellungen klickt, sucht meist etwas Bestimmtes
          und weiss nicht, unter welchem der fuenf Namen es wohnt. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-start gap-3 rounded-xl border border-edge/70 bg-panel p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-sky-500/50 hover:shadow-md"
          >
            {/* Das Symbol in eigener Flaeche: sieben Zeilen mit sieben frei
                stehenden Glyphen lasen sich als Aufzaehlung, nicht als Kacheln. */}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{S[href].title}</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-faint">{S[href].hint}</span>
            </span>
          </Link>
        ))}
      </div>

      <Link
        href="/instantly"
        className="flex items-center justify-between gap-3 rounded-xl border border-edge/70 bg-panel p-4 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-sky-500/50 hover:shadow-md sm:p-5"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <IconSend className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">Instantly.ai</span>
            <span className="mt-0.5 block text-sm leading-relaxed text-faint">{S.instantly.hint}</span>
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-sm text-mute">→</span>
      </Link>

      {/* Eigene Felder bleiben hier: sie haengen an Kontakten, Firmen UND
          Deals: unter einem der Einzelbereiche waeren sie zwangslaeufig am
          falschen Ort. */}
      <div className={cardCls}>
        <h2 className="text-base font-semibold text-ink">{t.customFields.heading}</h2>
        <p className="mb-5 mt-1 text-sm leading-relaxed text-faint">{t.customFields.description}</p>
        <CustomFields />
      </div>

      <div className={cardCls}>
        <h2 className="text-base font-semibold text-ink">{t.settings.stackHeading}</h2>
        <p className="mb-5 mt-1 text-sm leading-relaxed text-faint">{t.settings.stackDescription}</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {t.settings.integrations.map((it) => (
            <div
              key={it.name}
              className="rounded-lg border border-edge/70 bg-surface/60 px-3 py-2.5 transition-colors duration-150 hover:border-edge2"
            >
              <p className="text-sm font-medium text-ink">{it.name}</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-faint">{it.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
