"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "../language-provider";

/**
 * Horizontale Unternavigation fuer den gesamten /instantly-Bereich (Uebersicht,
 * Verbindung, Mailboxen, Kampagnen). Bewusst als eigene kleine Client-
 * Komponente statt in app/nav.tsx integriert: die Hauptnavigation bleibt
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
    /* Auf dem Handy eine Reiterleiste, die waagerecht scrollt, statt einer,
       die umbricht.

       Sechs Reiter brauchen zusammen rund 520 Pixel. Umgebrochen ergaben sie
       auf einem 390er Bildschirm drei Zeilen, in denen die untere Kante --
       also genau das, was den aktiven Reiter markiert -- nur noch unter der
       letzten Zeile lag. Eine Reiterleiste, die drei Zeilen hoch ist, ist
       keine Leiste mehr, sondern ein Menue mit Unterstrich.

       Hier ist Scrollen die richtige Antwort und nicht der Notausgang: die
       Reiter haben eine natuerliche Reihenfolge, man liest sie von links
       nach rechts, und der aktive ist immer sichtbar, weil man ihn gerade
       angetippt hat. Ab sm bricht wieder nichts und nichts scrollt. */
    <div className="mb-6 flex flex-nowrap gap-1 overflow-x-auto border-b border-edge/60 pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible">
      {items.map(({ href, label }) => {
        const active = href === "/instantly" ? pathname === "/instantly" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              "relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors " +
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
