import { formatDateTime } from "@/lib/format-time";
import type { Dictionary } from "@/lib/i18n/dict";
import type { Lang } from "@/lib/i18n/lang";

/**
 * Warnung, wenn der Worker nicht mehr lebt (Migration 0058).
 *
 * Der Worker laeuft auf Railway und ist von aussen unsichtbar. Faellt er aus,
 * werden Jobs weiter eingereiht und nur nicht mehr abgeholt — eine gestartete
 * Suche sieht in der App dann exakt so aus wie eine laufende, dauerhaft.
 * Genau das ist am 2026-08-13 zu erwarten, wenn das Railway-Guthaben ausläuft.
 *
 * ABSICHTLICH STUMM IM NORMALFALL. Ein Dashboard, das bei jedem Aufruf "alles
 * in Ordnung" meldet, erzieht dazu, Banner zu ueberlesen — und dann wird auch
 * der eine ernste ueberlesen. Angezeigt wird nur:
 *
 *   - der Worker hat sich schon einmal gemeldet, meldet sich aber nicht mehr
 *   - oder er lebt, aber die Warteschlange staut sich trotzdem
 *
 * Der Fall "hat sich noch nie gemeldet" loest bewusst KEINEN Alarm aus: kurz
 * nach dem Ausrollen dieser Aenderung ist das der Normalzustand, bis der
 * Worker das erste Mal pingt. Ein Fehlalarm in der ersten Minute wuerde die
 * Warnung sofort entwerten.
 */

export type WorkerHealth = {
  workers: { worker: string; last_seen_at: string; version: string | null; alive: boolean }[];
  any_alive: boolean;
  ever_seen: boolean;
  pending_overdue: number;
  failed_24h: number;
};

// Ab wann ist ein Rueckstau ein Rueckstau? Ein paar wartende Jobs sind der
// Normalfall, waehrend der Worker sie abarbeitet — bei einer frisch
// gestarteten Suche stehen sofort dutzende in der Reihe. Erst eine dreistellige
// Zahl bei lebendem Worker deutet auf ein echtes Problem hin.
const BACKLOG_THRESHOLD = 100;

/** Offener Guthaben-Alarm eines Anbieters (Migration 0059). */
export type ProviderAlert = {
  provider: string;
  message: string | null;
  first_seen_at: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  google_maps: "Google Maps",
  apollo: "Apollo",
  hunter: "Hunter",
  openai: "OpenAI",
  neverbounce: "NeverBounce",
};

/**
 * Aufgebrauchtes Guthaben. Steht ueber dem Worker-Status, weil es die
 * konkretere Ursache ist: ein Worker kann tadellos laufen und trotzdem nichts
 * zustandebringen, wenn das Konto beim Anbieter leer ist.
 *
 * Kein Wegklicken-Knopf: der Alarm loest sich von selbst auf, sobald derselbe
 * Anbieter wieder erfolgreich antwortet (siehe resolve_provider_alert). Eine
 * Warnung, die man von Hand wegraeumen kann, wird weggeraeumt statt behoben.
 */
export function ProviderAlerts({ alerts, t, lang }: { alerts: ProviderAlert[]; t: Dictionary; lang: Lang }) {
  if (alerts.length === 0) return null;
  const A = t.providerAlerts;
  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div key={alert.provider} className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {A.title(PROVIDER_LABELS[alert.provider] ?? alert.provider)}
          </p>
          <p className="mt-0.5 text-xs text-soft">{A.body}</p>
          <p className="mt-1.5 text-[11px] text-faint">
            {A.since(formatDateTime(alert.first_seen_at, lang))}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function WorkerStatus({
  health,
  t,
  lang,
}: {
  health: WorkerHealth | null;
  t: Dictionary;
  lang: Lang;
}) {
  if (!health) return null;
  const W = t.workerStatus;

  const down = health.ever_seen && !health.any_alive;
  const backlog = health.any_alive && health.pending_overdue >= BACKLOG_THRESHOLD;
  // Einzelne tote Instanz bei mehreren: die Arbeit laeuft weiter, aber
  // langsamer — eine Notiz wert, kein Alarm.
  const partial = health.any_alive && health.workers.some((w) => !w.alive);

  if (!down && !backlog && !partial) return null;

  const lastSeen = health.workers
    .map((w) => w.last_seen_at)
    .sort()
    .pop();

  if (down) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{W.downTitle}</p>
        <p className="mt-0.5 text-xs text-soft">{W.downBody}</p>
        <p className="mt-1.5 text-[11px] text-faint">
          {lastSeen && W.lastSeen(formatDateTime(lastSeen, lang))}
          {health.pending_overdue > 0 && ` · ${W.pendingWaiting(health.pending_overdue)}`}
        </p>
      </div>
    );
  }

  if (backlog) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">{W.backlogTitle}</p>
        <p className="mt-0.5 text-xs text-soft">{W.backlogBody(health.pending_overdue)}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
      <p className="text-xs text-amber-700 dark:text-amber-400">
        {W.partial(health.workers.filter((w) => w.alive).length, health.workers.length)}
      </p>
    </div>
  );
}
