"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "./language-provider";
import { useToast } from "./toast-provider";
import { useWorkspace } from "./workspace-provider";

const MAX_WORKSPACES = 20;

export default function WorkspaceSwitcher({ className = "" }: { className?: string }) {
  const { t } = useT();
  const { push } = useToast();
  const router = useRouter();
  const { workspaceId, workspaceName, workspaces, switchWorkspace } = useWorkspace();
  const W = t.workspace;

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setRenamingId(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function createWorkspace() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const { data, error } = await supabase
      .from("workspaces")
      .insert({ owner_id: user.id, name })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      push(W.createError + (error?.message ?? ""), "error");
      return;
    }
    setNewName("");
    setCreating(false);
    setOpen(false);
    switchWorkspace(data.id);
  }

  async function renameWorkspace(id: string) {
    const name = renameValue.trim();
    if (!name || busy) return;
    setBusy(true);
    const { error } = await createClient().from("workspaces").update({ name }).eq("id", id);
    setBusy(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    setRenamingId(null);
    router.refresh();
  }

  async function deleteWorkspace(id: string, name: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (workspaces.length <= 1) {
      push(W.cannotDeleteLast, "error");
      return;
    }
    if (!confirm(W.deleteConfirm(name))) return;
    setBusy(true);
    const { error } = await createClient().from("workspaces").delete().eq("id", id);
    setBusy(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(W.deleted, "success");
    if (id === workspaceId) {
      const next = workspaces.find((w) => w.id !== id);
      if (next) switchWorkspace(next.id);
    } else {
      router.refresh();
    }
  }

  return (
    <div className={"relative " + className} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-2.5 rounded-lg bg-panel px-3 text-left text-sm text-ink shadow-sm ring-1 ring-edge/70 transition-[box-shadow,transform] hover:ring-edge2 active:scale-[0.99]"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-b from-sky-400 to-sky-600 text-2xs font-bold text-white shadow-sm">
          {workspaceName.slice(0, 1).toUpperCase() || "?"}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{workspaceName}</span>
        <svg className="h-3.5 w-3.5 shrink-0 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="pop-in absolute left-0 top-full z-30 mt-2 w-full min-w-64 origin-top rounded-xl border border-edge/70 bg-panel p-1.5 shadow-xl">
          <p className="px-2 pb-1 pt-1 text-2xs font-medium uppercase tracking-wide text-mute">
            {W.switcherLabel}
          </p>
          <div className="max-h-64 overflow-y-auto">
            {workspaces.map((w) => (
              <div
                key={w.id}
                className={
                  "group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors " +
                  (w.id === workspaceId ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "text-soft hover:bg-wash")
                }
              >
                {renamingId === w.id ? (
                  <span className="flex flex-1 items-center gap-1.5">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && renameWorkspace(w.id)}
                      className="w-full min-w-0 rounded-md border border-edge2 bg-field px-2 py-1 text-sm text-ink outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={() => renameWorkspace(w.id)}
                      className="shrink-0 text-xs font-medium text-sky-600 hover:text-sky-500 dark:text-sky-300"
                    >
                      {t.common.save}
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (w.id !== workspaceId) switchWorkspace(w.id);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate text-left"
                    >
                      {w.name}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(w.id);
                        setRenameValue(w.name);
                      }}
                      title={W.rename}
                      className="hidden shrink-0 text-faint hover:text-ink group-hover:block"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => deleteWorkspace(w.id, w.name, e)}
                      title={t.common.delete}
                      className="hidden shrink-0 text-faint hover:text-red-500 group-hover:block"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-1 border-t border-edge/70 pt-1">
            {creating ? (
              <div className="flex items-center gap-1.5 px-1 py-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createWorkspace()}
                  placeholder={W.newWorkspaceNamePlaceholder}
                  className="w-full min-w-0 rounded-md border border-edge2 bg-field px-2 py-1.5 text-sm text-ink outline-none focus:border-sky-500"
                />
                <button
                  onClick={createWorkspace}
                  disabled={!newName.trim() || busy}
                  className="shrink-0 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {W.create}
                </button>
              </div>
            ) : (
              workspaces.length < MAX_WORKSPACES && (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-faint transition-colors hover:bg-wash hover:text-sky-600 dark:hover:text-sky-400"
                >
                  + {W.newWorkspace}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
