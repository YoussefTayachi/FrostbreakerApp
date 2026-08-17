import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WORKSPACE_COOKIE, type WorkspaceSummary } from "./shared";

export { WORKSPACE_COOKIE };
export type { WorkspaceSummary };

/**
 * Alle Workspaces des eingeloggten Users, aeltester zuerst (= der beim Signup
 * automatisch angelegte Standard-Workspace). Row Level Security sorgt dafuer,
 * dass hier ausschliesslich Workspaces auftauchen, die dem User gehoeren.
 */
export async function listWorkspaces(supabase: SupabaseClient): Promise<WorkspaceSummary[]> {
  const { data } = await supabase
    .from("workspaces")
    .select("id, name")
    .order("created_at", { ascending: true });
  return data ?? [];
}

/**
 * Ermittelt den aktuell ausgewaehlten Workspace fuer diesen Request.
 *
 * Ein Account kann mehrere Workspaces besitzen (z.B. eine Agentur mit einem
 * Workspace pro Endkunde). Welcher davon gerade "aktiv" ist, steuert
 * ausschliesslich das thaw_ws-Cookie, RLS entscheidet nur ueber den Zugriff auf
 * fremde Accounts, nicht darueber, welcher der *eigenen* Workspaces gemeint ist.
 *
 * WICHTIG fuer neue Queries: jede Abfrage gegen eine workspace-gebundene Tabelle
 * (searches, businesses, contacts, api_keys, ...) muss zusaetzlich explizit nach
 * `.eq("workspace_id", workspace.id)` filtern. Ohne diesen Filter liefert RLS
 * Zeilen aus ALLEN Workspaces des Users zurueck, nicht nur aus dem aktuell
 * ausgewaehlten.
 *
 * Gibt null zurueck, wenn der User (noch) keinen Workspace hat; sollte durch
 * den Signup-Trigger (handle_new_user) praktisch nie vorkommen.
 */
export async function getCurrentWorkspace(
  supabase: SupabaseClient
): Promise<{ workspace: WorkspaceSummary; workspaces: WorkspaceSummary[] } | null> {
  const workspaces = await listWorkspaces(supabase);
  if (workspaces.length === 0) return null;

  const cookieStore = await cookies();
  const selectedId = cookieStore.get(WORKSPACE_COOKIE)?.value;
  const workspace = workspaces.find((w) => w.id === selectedId) ?? workspaces[0];
  return { workspace, workspaces };
}
