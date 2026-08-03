import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import PipelineView from "./pipeline-view";
import type { PipelineRow } from "./types";

/**
 * Pipeline ueber contacts.outreach_status -- bewusst ohne eigene Tabelle: die
 * Pipeline existiert seit Migration 0018, ihr fehlte nur die Ansicht.
 * Deal-Werte und Forecast leben getrennt davon in public.deals (Migration
 * 0034), weil ein Deal etwas anderes ist als der Kontaktstatus.
 *
 * Die Daten kommen aus der RPC pipeline_rows (Migration 0061) statt aus einem
 * direkten Select. Grund: die Ansicht braucht je Kontakt auch "wann und
 * worueber zuletzt Kontakt bestand" und "was steht als naechstes an" -- beides
 * Aggregate ueber activities und messages. Einzeln abgefragt waeren das bei
 * tausend Kontakten zweitausend Rundreisen.
 *
 * Die Sperrliste wird hier NICHT mehr angewendet (vorher lief filterSuppressed
 * darueber). In einer Pipeline ist das falsch: seit der Inbox-Sync eine
 * Abmeldung automatisch eintraegt, waere ein Kontakt in dem Moment aus dem
 * Trichter verschwunden, in dem er "stop" schreibt -- statt als "kein
 * Interesse" sichtbar zu bleiben. Und eine gesperrte Domain haette einen
 * bereits gewonnenen Kunden mitgenommen. Die Sperrliste gehoert vor den
 * Versand (api/instantly/campaigns filtert dort weiterhin), nicht vor die
 * Anzeige des eigenen Trichters.
 */
export default async function PipelinePage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;

  const { data, error } = await supabase.rpc("pipeline_rows", {
    p_workspace_id: ws.workspace.id,
    p_limit: 1000,
  });

  // Fehler melden statt als leere Pipeline auszugeben -- eine kaputte Abfrage
  // und "noch keine Kontakte" sehen sonst identisch aus. Genau dieser
  // Unterschied liess in Session 3 eine leere Kampagnenliste wie den
  // Normalzustand aussehen.
  if (error) {
    return (
      <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        {t.common.error + error.message}
      </p>
    );
  }

  const rows = (data ?? []) as PipelineRow[];

  // Bewusst ohne space-y-*: die Ansichten setzen ihre Abstaende selbst, damit
  // die Board-Hoehe (100vh minus Kopfbereich) verlaesslich aufgeht.
  return (
    <div className="fade-up">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.pipeline.title}</h1>
        <p className="text-sm text-faint">{t.pipeline.subtitle}</p>
      </div>
      <PipelineView rows={rows} />
    </div>
  );
}
