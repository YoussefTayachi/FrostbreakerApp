"use client";
import Link from "next/link";
import { cardCls } from "@/lib/ui";
import { IconCost, IconLock, IconSend, IconSettings, IconShield, IconSparkle } from "../icons";
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
  { href: "/blocklist", icon: IconShield },
  { href: "/costs", icon: IconCost },
] as const;

export default function SettingsPage() {
  const { t } = useT();
  const S = t.settings.sections;

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.settings.title}</h1>
        <p className="text-sm text-faint">
          {t.settings.subtitle} <HelpLink section="keys" label={t.guide.helpLink} />
        </p>
      </div>

      <BillingSection />

      {/* Dieselben Bereiche wie in der Seitenleiste, hier mit einem Satz
          dazu -- wer auf Einstellungen klickt, sucht meist etwas Bestimmtes
          und weiss nicht, unter welchem der fuenf Namen es wohnt. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {SECTIONS.map(({ href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start gap-3 rounded-lg border border-edge/60 bg-panel p-4 transition-all hover:-translate-y-0.5 hover:border-sky-500/50"
          >
            <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-sky-600 dark:text-sky-400" />
            <span>
              <span className="block text-sm font-medium text-ink">{S[href].title}</span>
              <span className="block text-xs leading-relaxed text-faint">{S[href].hint}</span>
            </span>
          </Link>
        ))}
      </div>

      <Link
        href="/instantly"
        className="flex items-center justify-between rounded-lg border border-edge/60 bg-panel p-6 transition-all hover:-translate-y-0.5 hover:border-sky-500/50"
      >
        <span className="flex items-center gap-3">
          <IconSend className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          <span>
            <span className="block font-medium text-ink">Instantly.ai</span>
            <span className="block text-xs text-faint">{S.instantly.hint}</span>
          </span>
        </span>
        <span className="text-sm text-faint">→</span>
      </Link>

      {/* Eigene Felder bleiben hier: sie haengen an Kontakten, Firmen UND
          Deals: unter einem der Einzelbereiche waeren sie zwangslaeufig am
          falschen Ort. */}
      <div className={cardCls}>
        <h2 className="font-medium text-ink">{t.customFields.heading}</h2>
        <p className="mb-4 mt-1 text-sm text-faint">{t.customFields.description}</p>
        <CustomFields />
      </div>

      <div className={cardCls}>
        <h2 className="font-medium text-ink">{t.settings.stackHeading}</h2>
        <p className="mb-4 mt-1 text-sm text-faint">{t.settings.stackDescription}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {t.settings.integrations.map((it) => (
            <div
              key={it.name}
              className="rounded-lg border border-edge bg-surface/60 px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-edge2"
            >
              <p className="text-sm font-medium text-ink">{it.name}</p>
              <p className="text-[11px] text-faint">{it.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
