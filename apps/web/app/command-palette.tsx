"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  IconAgent,
  IconDashboard,
  IconInbox,
  IconLeads,
  IconPipeline,
  IconSearch,
  IconSettings,
  IconShield,
} from "./icons";
import { useT } from "./language-provider";
import { useWorkspace } from "./workspace-provider";

type BizResult = { id: string; name: string };

export function CommandPaletteTrigger() {
  const { t } = useT();
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className="mb-3 flex items-center gap-2.5 rounded-lg border border-edge/60 bg-panel px-3 py-2 text-left text-sm text-faint transition-colors hover:border-edge2 hover:text-ink"
    >
      <IconSearch className="h-4 w-4 shrink-0" />
      <span className="flex-1">{t.commandPalette.triggerLabel}</span>
      <kbd className="rounded border border-edge2 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
    </button>
  );
}

export default function CommandPalette() {
  const router = useRouter();
  const { t } = useT();
  const { workspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BizResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const items = [
    { href: "/", label: t.nav.dashboard, icon: IconDashboard },
    { href: "/searches", label: t.nav.searches, icon: IconSearch },
    { href: "/leads", label: t.nav.leads, icon: IconLeads },
    { href: "/pipeline", label: t.nav.pipeline, icon: IconPipeline },
    { href: "/inbox", label: t.nav.inbox, icon: IconInbox },
    { href: "/ai-agent", label: t.nav.aiAgent, icon: IconAgent },
    { href: "/blocklist", label: t.nav.blocklist, icon: IconShield },
    { href: "/settings", label: t.nav.settings, icon: IconSettings },
  ];

  const matchedItems = items.filter((i) =>
    i.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  const showBusinesses = query.trim().length >= 2;
  const entries = [
    ...matchedItems.map((i) => ({ key: `page-${i.href}`, goTo: () => goTo(i.href) })),
    ...(showBusinesses
      ? results.map((r) => ({ key: `biz-${r.id}`, goTo: () => goTo(`/leads?q=${encodeURIComponent(r.name)}`) }))
      : []),
  ];

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
  }, []);

  // Aktive Auswahl zuruecksetzen, sobald sich die Trefferliste aendert (neue
  // Eingabe oder neue Firmen-Ergebnisse), sonst zeigt der Pfeiltasten-Fokus
  // irgendwann auf einen Index, der gar nicht mehr existiert.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, results]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onOpenEvent);
    };
  }, [close]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      const { data } = await createClient()
        .from("businesses")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .ilike("name", `%${term}%`)
        .limit(6);
      setResults(data ?? []);
      setLoading(false);
    }, 250);
    return () => window.clearTimeout(debounceRef.current);
  }, [query, workspaceId]);

  if (!open) return null;

  function goTo(href: string) {
    close();
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onClick={close}>
      <div
        className="fade-up w-full max-w-lg overflow-hidden rounded-xl border border-edge/60 bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-edge/60 px-4 py-3">
          <IconSearch className="h-4 w-4 shrink-0 text-mute" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (entries.length > 0) setActiveIndex((i) => (i + 1) % entries.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (entries.length > 0) setActiveIndex((i) => (i - 1 + entries.length) % entries.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                entries[activeIndex]?.goTo();
              }
            }}
            placeholder={t.commandPalette.placeholder}
            className="w-full bg-transparent text-sm text-ink placeholder-mute outline-none"
          />
          <kbd className="shrink-0 rounded border border-edge2 px-1.5 py-0.5 text-[10px] text-faint">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-mute">
            {t.commandPalette.pagesHeading}
          </p>
          {matchedItems.map(({ href, label, icon: Icon }, i) => (
            <button
              key={href}
              onClick={() => goTo(href)}
              onMouseEnter={() => setActiveIndex(i)}
              className={
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-ink transition-colors " +
                (i === activeIndex ? "bg-wash" : "hover:bg-wash")
              }
            >
              <Icon className="h-4 w-4 text-faint" />
              {label}
            </button>
          ))}
          {matchedItems.length === 0 && (
            <p className="px-3 py-2 text-sm text-faint">{t.commandPalette.noResults}</p>
          )}

          {query.trim().length >= 2 && (
            <>
              <p className="mt-2 px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-mute">
                {t.commandPalette.companiesHeading}
              </p>
              {loading && <p className="px-3 py-2 text-sm text-faint">{t.commandPalette.searching}</p>}
              {!loading &&
                results.map((r, i) => {
                  const entryIndex = matchedItems.length + i;
                  return (
                    <button
                      key={r.id}
                      onClick={() => goTo(`/leads?q=${encodeURIComponent(r.name)}`)}
                      onMouseEnter={() => setActiveIndex(entryIndex)}
                      className={
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-ink transition-colors " +
                        (entryIndex === activeIndex ? "bg-wash" : "hover:bg-wash")
                      }
                    >
                      <IconLeads className="h-4 w-4 text-faint" />
                      <span className="truncate">{r.name}</span>
                    </button>
                  );
                })}
              {!loading && results.length === 0 && (
                <p className="px-3 py-2 text-sm text-faint">{t.commandPalette.noResults}</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5 border-t border-edge/60 px-4 py-2 text-[11px] text-faint">
          <span>{t.commandPalette.hint}</span>
          <kbd className="rounded border border-edge2 px-1.5 py-0.5">⌘</kbd>
          <kbd className="rounded border border-edge2 px-1.5 py-0.5">K</kbd>
        </div>
      </div>
    </div>
  );
}
