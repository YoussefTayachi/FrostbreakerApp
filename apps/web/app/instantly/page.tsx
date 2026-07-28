import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { IconLock, IconMail, IconSend, IconShield, IconSparkle } from "../icons";
import { cardCls } from "@/lib/ui";

export default async function InstantlyOverviewPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const O = t.instantly.overview;
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  const [{ data: key }, { data: stats }] = await Promise.all([
    supabase.from("api_keys").select("provider").eq("workspace_id", workspaceId).eq("provider", "instantly").maybeSingle(),
    supabase
      .from("instantly_campaign_stats")
      .select("emails_sent_count, open_count, reply_count_unique, bounced_count")
      .eq("workspace_id", workspaceId),
  ]);
  const hasKey = !!key;

  const totals = (stats ?? []).reduce(
    (acc, s) => ({
      sent: acc.sent + (s.emails_sent_count ?? 0),
      opens: acc.opens + (s.open_count ?? 0),
      replies: acc.replies + (s.reply_count_unique ?? 0),
      bounces: acc.bounces + (s.bounced_count ?? 0),
    }),
    { sent: 0, opens: 0, replies: 0, bounces: 0 }
  );
  const hasStats = (stats ?? []).length > 0;

  const cards = [
    { href: "/instantly/connection", icon: IconLock, title: O.cardConnectionTitle, body: O.cardConnectionBody },
    { href: "/instantly/mailboxes", icon: IconMail, title: O.cardMailboxesTitle, body: O.cardMailboxesBody },
    { href: "/instantly/campaigns", icon: IconSend, title: O.cardCampaignsTitle, body: O.cardCampaignsBody },
    { href: "/instantly/deliverability", icon: IconShield, title: O.cardDeliverabilityTitle, body: O.cardDeliverabilityBody },
    { href: "/instantly/email-check", icon: IconSparkle, title: O.cardEmailCheckTitle, body: O.cardEmailCheckBody },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{O.title}</h1>
        <p className="text-sm text-faint">{O.subtitle}</p>
      </div>

      {!hasKey && (
        <div className={cardCls + " border-dashed"}>
          <h2 className="font-medium text-ink">{O.notConnectedHeading}</h2>
          <p className="mb-4 mt-1 text-sm text-faint">{O.notConnectedBody}</p>
          <Link
            href="/instantly/connection"
            className="inline-block rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all hover:bg-sky-500"
          >
            {O.connectNow}
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg border border-edge/60 bg-panel p-5 transition-all hover:-translate-y-0.5 hover:border-sky-500/50"
          >
            <Icon className="mb-2 h-5 w-5 text-sky-600 dark:text-sky-400" />
            <h3 className="font-medium text-ink">{title}</h3>
            <p className="mt-1 text-xs text-faint">{body}</p>
          </Link>
        ))}
      </div>

      {hasKey && (
        <div className={cardCls}>
          <h2 className="mb-4 font-medium text-ink">{O.statsHeading}</h2>
          {!hasStats && <p className="text-sm text-faint">{O.noStats}</p>}
          {hasStats && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-2xl font-semibold text-ink">{totals.sent}</p>
                <p className="text-xs text-faint">{O.statsSent}</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-ink">{totals.opens}</p>
                <p className="text-xs text-faint">{O.statsOpens}</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-ink">{totals.replies}</p>
                <p className="text-xs text-faint">{O.statsReplies}</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-ink">{totals.bounces}</p>
                <p className="text-xs text-faint">{O.statsBounces}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
