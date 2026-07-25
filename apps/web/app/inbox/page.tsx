"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { filterSuppressed } from "@/lib/suppression";
import { notifyUnreadChanged } from "@/lib/unread";
import CompanyLogo from "../company-logo";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

type Msg = {
  id: string;
  contact_id: string | null;
  direction: string;
  subject: string | null;
  body: string | null;
  ai_interest: string | null;
  sent_at: string | null;
  created_at: string;
  read_at: string | null;
  instantly_email_id: string | null;
  contacts: {
    id: string;
    full_name: string | null;
    email: string | null;
    title: string | null;
    outreach_status: string;
    businesses: { name: string; website: string | null } | null;
  } | null;
};

// Feldnamen email/businesses sind so gewaehlt, dass filterSuppressed() direkt auf
// Konversationen anwendbar bleibt (gleiche Blockliste wie in der Leads-Ansicht --
// sonst taucht eine geblockte Firma hier weiter auf, obwohl sie dort verschwunden ist).
type Conversation = {
  contactId: string;
  name: string | null;
  title: string | null;
  email: string | null;
  businesses: { name: string; website: string | null } | null;
  outreachStatus: string;
  messages: Msg[];
  lastAt: string | null;
  unread: number;
  aiInterest: string | null;
  replyTarget: Msg | null;
};

type Filter = "all" | "unread" | "interested" | "question" | "not_interested";

const REFRESH_INTERVAL_MS = 30_000;

function when(msg: Msg): string {
  return msg.sent_at ?? msg.created_at;
}

function formatWhen(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diffMin < 1) return rtf.format(0, "minute");
  if (diffMin < 60) return rtf.format(-diffMin, "minute");
  if (diffMin < 60 * 24) return rtf.format(-Math.round(diffMin / 60), "hour");
  if (diffMin < 60 * 24 * 7) return rtf.format(-Math.round(diffMin / (60 * 24)), "day");
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function formatExact(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toConversations(messages: Msg[]): Conversation[] {
  const byContact = new Map<string, Conversation>();
  for (const m of messages) {
    const contactId = m.contact_id;
    if (!contactId) continue;
    let c = byContact.get(contactId);
    if (!c) {
      c = {
        contactId,
        name: m.contacts?.full_name ?? null,
        title: m.contacts?.title ?? null,
        email: m.contacts?.email ?? null,
        businesses: m.contacts?.businesses ?? null,
        outreachStatus: m.contacts?.outreach_status ?? "new",
        messages: [],
        lastAt: null,
        unread: 0,
        aiInterest: null,
        replyTarget: null,
      };
      byContact.set(contactId, c);
    }
    c.messages.push(m);
  }

  const conversations = [...byContact.values()];
  for (const c of conversations) {
    c.messages.sort((a, b) => when(a).localeCompare(when(b)));
    const inbound = c.messages.filter((m) => m.direction === "inbound");
    c.unread = inbound.filter((m) => !m.read_at).length;
    c.lastAt = c.messages.length ? when(c.messages[c.messages.length - 1]) : null;
    const lastInbound = inbound[inbound.length - 1];
    c.aiInterest = lastInbound?.ai_interest ?? null;
    // Instantly braucht zum Antworten die reply_to_uuid einer echten E-Mail --
    // Nachrichten ohne instantly_email_id (z.B. lokal gespiegelte Ausgaenge)
    // taugen dafuer nicht.
    c.replyTarget = [...inbound].reverse().find((m) => m.instantly_email_id) ?? null;
  }
  conversations.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return conversations;
}

export default function InboxPage() {
  const { t, lang } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const L = t.inbox;
  const locale = lang === "de" ? "de-DE" : "en-US";

  const [messages, setMessages] = useState<Msg[]>([]);
  const [suppression, setSuppression] = useState<{ email: string | null; domain: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const supabase = createClient();
    const [msgRes, supRes] = await Promise.all([
      supabase
        .from("messages")
        .select(
          "id, contact_id, direction, subject, body, ai_interest, sent_at, created_at, read_at, instantly_email_id, " +
            "contacts!inner(id, full_name, email, title, outreach_status, businesses(name, website))"
        )
        .eq("workspace_id", workspaceId)
        .order("sent_at", { ascending: false })
        .limit(1000),
      supabase.from("suppression_list").select("email,domain").eq("workspace_id", workspaceId),
    ]);
    setMessages((msgRes.data ?? []) as unknown as Msg[]);
    setSuppression(supRes.data ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    setSelectedId(null);
    load();
  }, [load]);

  // Der Worker holt neue Antworten alle 5 Minuten von Instantly -- ein leiser
  // Refetch haelt die offene Inbox aktuell, ohne dass der User neu laden muss.
  useEffect(() => {
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const conversations = useMemo(
    () => filterSuppressed(toConversations(messages), suppression),
    [messages, suppression]
  );

  const unreadTotal = useMemo(
    () => conversations.reduce((n, c) => n + c.unread, 0),
    [conversations]
  );

  const visible = useMemo(() => {
    if (filter === "all") return conversations;
    if (filter === "unread") return conversations.filter((c) => c.unread > 0);
    return conversations.filter((c) => c.aiInterest === filter);
  }, [conversations, filter]);

  const selected = useMemo(
    () => conversations.find((c) => c.contactId === selectedId) ?? null,
    [conversations, selectedId]
  );

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [selectedId, selected?.messages.length]);

  async function markRead(contactId: string) {
    const ids = conversations
      .find((c) => c.contactId === contactId)
      ?.messages.filter((m) => m.direction === "inbound" && !m.read_at)
      .map((m) => m.id);
    if (!ids?.length) return;
    const readAt = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: readAt } : m)));
    notifyUnreadChanged();
    const { error } = await createClient()
      .from("messages")
      .update({ read_at: readAt })
      .in("id", ids)
      .eq("workspace_id", workspaceId);
    if (error) push(t.common.error + error.message, "error");
  }

  async function markAllRead() {
    const ids = conversations
      .flatMap((c) => c.messages)
      .filter((m) => m.direction === "inbound" && !m.read_at)
      .map((m) => m.id);
    if (!ids.length) return;
    const readAt = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, read_at: readAt } : m)));
    notifyUnreadChanged();
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await createClient()
        .from("messages")
        .update({ read_at: readAt })
        .in("id", ids.slice(i, i + 200))
        .eq("workspace_id", workspaceId);
      if (error) {
        push(t.common.error + error.message, "error");
        return;
      }
    }
    push(L.markAllReadDone(ids.length), "success");
  }

  function select(c: Conversation) {
    setSelectedId(c.contactId);
    setDraft("");
    if (c.unread > 0) markRead(c.contactId);
  }

  async function sendReply() {
    const target = selected?.replyTarget;
    const text = draft.trim();
    if (!target || !text || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/instantly/emails/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: target.id,
          subject: (L.replySubjectPrefix + (target.subject || "")).trim(),
          body: text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || L.replyErrorGeneric);
      setDraft("");
      push(data.warning ? data.warning : L.replySentToast, data.warning ? "info" : "success");
      await load();
    } catch (e) {
      push((e as Error).message, "error");
    } finally {
      setSending(false);
    }
  }

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: L.filterAll },
    { id: "unread", label: unreadTotal > 0 ? `${L.filterUnread} (${unreadTotal})` : L.filterUnread },
    { id: "interested", label: L.aiInterestLabels.interested },
    { id: "question", label: L.aiInterestLabels.question },
    { id: "not_interested", label: L.aiInterestLabels.not_interested },
  ];

  return (
    <div className="fade-up space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{L.title}</h1>
          <p className="max-w-2xl text-sm text-faint">{L.subtitle}</p>
        </div>
        {unreadTotal > 0 && (
          <button
            onClick={markAllRead}
            className="rounded-lg border border-edge2 px-4 py-2 text-sm font-medium text-soft transition-colors hover:border-edge3 hover:text-ink"
          >
            {L.markAllRead}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
              (filter === f.id
                ? "border-sky-500/60 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                : "border-edge2 bg-chip text-soft hover:border-edge3 hover:text-ink")
            }
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">{L.conversations(visible.length)}</span>
      </div>

      {loading ? (
        <p className="rounded-lg border border-edge/60 bg-panel px-5 py-12 text-center text-sm text-faint">
          {L.loading}
        </p>
      ) : conversations.length === 0 ? (
        <div className="rounded-lg border border-edge/60 bg-panel px-5 py-14 text-center">
          <p className="text-sm text-ink">{L.empty}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-faint">{L.emptyHint}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[20rem_1fr] lg:grid-cols-[24rem_1fr]">
          {/* Konversationsliste */}
          <div
            className={
              "overflow-hidden rounded-lg border border-edge/60 bg-panel " +
              (selected ? "hidden md:block" : "")
            }
          >
            <div className="max-h-[calc(100vh-16rem)] divide-y divide-edge/60 overflow-y-auto">
              {visible.map((c) => {
                const active = c.contactId === selectedId;
                return (
                  <button
                    key={c.contactId}
                    onClick={() => select(c)}
                    className={
                      "flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors " +
                      (active ? "bg-wash" : "hover:bg-wash/60")
                    }
                  >
                    <span className="relative mt-0.5">
                      <CompanyLogo name={c.businesses?.name ?? c.name ?? "?"} website={c.businesses?.website ?? null} size={26} />
                      {c.unread > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel bg-sky-500" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={
                            "truncate text-sm " + (c.unread > 0 ? "font-semibold text-ink" : "text-ink")
                          }
                        >
                          {c.businesses?.name ?? L.unknownContact}
                        </span>
                        <span className="shrink-0 text-[10px] text-faint">{formatWhen(c.lastAt, locale)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="truncate text-xs text-soft">{c.name ?? c.email ?? L.unknownContact}</span>
                        {c.aiInterest && <InterestBadge value={c.aiInterest} labels={L.aiInterestLabels} />}
                      </span>
                      <span className="mt-1 block truncate text-xs text-faint">
                        {c.messages[c.messages.length - 1]?.body?.replace(/\s+/g, " ").trim() || L.noSubject}
                      </span>
                    </span>
                  </button>
                );
              })}
              {visible.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-faint">{L.emptyFiltered}</p>
              )}
            </div>
          </div>

          {/* Thread */}
          <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-lg border border-edge/60 bg-panel">
            {!selected ? (
              <p className="m-auto px-6 py-16 text-center text-sm text-faint">{L.selectHint}</p>
            ) : (
              <>
                <div className="flex items-start gap-3 border-b border-edge/60 px-5 py-3.5">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="mt-0.5 rounded-lg border border-edge/60 px-2 py-0.5 text-sm text-faint transition-colors hover:text-ink md:hidden"
                    aria-label={L.filterAll}
                  >
                    ←
                  </button>
                  <CompanyLogo
                    name={selected.businesses?.name ?? selected.name ?? "?"}
                    website={selected.businesses?.website ?? null}
                    size={30}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {selected.businesses?.name ?? L.unknownContact}
                    </p>
                    <p className="truncate text-xs text-faint">
                      {[selected.name, selected.title, selected.email].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full border border-edge2 bg-chip px-2 py-0.5 text-[10px] font-medium text-soft">
                      {t.leads.statusLabels[selected.outreachStatus] ?? selected.outreachStatus}
                    </span>
                    <Link
                      href={`/leads?q=${encodeURIComponent(selected.businesses?.name ?? "")}`}
                      className="text-[11px] text-sky-600 underline-offset-4 hover:underline dark:text-sky-400"
                    >
                      {L.openInLeads}
                    </Link>
                  </div>
                </div>

                <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4 md:max-h-[calc(100vh-27rem)]">
                  {selected.messages.map((m) => {
                    const inbound = m.direction === "inbound";
                    return (
                      <div
                        key={m.id}
                        className={
                          "max-w-[85%] rounded-lg border px-3.5 py-2.5 " +
                          (inbound
                            ? "border-edge/60 bg-surface/60"
                            : "ml-auto border-sky-500/25 bg-sky-500/5")
                        }
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className={
                              "rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide " +
                              (inbound ? "bg-sky-500/10 text-sky-600 dark:text-sky-300" : "bg-edge2 text-faint")
                            }
                          >
                            {inbound ? L.directionInbound : L.directionOutbound}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                            {m.subject || L.noSubject}
                          </span>
                          {m.ai_interest && <InterestBadge value={m.ai_interest} labels={L.aiInterestLabels} />}
                        </div>
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-soft">{m.body}</p>
                        <p className="mt-1.5 text-[10px] text-mute">{formatExact(when(m), locale)}</p>
                      </div>
                    );
                  })}
                </div>

                {selected.replyTarget && (
                  <div className="border-t border-edge/60 px-5 py-3.5">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={L.replyPlaceholder}
                      rows={3}
                      className="w-full rounded-lg border border-edge2 bg-field px-3 py-2 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="truncate text-[11px] text-faint">
                        {L.replySubjectPrefix}
                        {selected.replyTarget.subject || L.noSubject}
                      </span>
                      <button
                        onClick={sendReply}
                        disabled={sending || !draft.trim()}
                        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-sky-600/25 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
                      >
                        {sending ? L.replySending : L.replySend}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InterestBadge({ value, labels }: { value: string; labels: Record<string, string> }) {
  const cls =
    value === "interested"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      : value === "not_interested"
      ? "bg-red-500/10 text-red-600 dark:text-red-300"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return (
    <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium " + cls}>
      {labels[value] ?? value}
    </span>
  );
}
