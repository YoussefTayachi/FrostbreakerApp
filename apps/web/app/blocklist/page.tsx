"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

type Row = { id: string; email: string | null; domain: string | null; reason: string };

function parseInput(text: string): { emails: string[]; domains: string[] } {
  const tokens = text
    .split(/[\n,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const t of tokens) {
    if (t.includes("@")) {
      // CSV-Zeilen wie "Max;max@firma.de;..." -> E-Mail herausfischen
      const match = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (match) emails.add(match[0]);
    } else {
      const d = t.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      if (d.includes(".")) domains.add(d);
    }
  }
  return { emails: [...emails], domains: [...domains] };
}

export default function BlocklistPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId: wsId } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");

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
        <h2 className="border-b border-edge/60 px-5 py-3 text-sm font-medium text-ink">
          {t.blocklist.entries(rows.length)}
        </h2>
        <div className="max-h-96 divide-y divide-edge/60 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-2">
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
