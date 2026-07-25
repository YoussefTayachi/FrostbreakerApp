import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { filterSuppressed } from "@/lib/suppression";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import PipelineBoard, { type BoardContact } from "./pipeline-board";

/**
 * Kanban ueber contacts.outreach_status -- bewusst ohne eigene Tabelle: die
 * Pipeline existiert seit Migration 0018, ihr fehlte nur die Ansicht. Deal-Werte
 * und Forecast leben getrennt davon in public.deals (Migration 0034), weil ein
 * Deal etwas anderes ist als der Kontaktstatus.
 *
 * Server-Component wie /leads: laedt einmal und uebergibt an die Client-Komponente,
 * die dann nur noch Status-Updates schreibt.
 */
export default async function PipelinePage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  const [contactsRes, suppressionRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, full_name, title, email, outreach_status, business_id, businesses(name, website)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("suppression_list").select("email,domain").eq("workspace_id", workspaceId),
  ]);

  // Cast an der Vertrauensgrenze: der Supabase-Client ist untypisiert, und bei
  // verschachtelten Selects leitet er eine 1:1-Relation als Array her. Gleiches
  // Vorgehen wie im Dashboard (page.tsx) und in der Inbox.
  const rows = (contactsRes.data ?? []) as unknown as BoardContact[];
  const contacts = filterSuppressed(rows, suppressionRes.data ?? []);

  return (
    <div className="fade-up space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.pipeline.title}</h1>
        <p className="text-sm text-faint">{t.pipeline.subtitle}</p>
      </div>
      <PipelineBoard contacts={contacts} />
    </div>
  );
}
