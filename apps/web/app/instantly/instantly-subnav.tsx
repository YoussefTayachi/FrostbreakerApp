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
    /* Segment-Umschalter statt Unterstrich-Reiter: der aktive Bereich ist
       eine gehobene Flaeche, keine 2-Pixel-Linie. Das ist auf dem Handy der
       Unterschied zwischen "sieht man" und "muss man suchen".

       Auf dem Handy scrollt die Leiste waagerecht, statt umzubrechen.
       Sechs Reiter brauchen zusammen rund 520 Pixel. Umgebrochen ergaben sie
       auf einem 390er Bildschirm drei Zeilen, in denen die Markierung des
       aktiven Reiters nur noch unter der letzten Zeile lag. Eine
       Reiterleiste, die drei Zeilen hoch ist, ist keine Leiste mehr.

       Hier ist Scrollen die richtige Antwort und nicht der Notausgang: die
       Reiter haben eine natuerliche Reihenfolge, man liest sie von links
       nach rechts, und der aktive ist immer sichtbar, weil man ihn gerade
       angetippt hat. Das -mx-4 px-4 laesst die Leiste unter sm bis an den
       Bildschirmrand scrollen, statt in der Seitenpolsterung abzuschneiden. */
    <div className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:overflow-x-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
      <nav className="inline-flex rounded-lg bg-chip p-1">
        {items.map(({ href, label }) => {
          const active = href === "/instantly" ? pathname === "/instantly" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={
                "shrink-0 whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 " +
                (active ? "bg-panel text-ink shadow-sm dark:bg-white/[0.08]" : "text-soft hover:text-ink")
              }
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
