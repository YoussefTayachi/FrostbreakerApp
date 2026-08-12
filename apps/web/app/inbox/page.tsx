"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { filterSuppressed } from "@/lib/suppression";
import { formatRelative } from "@/lib/format-time";
import { notifyUnreadChanged } from "@/lib/unread";
import CompanyLogo from "../company-logo";
import ContactTimeline from "../crm/contact-timeline";
import StatusSelect from "../crm/status-select";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

type Msg = {
  id: string;
  contact_id: string | null;
  from_email: string | null;
  eaccount: string | null;
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
    business_id: string | null;
    businesses: { name: string; website: string | null } | null;
  } | null;
};

// Feldnamen email/businesses sind so gewaehlt, dass filterSuppressed() direkt auf
// Konversationen anwendbar bleibt (gleiche Blockliste wie in der Leads-Ansicht --
// sonst taucht eine geblockte Firma hier weiter auf, obwohl sie dort verschwunden ist).
//
// contactId ist nullable: seit die Inbox mailbox-weit synct statt nur
// kampagnen-gebundene Antworten, kommen auch Mails von Absendern ohne
// bestehenden Kontakt an (kein Auto-Anlegen als Lead, siehe poll_instantly.py
// _process_email). `key` ist der stabile Gruppierungs-/State-Schluessel, der in
// beiden Faellen existiert (contact_id oder Absenderadresse).
type Conversation = {
  key: string;
  contactId: string | null;
  businessId: string | null;
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

type Filter = "all" | "unread" | "interested" | "question" | "out_of_office" | "not_interested";

const REFRESH_INTERVAL_MS = 30_000;

function when(msg: Msg): string {
  return msg.sent_at ?? msg.created_at;
}

function toConversations(messages: Msg[]): Conversation[] {
  const byKey = new Map<string, Conversation>();
  for (const m of messages) {
    // Ohne Kontakt gruppiert die rohe Absenderadresse (from_email) statt einer
    // contact_id -- so landen mehrere Mails derselben unbekannten Adresse in
    // einer Konversation, statt jede einzeln zu zeigen.
    const key = m.contact_id ?? "raw:" + (m.from_email ?? m.id);
    let c = byKey.get(key);
    if (!c) {
      c = {
        key,
        contactId: m.contact_id,
        businessId: m.contacts?.business_id ?? null,
        name: m.contacts?.full_name ?? null,
        title: m.contacts?.title ?? null,
        email: m.contacts?.email ?? m.from_email ?? null,
        businesses: m.contacts?.businesses ?? null,
        outreachStatus: m.contacts?.outreach_status ?? "new",
        messages: [],
        lastAt: null,
        unread: 0,
        aiInterest: null,
        replyTarget: null,
      };
      byKey.set(key, c);
    }
    c.messages.push(m);
  }

  const conversations = [...byKey.values()];
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

  const [messages, setMessages] = useState<Msg[]>([]);
  const [suppression, setSuppression] = useState<{ email: string | null; domain: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /**
   * Die Antwortentwuerfe.
   *
   * Auf Klick geholt, nicht beim Oeffnen: jeder Aufruf kostet Geld, und die
   * meisten Antworten schreibt man in zehn Sekunden selbst. Der Assistent ist
   * fuer die, bei denen man ins Gruebeln kommt -- und genau die bleiben sonst
   * liegen.
   */
  const [suggestions, setSuggestions] = useState<{ label: string; text: string }[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const supabase = createClient();
    const spalten =
      "id, contact_id, from_email, eaccount, direction, subject, body, ai_interest, sent_at, created_at, read_at, instantly_email_id, " +
      "contacts(id, full_name, email, title, outreach_status, business_id, businesses(name, website))";
    const [msgRes, ungelesenRes, supRes] = await Promise.all([
      supabase
        .from("messages")
        .select(spalten)
        .eq("workspace_id", workspaceId)
        .order("sent_at", { ascending: false })
        .limit(1000),
      /**
       * Ungelesene Eingaenge zusaetzlich und ohne Fenster.
       *
       * Das Badge in der Seitenleiste zaehlt serverseitig ueber ALLE
       * Nachrichten, die Liste hier laedt nur die neuesten 1000. Am
       * Produktivstand nachgemessen (2026-08-12): eine ungelesene Antwort
       * stand auf Platz 2141 von 2782 -- das Badge zeigte sie an, oeffnen
       * liess sie sich nicht. Diese zweite Abfrage holt genau die Zeilen, um
       * die es dabei geht; es sind naturgemaess wenige.
       */
      supabase
        .from("messages")
        .select(spalten)
        .eq("workspace_id", workspaceId)
        .eq("direction", "inbound")
        .is("read_at", null)
        .order("sent_at", { ascending: false })
        .limit(200),
      supabase.from("suppression_list").select("email,domain").eq("workspace_id", workspaceId),
    ]);
    const zusammen = new Map<string, Msg>();
    for (const m of [...(msgRes.data ?? []), ...(ungelesenRes.data ?? [])] as unknown as Msg[]) {
      zusammen.set(m.id, m);
    }
    setMessages([...zusammen.values()]);
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
    () => conversations.find((c) => c.key === selectedId) ?? null,
    [conversations, selectedId]
  );

  async function markRead(key: string) {
    const ids = conversations
      .find((c) => c.key === key)
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

  /**
   * Status direkt aus dem Posteingang setzen.
   *
   * Optimistisch, wie markRead darueber: die Auswahl soll sofort stehen. Der
   * Status-Trigger aus Migration 0032 schreibt die Bewegung ohnehin in den
   * Verlauf, der rechts danebensteht -- ein Neuladen waere also nur eine
   * Verzoegerung ohne zusaetzliche Aussage.
   */
  async function setStatus(conversation: Conversation, next: string) {
    const contactId = conversation.contactId;
    if (!contactId || next === conversation.outreachStatus) return;

    setMessages((prev) =>
      prev.map((m) =>
        m.contacts?.id === contactId
          ? { ...m, contacts: { ...m.contacts, outreach_status: next } }
          : m
      )
    );

    const { error } = await createClient()
      .from("contacts")
      .update({ outreach_status: next })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);

    if (error) push(t.common.error + error.message, "error");
    else push(t.crm.activityStatusSynced(t.leads.statusLabels[next] ?? next), "success");
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
    setSelectedId(c.key);
    setDraft("");
    // Entwuerfe gehoeren zu genau einem Gespraech. Stehen sie beim naechsten
    // noch da, schickt man mit einem Klick die Antwort auf eine fremde Mail.
    setSuggestions(null);
    if (c.unread > 0) markRead(c.key);
  }

  async function suggestReply() {
    const target = selected?.replyTarget;
    if (!target || suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/inbox/suggest-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: target.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || L.suggestError);
      setSuggestions(data.suggestions);
    } catch (e) {
      push((e as Error).message, "error");
    } finally {
      setSuggesting(false);
    }
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
    // Vor "kein Interesse": eine Abwesenheitsnotiz ist keine Absage, sondern
    // ein spaeterer Versuch. Die Reihenfolge der Reiter soll das abbilden.
    { id: "out_of_office", label: L.aiInterestLabels.out_of_office },
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
                const active = c.key === selectedId;
                const title = c.businesses?.name ?? c.name ?? c.email ?? L.unknownContact;
                return (
                  <button
                    key={c.key}
                    onClick={() => select(c)}
                    className={
                      "flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors " +
                      (active ? "bg-wash" : "hover:bg-wash/60")
                    }
                  >
                    <span className="relative mt-0.5">
                      <CompanyLogo name={c.businesses?.name ?? c.name ?? c.email ?? "?"} website={c.businesses?.website ?? null} size={26} />
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
                          {title}
                        </span>
                        <span className="shrink-0 text-[10px] text-faint">{formatRelative(c.lastAt, lang)}</span>
                      </span>
                      {/* Name/E-Mail-Zeile nur, wenn sie etwas anderes als der Titel zeigt --
                          bei kontaktlosen Absendern ist der Titel schon die E-Mail-Adresse.
                          Das KI-Badge bleibt davon unabhaengig sichtbar. */}
                      {((c.name ?? c.email) && (c.name ?? c.email) !== title) || c.aiInterest ? (
                        <span className="mt-0.5 flex items-center gap-1.5">
                          {(c.name ?? c.email) && (c.name ?? c.email) !== title && (
                            <span className="truncate text-xs text-soft">{c.name ?? c.email}</span>
                          )}
                          {c.aiInterest && <InterestBadge value={c.aiInterest} labels={L.aiInterestLabels} />}
                        </span>
                      ) : null}
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
                    name={selected.businesses?.name ?? selected.name ?? selected.email ?? "?"}
                    website={selected.businesses?.website ?? null}
                    size={30}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {selected.businesses?.name ?? selected.name ?? selected.email ?? L.unknownContact}
                    </p>
                    <p className="truncate text-xs text-faint">
                      {[selected.name, selected.title, selected.email].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {/* Status-Badge und Lead-Link brauchen einen echten CRM-Kontakt --
                      bei kontaktlosen Absendern (nur E-Mail bekannt) gibt es beides nicht. */}
                  {selected.contactId && (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {/**
                       * Aenderbar statt nur angezeigt.
                       *
                       * Hier stand eine Anzeige-Plakette. Wer auf eine Antwort
                       * einen Termin ausmachte, musste ihn anschliessend in
                       * /leads oder auf dem Board eintragen -- also die Seite
                       * verlassen, auf der er gerade gearbeitet hat. Am
                       * 2026-08-05 standen bei 741 versendeten Mails 0 Termine,
                       * und die Wirkungs-Ansicht konnte deshalb zu keinem Text
                       * sagen, ob er je zu einem gefuehrt hat.
                       *
                       * Das ist PRODUKTPLAN Saeule 3 in einem Satz: es muss auf
                       * dem Weg liegen, statt ein Ort zu sein, den man extra
                       * aufsucht.
                       */}
                      <StatusSelect
                        value={selected.outreachStatus}
                        labels={t.leads.statusLabels}
                        onChange={(next) => setStatus(selected, next)}
                      />
                      <Link
                        href={`/leads?q=${encodeURIComponent(selected.businesses?.name ?? "")}`}
                        className="text-[11px] text-sky-600 underline-offset-4 hover:underline dark:text-sky-400"
                      >
                        {L.openInLeads}
                      </Link>
                    </div>
                  )}
                </div>

                {/* Voller Verlauf (Notizen, Aktivitaeten, Deals) nur bei echtem CRM-
                    Kontakt -- ohne contact_id gibt es dafuer keine Basis, dann reicht
                    eine einfache Liste der synchronisierten E-Mails. */}
                <div className="flex-1 overflow-y-auto px-5 py-4 md:max-h-[calc(100vh-27rem)]">
                  {selected.contactId ? (
                    <ContactTimeline
                      key={selected.key}
                      contactId={selected.contactId}
                      businessId={selected.businessId ?? undefined}
                    />
                  ) : (
                    <PlainMessageList messages={selected.messages} lang={lang} noSubjectLabel={L.noSubject} />
                  )}
                </div>

                {selected.replyTarget && (
                  <div className="border-t border-edge/60 px-5 py-3.5">
                    {/* Die Entwuerfe stehen UEBER dem Textfeld: sie sind ein
                        Startpunkt, kein Nachschlag. Darunter wuerde man sie
                        erst lesen, nachdem man selbst getippt hat. */}
                    {suggestions && suggestions.length > 0 && (
                      <div className="mb-2.5 space-y-1.5">
                        {suggestions.map((sug, i) => (
                          <button
                            key={i}
                            onClick={() => setDraft(sug.text)}
                            className="block w-full rounded-lg border border-edge2 bg-panel2 px-3 py-2 text-left transition-colors hover:border-sky-500/50"
                          >
                            <span className="text-[11px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
                              {sug.label}
                            </span>
                            <span className="mt-0.5 block whitespace-pre-wrap text-xs leading-relaxed text-soft">
                              {sug.text}
                            </span>
                          </button>
                        ))}
                        <p className="text-[11px] text-mute">{L.suggestHint}</p>
                      </div>
                    )}
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={L.replyPlaceholder}
                      rows={3}
                      className="w-full rounded-lg border border-edge2 bg-field px-3 py-2 text-sm text-ink placeholder-mute outline-none transition-colors focus:border-sky-500"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[11px] text-faint">
                        {L.replySubjectPrefix}
                        {selected.replyTarget.subject || L.noSubject}
                      </span>
                      <button
                        onClick={suggestReply}
                        disabled={suggesting}
                        className="ml-auto shrink-0 rounded-lg border border-edge2 px-3 py-2 text-xs font-medium text-soft transition-colors hover:border-sky-500/50 hover:text-ink disabled:opacity-40"
                      >
                        {suggesting ? L.suggesting : L.suggest}
                      </button>
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

/** Schlichte Alternative zu ContactTimeline fuer Absender ohne CRM-Kontakt --
 *  nur die synchronisierten E-Mails selbst, chronologisch, ohne Notizen/Deals. */
function PlainMessageList({
  messages,
  lang,
  noSubjectLabel,
}: {
  messages: Msg[];
  lang: "de" | "en";
  noSubjectLabel: string;
}) {
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <div key={m.id} className="rounded-lg border border-edge/60 bg-surface/60 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-ink">
              {m.direction === "inbound" ? "→" : "←"} {m.subject || noSubjectLabel}
            </span>
            <span className="shrink-0 text-[10px] text-faint">
              {formatRelative(m.sent_at ?? m.created_at, lang)}
            </span>
          </div>
          {m.eaccount && <p className="mt-0.5 text-[10px] text-faint">{m.eaccount}</p>}
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-soft">{m.body}</p>
        </div>
      ))}
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
