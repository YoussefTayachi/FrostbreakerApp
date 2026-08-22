"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UNREAD_CHANGED_EVENT } from "@/lib/unread";
import {
  IconAgent,
  IconChart,
  IconCost,
  IconDashboard,
  IconGuide,
  IconInbox,
  IconLeads,
  IconLinkedIn,
  IconLock,
  IconOffer,
  IconPalette,
  IconPhone,
  IconPipeline,
  IconSearch,
  IconSend,
  IconSettings,
  IconShield,
  IconSparkle, IconUsers,
} from "./icons";
import { useT } from "./language-provider";
import { useWorkspace } from "./workspace-provider";

const UNREAD_POLL_MS = 60_000;

/** Ungelesene eingehende Antworten fuers Inbox-Badge. Zaehlt serverseitig
 *  (head + count), holt also keine Nachrichteninhalte in die Sidebar. */
function useUnreadReplies(workspaceId: string): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const { count: n } = await createClient()
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("direction", "inbound")
      .is("read_at", null);
    setCount(n ?? 0);
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, UNREAD_POLL_MS);
    // Die Inbox meldet sofort, wenn sie etwas als gelesen markiert hat;
    // sonst haengt das Badge bis zu einer Minute hinterher.
    window.addEventListener(UNREAD_CHANGED_EVENT, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(UNREAD_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return count;
}

type NavEntry = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactElement;
  badge?: number;
};

export default function Nav() {
  const pathname = usePathname();
  const { t } = useT();
  const { workspaceId } = useWorkspace();
  const unread = useUnreadReplies(workspaceId);

  /**
   * Die Leiste in Gruppen statt fuenfzehn gleichrangiger Zeilen.
   *
   * Gewachsen ist sie durch Zutun: jede neue Ansicht kam unten dran, bis
   * nichts mehr auf einen Blick erfassbar war. Gruppiert wird nach dem, was
   * man beim Arbeiten NACHEINANDER braucht, nicht nach technischer
   * Verwandtschaft:
   *
   *   Uebersicht   was habe ich       Dashboard, Suchen, Leads
   *   Pipeline     was mache ich      Board, Anrufliste, LinkedIn
   *   Texte        was schreibe ich   Vorgaben, erzeugte Aufhaenger
   *   Versand      was geht raus      Kampagnen, Posteingang, Wirkung
   *   Einstellungen                   Sperrliste, Kosten
   *
   * Der Hauptpunkt ist selbst eine Seite, kein blosser Titel. Eine
   * Ueberschrift, die nichts tut, kostet eine Zeile und gibt nichts zurueck.
   *
   * Untereinträge sind IMMER sichtbar und nicht einklappbar. Ein Klappmenue
   * spart Platz, kostet aber bei jedem Wechsel einen zusaetzlichen Klick;
   * in einem Werkzeug, das den ganzen Tag offen ist, ist das der schlechtere
   * Tausch. Die Einrueckung allein macht die Liste lesbar.
   */
  const groups: { parent: NavEntry; children: NavEntry[] }[] = [
    {
      parent: { href: "/", label: t.nav.dashboard, icon: IconDashboard },
      children: [
        { href: "/searches", label: t.nav.searches, icon: IconSearch },
        { href: "/leads", label: t.nav.leads, icon: IconLeads },
      ],
    },
    {
      parent: { href: "/pipeline", label: t.nav.pipeline, icon: IconPipeline },
      children: [
        { href: "/calls", label: t.nav.calls, icon: IconPhone },
        { href: "/linkedin", label: t.nav.linkedin, icon: IconLinkedIn },
      ],
    },
    {
      // Vorgaben oben, Ergebnis darunter: im AI-Agent-Tab stehen Prompt,
      // Wortgrenze und Verbotswoerter, unter Aufhaenger das, was dabei
      // herauskam.
      //
      // Das Angebot steht als erster Untereintrag und nicht hinter dem
      // Aufhaenger: es ist die Grundlage fuer alles, was in dieser Gruppe
      // geschrieben wird: Mail-Sequenz, LinkedIn-Vorlage, Nachschaerfen.
      // Der Aufhaenger ist ein Satz, das Angebot ist die Sache.
      parent: { href: "/ai-agent", label: t.nav.aiAgent, icon: IconAgent },
      children: [
        { href: "/offers", label: t.nav.offers, icon: IconOffer },
        { href: "/icebreaker", label: t.nav.icebreaker, icon: IconSparkle },
      ],
    },
    {
      parent: { href: "/instantly", label: t.nav.instantly, icon: IconSend },
      children: [
        { href: "/inbox", label: t.nav.inbox, icon: IconInbox, badge: unread },
        { href: "/wirkung", label: t.nav.effectiveness, icon: IconChart },
      ],
    },
    {
      parent: { href: "/settings", label: t.nav.settings, icon: IconSettings },
      children: [
        { href: "/settings/keys", label: t.nav.apiKeys, icon: IconLock },
        { href: "/settings/automations", label: t.nav.automations, icon: IconSparkle },
        { href: "/settings/branding", label: t.nav.branding, icon: IconPalette },
        { href: "/settings/team", label: t.nav.team, icon: IconUsers },
        { href: "/settings/mcp", label: t.nav.mcp, icon: IconAgent },
        { href: "/blocklist", label: t.nav.blocklist, icon: IconShield },
        { href: "/costs", label: t.nav.costs, icon: IconCost },
      ],
    },
  ];

  // Die Anleitung steht allein und ganz unten: sie gehoert zu keinem
  // Arbeitsschritt, sondern zu allen.
  const standalone: NavEntry = { href: "/guide", label: t.nav.guide, icon: IconGuide };

  function isActive(href: string): boolean {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    // Der Abstand zwischen den Gruppen ist bewusst knapp: er muss die Gruppen
    // noch trennen, darf die Liste aber nicht ueber die Fensterhoehe treiben
    // (siehe Kommentar zur Seitenleiste in layout.tsx).
    <nav className="flex flex-col gap-2">
      {groups.map(({ parent, children }) => (
        <div key={parent.href} className="flex flex-col gap-0.5">
          <NavRow entry={parent} active={isActive(parent.href)} />
          {/* Die Leiste links verbindet die Untereinträge sichtbar mit ihrem
              Hauptpunkt. Ohne sie wirkt die Einrueckung wie ein Zufall. */}
          <div className="ml-[22px] flex flex-col gap-0.5 border-l border-edge2/70 pl-2">
            {children.map((child) => (
              <NavRow key={child.href} entry={child} active={isActive(child.href)} sub />
            ))}
          </div>
        </div>
      ))}
      <NavRow entry={standalone} active={isActive(standalone.href)} />
    </nav>
  );
}

function NavRow({ entry, active, sub }: { entry: NavEntry; active: boolean; sub?: boolean }) {
  const { label, icon: Icon, badge = 0 } = entry;
  return (
    <Link
      href={entry.href}
      className={
        "relative flex items-center gap-2.5 rounded-lg transition-all duration-200 " +
        // Zeilenhoehe ausdruecklich gesetzt, nicht geerbt: text-[13px] legt in
        // Tailwind nur die Schriftgroesse fest, die Hoehe kaeme sonst aus der
        // Vererbung (1.5 => ~20px) und machte jede Untereintragszeile vier
        // Pixel hoeher, als sie sein muss. Mal zwoelf Untereintraege ist genau
        // das der Unterschied zwischen "passt ins Fenster" und "passt nicht".
        (sub ? "px-2.5 py-1 text-[13px] leading-4 " : "px-3 py-2 text-sm leading-5 ") +
        (active
          ? "border border-edge/60 bg-panel font-medium text-ink shadow-sm"
          : "border border-transparent text-soft hover:bg-chip hover:text-ink")
      }
    >
      <Icon
        className={
          (sub ? "h-4 w-4 " : "h-[18px] w-[18px] ") +
          (active ? "text-sky-600 dark:text-sky-400" : "text-faint")
        }
      />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="min-w-5 rounded-full bg-sky-600 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
