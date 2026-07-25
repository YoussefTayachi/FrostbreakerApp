"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UNREAD_CHANGED_EVENT } from "@/lib/unread";
import {
  IconAgent,
  IconDashboard,
  IconInbox,
  IconLeads,
  IconPipeline,
  IconSearch,
  IconSend,
  IconSettings,
  IconShield,
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
    // Die Inbox meldet sofort, wenn sie etwas als gelesen markiert hat --
    // sonst haengt das Badge bis zu einer Minute hinterher.
    window.addEventListener(UNREAD_CHANGED_EVENT, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(UNREAD_CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  return count;
}

export default function Nav() {
  const pathname = usePathname();
  const { t } = useT();
  const { workspaceId } = useWorkspace();
  const unread = useUnreadReplies(workspaceId);

  const items = [
    { href: "/", label: t.nav.dashboard, icon: IconDashboard, badge: 0 },
    { href: "/searches", label: t.nav.searches, icon: IconSearch, badge: 0 },
    { href: "/leads", label: t.nav.leads, icon: IconLeads, badge: 0 },
    { href: "/pipeline", label: t.nav.pipeline, icon: IconPipeline, badge: 0 },
    { href: "/inbox", label: t.nav.inbox, icon: IconInbox, badge: unread },
    { href: "/ai-agent", label: t.nav.aiAgent, icon: IconAgent, badge: 0 },
    { href: "/instantly", label: t.nav.instantly, icon: IconSend, badge: 0 },
    { href: "/blocklist", label: t.nav.blocklist, icon: IconShield, badge: 0 },
    { href: "/settings", label: t.nav.settings, icon: IconSettings, badge: 0 },
  ];

  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon, badge }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 " +
              (active
                ? "border border-edge/60 bg-panel font-medium text-ink shadow-sm"
                : "border border-transparent text-soft hover:bg-chip hover:text-ink")
            }
          >
            <Icon className={"h-[18px] w-[18px] " + (active ? "text-sky-600 dark:text-sky-400" : "text-faint")} />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className="min-w-5 rounded-full bg-sky-600 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
