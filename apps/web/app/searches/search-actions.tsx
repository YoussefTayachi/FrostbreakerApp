"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { groupScopeFilter, withChildIds } from "@/lib/search-group";
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
        /**
         * Nachfragen, und zwar mit den Folgen im Text.
         *
         * Ein Kunde hat am 2026-08-10 zum Loeschen gegriffen, weil er
         * aufraeumen wollte — und erst danach gemerkt, dass die Liste damit
         * auch aus LinkedIn und Instantly verschwindet. Was er ueberhaupt
         * nicht sehen konnte: die Firmen der Liste zaehlen danach im
         * Dublettenschutz nicht mehr mit (worker/dedupe.py), jede
         * unkontaktierte ist also wieder einkaufbar — bei Apollo rund zwei
         * Credits pro Lead. Der Knopf hiess "Loeschen" und kostete Geld.
         *
         * Der Dialog nennt beides und weist auf das Archiv hin, das seit
         * Migration 0089 genau fuer diesen Wunsch da ist.
         */
        if (!confirm(t.searchActions.trashConfirm)) return;
        // schedule wird beim Loeschen mit zurueckgesetzt, damit der Worker
        // keine Abo-Suche im Papierkorb weiterlaufen laesst. Beim Rueckgaengig
        // bleibt es deshalb bewusst auf "none": das Abo muss neu gesetzt werden.
        //
        // groupScopeFilter statt .eq("id", …): bei einer gebuendelten
        // Mehrfach-Suche haengen n Teilsuchen an dieser Zeile (Migration 0096).
        // Ohne sie liefen die unsichtbar weiter, waehrend die Gruppe im
        // Papierkorb liegt — inklusive ihrer Abos.
        await createClient()
          .from("searches")
          .update({ deleted_at: new Date().toISOString(), schedule: "none" })
          .or(groupScopeFilter([searchId]))
          .eq("workspace_id", workspaceId);
        router.refresh();
        push(t.searchActions.trashed, "success", {
          label: t.searchActions.undo,
          onClick: async () => {
            await createClient()
              .from("searches")
              .update({ deleted_at: null })
              .or(groupScopeFilter([searchId]))
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

/**
 * Laufende Suche abbrechen.
 *
 * Getrennt vom Loeschen, obwohl beides "weg damit" heisst: der Papierkorb
 * ruehrt den laufenden Job nicht an. Er wuerde weiterlaufen, weiter Credits
 * verbrauchen und am Ende Leads in eine Suche schreiben, die niemand mehr
 * sieht. Genau dieser Fall war der Anlass — 100 statt 10 Leads angeklickt.
 *
 * Der Knopf erscheint nur, solange etwas laeuft; danach gibt es nichts mehr
 * abzubrechen und die Zeile zeigt wieder nur "Löschen".
 */
export function CancelButton({ searchId }: { searchId: string }) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  return (
    <button
      title={t.searchActions.cancelTitle}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(t.searchActions.cancelConfirm)) return;
        const { data, error } = await createClient().rpc("cancel_search", {
          p_search_id: searchId,
        });
        if (error) {
          push(t.common.error + error.message, "error");
          return;
        }
        // false heisst: die Suche war schon fertig, als geklickt wurde. Das
        // ist kein Fehler, aber es waere irrefuehrend, "abgebrochen" zu
        // melden — gleich sieht der Nutzer die fertigen Leads.
        router.refresh();
        push(data ? t.searchActions.cancelled : t.searchActions.cancelTooLate, data ? "success" : "error");
      }}
      className="rounded-lg border border-amber-500/50 px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-500"
    >
      {t.searchActions.cancel}
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
          .or(groupScopeFilter([searchId]))
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
        // Die Firmen haengen an den Teilsuchen, nicht an der Gruppe (Migration
        // 0096) — deren IDs muessen also wirklich vorliegen. Fuer die
        // searches-Zeilen selbst genuegt der Fremdschluessel: parent_search_id
        // loescht mit "on delete cascade".
        const { data: kinder } = await supabase
          .from("searches")
          .select("id, parent_search_id")
          .eq("workspace_id", workspaceId)
          .eq("parent_search_id", searchId);
        const alleIds = withChildIds([searchId], kinder ?? []);
        await supabase.from("businesses").delete().in("search_id", alleIds).eq("workspace_id", workspaceId);
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

/**
 * Papierkorb in einem Zug leeren.
 *
 * Der Einzelknopf pro Zeile ist bei einem gewachsenen Papierkorb unbenutzbar --
 * bei 45 Eintraegen sind das 45 Klicks samt 45 Rueckfragen. Hier laeuft das
 * ueber zwei Abfragen fuer alle Eintraege gleichzeitig.
 *
 * Die IDs kommen vom Server (die Seite kennt den Papierkorb ohnehin schon),
 * statt sie hier erneut zu laden: so loescht der Knopf garantiert genau das,
 * was der Nutzer in der Liste gesehen hat, und nicht etwas, das in der
 * Zwischenzeit dazugekommen ist.
 */
export function EmptyTrashButton({ searchIds }: { searchIds: string[] }) {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  if (searchIds.length === 0) return null;
  return (
    <button
      onClick={async () => {
        // Anzahl in die Rueckfrage: unwiderruflich, und der Unterschied
        // zwischen 3 und 45 Suchen sollte vor dem Klick klar sein.
        if (!confirm(t.searchActions.emptyTrashConfirm(searchIds.length))) return;
        const supabase = createClient();
        // Die Teilsuchen gebuendelter Mehrfach-Suchen stehen nicht in der
        // Papierkorb-Liste (die zeigt nur Gruppen), ihre Firmen muessen aber
        // mit weg — sonst bleiben sie als Waisen ohne Liste stehen.
        const { data: kinder } = await supabase
          .from("searches")
          .select("id, parent_search_id")
          .eq("workspace_id", workspaceId)
          .in("parent_search_id", searchIds);
        const alleIds = withChildIds(searchIds, kinder ?? []);
        // businesses zuerst: haengt an search_id, und ein Abbruch nach dem
        // Loeschen der Suche wuerde sie als Waisen zuruecklassen.
        const { error: bizError } = await supabase
          .from("businesses")
          .delete()
          .in("search_id", alleIds)
          .eq("workspace_id", workspaceId);
        if (bizError) {
          push(t.common.error + bizError.message, "error");
          return;
        }
        const { error } = await supabase
          .from("searches")
          .delete()
          .in("id", searchIds)
          .eq("workspace_id", workspaceId);
        if (error) {
          push(t.common.error + error.message, "error");
          return;
        }
        router.refresh();
        push(t.searchActions.emptyTrashDone(searchIds.length), "success");
      }}
      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600 transition-colors hover:border-red-500 hover:text-red-500 dark:border-red-900/60 dark:text-red-400 dark:hover:text-red-500"
    >
      {t.searchActions.emptyTrash(searchIds.length)}
    </button>
  );
}
