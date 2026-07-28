"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "../language-provider";

/**
 * Horizontale Unternavigation fuer den gesamten /instantly-Bereich (Uebersicht,
 * Verbindung, Mailboxen, Kampagnen). Bewusst als eigene kleine Client-
 * Komponente statt in app/nav.tsx integriert -- die Hauptnavigation bleibt
 * eine flache Liste, dieser Bereich hier ist der einzige mit einer zweiten
 * Ebene.
 */
export default function InstantlySubnav() {
  const pathname = usePathname();
  const { t } = useT();
  const S = t.instantly.subnav;

  const items = [
    { href: "/instantly", label: S.overview },
    { href: "/instantly/connection", label: S.connection },
    { href: "/instantly/mailboxes", label: S.mailboxes },
    { href: "/instantly/campaigns", label: S.campaigns },
    { href: "/instantly/deliverability", label: S.deliverability },
    { href: "/instantly/email-check", label: S.emailCheck },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-edge/60 pb-0">
      {items.map(({ href, label }) => {
        const active = href === "/instantly" ? pathname === "/instantly" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              "relative -mb-px border-b-2 px-3.5 py-2.5 text-sm transition-colors " +
              (active ? "border-sky-500 font-medium text-ink" : "border-transparent text-faint hover:text-ink")
            }
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
