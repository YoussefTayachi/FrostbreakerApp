import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import { IconLock, IconMail, IconSend, IconShield, IconSparkle } from "../icons";
import { cardCls, primaryBtnCls } from "@/lib/ui";

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

  const kpis = [
    { label: O.statsSent, value: totals.sent },
    { label: O.statsOpens, value: totals.opens },
    { label: O.statsReplies, value: totals.replies },
    { label: O.statsBounces, value: totals.bounces },
  ];

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{O.title}</h1>
        <p className="mt-1 text-sm text-faint">{O.subtitle}</p>
      </div>

      {!hasKey && (
        <div className="rounded-xl border border-dashed border-edge2 bg-panel p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-ink">{O.notConnectedHeading}</h2>
          <p className="mb-4 mt-1 text-sm text-faint">{O.notConnectedBody}</p>
          <Link href="/instantly/connection" className={primaryBtnCls + " inline-block"}>
            {O.connectNow}
          </Link>
        </div>
      )}

      {hasKey && (
        <div className={cardCls}>
          <h2 className="text-base font-semibold text-ink">{O.statsHeading}</h2>
          {!hasStats && <p className="py-6 text-center text-sm text-faint">{O.noStats}</p>}
          {hasStats && (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              {kpis.map(({ label, value }) => (
                <div key={label}>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
                  <p className="mt-0.5 text-2xs font-medium uppercase tracking-wider text-mute">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Die Navigationskarten liegen unter den Zahlen: wer den Bereich
          oeffnet, will erst wissen wie es steht, dann wohin. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, icon: Icon, title, body }) => (
          <Link
            key={href}
            href={href}
            className="rounded-xl border border-edge/70 bg-panel p-5 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-edge2 hover:shadow-md"
          >
            <Icon className="h-5 w-5 text-sky-600 transition-colors dark:text-sky-400" />
            <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
            <p className="mt-1 text-sm text-faint">{body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
