"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseInput } from "@/lib/blocklist";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

type Row = { id: string; email: string | null; domain: string | null; reason: string };

export default function BlocklistPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId: wsId } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function reload() {
    const { data } = await createClient()
      .from("suppression_list")
      .select("id,email,domain,reason")
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: false })
      .limit(2000);
    setRows(data ?? []);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  async function addEntries(text: string) {
    const { emails, domains } = parseInput(text);
    if (emails.length === 0 && domains.length === 0) {
      push(t.blocklist.noValidEntries, "error");
      return;
    }
    const supabase = createClient();
    const rowsToInsert = [
      ...emails.map((email) => ({ workspace_id: wsId, email, reason: "manual" })),
      ...domains.map((domain) => ({ workspace_id: wsId, domain, reason: "manual" })),
    ];
    for (let i = 0; i < rowsToInsert.length; i += 500) {
      await supabase
        .from("suppression_list")
        .upsert(rowsToInsert.slice(i, i + 500), { onConflict: "workspace_id,email", ignoreDuplicates: true });
    }
    push(t.blocklist.blockedSummary(emails.length, domains.length), "success");
    setInput("");
    reload();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addEntries(String(reader.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  }

  async function remove(id: string) {
    // Die Sperrliste kennt kein Soft-Delete. Fuer "Rueckgaengig" wird die Zeile
    // deshalb vor dem Loeschen gemerkt und bei Bedarf neu angelegt (neue id).
    const removed = rows.find((x) => x.id === id);
    await createClient().from("suppression_list").delete().eq("id", id).eq("workspace_id", wsId);
    setRows((r) => r.filter((x) => x.id !== id));
    setSelected((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (!removed) return;
    push(t.blocklist.removed, "success", {
      label: t.blocklist.undo,
      onClick: async () => {
        await createClient().from("suppression_list").insert({
          workspace_id: wsId,
          email: removed.email,
          domain: removed.domain,
          reason: removed.reason,
        });
        reload();
      },
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function removeSelected() {
    if (selected.size === 0) return;
    if (!confirm(t.blocklist.removeSelectedConfirm(selected.size))) return;
    const ids = [...selected];
    const removedRows = rows.filter((r) => selected.has(r.id));
    await createClient().from("suppression_list").delete().in("id", ids).eq("workspace_id", wsId);
    setRows((r) => r.filter((x) => !selected.has(x.id)));
    setSelected(new Set());
    push(t.blocklist.removedMultiple(removedRows.length), "success", {
      label: t.blocklist.undo,
      onClick: async () => {
        await createClient()
          .from("suppression_list")
          .insert(removedRows.map((r) => ({ workspace_id: wsId, email: r.email, domain: r.domain, reason: r.reason })));
        reload();
      },
    });
  }

  return (
    <div className="fade-up max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.blocklist.title}</h1>
        <p className="text-sm text-faint">{t.blocklist.subtitle}</p>
      </div>

      <div className="rounded-lg border border-edge/60 bg-panel p-6">
        <h2 className="mb-1 font-medium text-ink">{t.blocklist.addHeading}</h2>
        <p className="mb-3 text-xs text-faint">
          {t.blocklist.addHint1} <span className="text-soft">kunde-gmbh.de</span>{t.blocklist.addHint2}
        </p>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          placeholder={t.blocklist.textareaPlaceholder}
          className="w-full rounded-lg border border-edge2 bg-field px-3 py-2 font-mono text-sm text-ink placeholder-mute outline-none focus:border-sky-500"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => addEntries(input)}
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-surface shadow-sm transition-all hover:opacity-85 active:scale-[0.98]"
          >
            {t.blocklist.block}
          </button>
          <label className="cursor-pointer rounded-lg border border-edge2 px-4 py-2 text-sm text-soft transition-colors hover:border-edge3 hover:text-ink">
            {t.blocklist.uploadCsv}
            <input type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-edge/60 bg-panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-edge/60 px-5 py-3">
          <h2 className="text-sm font-medium text-ink">{t.blocklist.entries(rows.length)}</h2>
          {rows.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-soft" title={t.blocklist.selectAll}>
              <input
                type="checkbox"
                checked={selected.size === rows.length}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length;
                }}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded accent-sky-500"
              />
              {t.blocklist.selectAll}
            </label>
          )}
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-faint">{t.blocklist.selectedCount(selected.size)}</span>
              <button
                onClick={removeSelected}
                className="text-xs font-medium text-red-600 transition-colors hover:text-red-500 dark:text-red-400"
              >
                {t.blocklist.removeSelected}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-faint hover:text-ink">
                {t.blocklist.deselect}
              </button>
            </div>
          )}
        </div>
        <div className="max-h-96 divide-y divide-edge/60 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-2">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggleOne(r.id)}
                className="h-3.5 w-3.5 shrink-0 rounded accent-sky-500"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-soft">
                {r.email ?? r.domain}
              </span>
              <span className="rounded-full border border-edge2 bg-chip px-2 py-0.5 text-[11px] text-faint">
                {r.email ? t.blocklist.emailBadge : t.blocklist.domainBadge}
              </span>
              <button
                onClick={() => remove(r.id)}
                className="text-xs text-mute transition-colors hover:text-red-600 dark:hover:text-red-600 dark:text-red-400"
              >
                {t.blocklist.remove}
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-faint">{t.blocklist.noEntries}</p>
          )}
        </div>
      </div>
    </div>
  );
}
