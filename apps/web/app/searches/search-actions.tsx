"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { useWorkspace } from "../workspace-provider";

export function TrashButton({ searchId }: { searchId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  return (
    <button
      title={t.searchActions.trashTitle}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // schedule wird beim Loeschen mit zurueckgesetzt, damit der Worker
        // keine Abo-Suche im Papierkorb weiterlaufen laesst. Beim Rueckgaengig
        // bleibt es deshalb bewusst auf "none": das Abo muss neu gesetzt werden.
        await createClient()
          .from("searches")
          .update({ deleted_at: new Date().toISOString(), schedule: "none" })
          .eq("id", searchId)
          .eq("workspace_id", workspaceId);
        router.refresh();
        push(t.searchActions.trashed, "success", {
          label: t.searchActions.undo,
          onClick: async () => {
            await createClient()
              .from("searches")
              .update({ deleted_at: null })
              .eq("id", searchId)
              .eq("workspace_id", workspaceId);
            router.refresh();
            push(t.searchActions.restored, "success");
          },
        });
      }}
      className="rounded-lg border border-edge/60 px-3 py-2 text-sm text-faint transition-colors hover:border-red-500/50 hover:text-red-600 dark:hover:text-red-600 dark:text-red-400"
    >
      {t.searchActions.delete}
    </button>
  );
}

export function RestoreButton({ searchId }: { searchId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  return (
    <button
      onClick={async () => {
        await createClient()
          .from("searches")
          .update({ deleted_at: null })
          .eq("id", searchId)
          .eq("workspace_id", workspaceId);
        router.refresh();
        push(t.searchActions.restored, "success");
      }}
      className="rounded-lg border border-edge2 px-4 py-2 text-sm text-soft transition-colors hover:border-edge3 hover:text-ink"
    >
      {t.searchActions.restore}
    </button>
  );
}

export function HardDeleteButton({ searchId }: { searchId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  return (
    <button
      onClick={async () => {
        if (!confirm(t.searchActions.hardDeleteConfirm)) return;
        const supabase = createClient();
        await supabase.from("businesses").delete().eq("search_id", searchId).eq("workspace_id", workspaceId);
        await supabase.from("searches").delete().eq("id", searchId).eq("workspace_id", workspaceId);
        router.refresh();
        push(t.searchActions.hardDeleted, "success");
      }}
      className="rounded-lg border border-red-300 dark:border-red-900/60 px-4 py-2 text-sm text-red-600 dark:text-red-400 transition-colors hover:border-red-500 hover:text-red-500 dark:hover:text-red-500 dark:text-red-300"
    >
      {t.searchActions.hardDelete}
    </button>
  );
}
