import crypto from "crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { desiredReplicas, RUHE_NACH_MINUTEN, SCALE_DEFAULTS } from "@/lib/worker-scale";

/**
 * Worker-Betrieb im Minutentakt (Migration 0110): Skalieren und Wachen.
 *
 * 1. SKALIEREN. Die Railway-Replikzahl folgt der Queue-Tiefe
 *    (lib/worker-scale.ts). Ohne die drei RAILWAY_*-Variablen unten laeuft
 *    die Route trotzdem und ueberspringt nur diesen Teil, damit der
 *    Waechter nicht am Fehlen eines API-Tokens haengt.
 *
 * 2. WACHEN. Zwei Pruefungen gegen stille Ausfaelle, beide mit gemessenem
 *    Anlass vom 2026-08-31:
 *      - Browser-Fehlerquote: die zweite Pruefstufe lief vom Einbau bis zum
 *        2026-08-31 in Produktion NIE (Playwright fehlte im Docker-Image).
 *        Niemand hat es gemerkt, weil measure() jeden Fehler faengt und als
 *        Messergebnis speichert: der Queue-Job gilt als erledigt. 128 von
 *        143 Messungen trugen "No module named 'playwright'".
 *      - Haengende Jobs: zwei OpenAI-Aufrufe ohne Timeout hielten beide
 *        Repliken 6 bis 8 Minuten fest; erst die 15-Minuten-Rueckholung der
 *        Queue (Migration 0047) hat sie befreit.
 *    Gemeldet wird ueber provider_alerts: dieselbe Strecke, die auch
 *    Guthaben- und Zustellbarkeits-Alarme nimmt (Entdoppelung ueber den
 *    Unique-Index auf workspace_id+provider, Mailversand durch
 *    instantly-sync, sichtbar im Dashboard). Aufgeloest wird automatisch,
 *    sobald der Zustand wieder gesund ist, wie bei domain_broken.
 */
export const maxDuration = 30;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  // Laengen zuerst: timingSafeEqual wirft bei unterschiedlicher Laenge.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Railways oeffentliche GraphQL-API. Dokumentiert unter
 * https://docs.railway.com/reference/public-api; die drei Aufrufe hier
 * (Replikzahl lesen, setzen, ausrollen) sind beim Einrichten einmal von Hand
 * zu pruefen, bevor man ihnen den Betrieb ueberlaesst -- siehe
 * docs/BETRIEB.md, Abschnitt "Worker-Skalierung".
 */
const RAILWAY_GQL = "https://backboard.railway.app/graphql/v2";

async function railwayGraphql(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<{ data?: Record<string, unknown>; errors?: unknown }> {
  const res = await fetch(RAILWAY_GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json().catch(() => ({ errors: `HTTP ${res.status}` }))) as {
    data?: Record<string, unknown>;
    errors?: unknown;
  };
}

type QueueLage = { faellig: number; laufend: number; minutenStill: number };

async function queueLage(supabase: SupabaseClient): Promise<QueueLage> {
  const jetzt = new Date().toISOString();
  // Zurueckgestellte Jobs (run_at in der Zukunft, z.B. geparkte
  // personalize-Jobs) zaehlen bewusst nicht: sie sollen keine sechs
  // Repliken wecken.
  const { count: faellig } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("run_at", jetzt);
  const { count: laufend } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "running");
  // Juengstes Lebenszeichen der Queue: entweder wurde zuletzt ein Job
  // gesperrt (gearbeitet) oder einer angelegt (Arbeit kommt).
  const { data: letzte } = await supabase
    .from("jobs")
    .select("created_at, locked_at")
    .order("created_at", { ascending: false })
    .limit(1);
  const { data: letzteSperre } = await supabase
    .from("jobs")
    .select("locked_at")
    .not("locked_at", "is", null)
    .order("locked_at", { ascending: false })
    .limit(1);
  const kandidaten = [letzte?.[0]?.created_at, letzteSperre?.[0]?.locked_at]
    .filter(Boolean)
    .map((t) => new Date(t as string).getTime());
  const minutenStill = kandidaten.length
    ? Math.floor((Date.now() - Math.max(...kandidaten)) / 60_000)
    : RUHE_NACH_MINUTEN;
  return { faellig: faellig ?? 0, laufend: laufend ?? 0, minutenStill };
}

type ScaleErgebnis = {
  uebersprungen?: string;
  aktuell?: number;
  ziel?: number;
  geaendert?: boolean;
  fehler?: unknown;
};

async function skaliere(lage: QueueLage, lebendigeWorker: number): Promise<ScaleErgebnis> {
  const token = process.env.RAILWAY_API_TOKEN;
  const serviceId = process.env.RAILWAY_WORKER_SERVICE_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!token || !serviceId || !environmentId) {
    return { uebersprungen: "RAILWAY_API_TOKEN / RAILWAY_WORKER_SERVICE_ID / RAILWAY_ENVIRONMENT_ID nicht gesetzt" };
  }

  const limits = {
    max: Number(process.env.WORKER_SCALE_MAX ?? SCALE_DEFAULTS.max),
    ruhe: Number(process.env.WORKER_SCALE_IDLE ?? SCALE_DEFAULTS.ruhe),
    burstAb: Number(process.env.WORKER_SCALE_BURST_AT ?? SCALE_DEFAULTS.burstAb),
  };
  const ziel = desiredReplicas(
    { faellig: lage.faellig, laufend: lage.laufend, minutenSeitLetzterAktivitaet: lage.minutenStill },
    limits
  );

  const gelesen = await railwayGraphql(
    token,
    `query($serviceId: String!, $environmentId: String!) {
       serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { numReplicas }
     }`,
    { serviceId, environmentId }
  );
  if (gelesen.errors) return { ziel, fehler: gelesen.errors };
  const instanz = gelesen.data?.serviceInstance as { numReplicas?: number } | undefined;
  const aktuell = instanz?.numReplicas ?? 0;
  if (aktuell === ziel) {
    // EINSTELLUNG UND WIRKLICHKEIT KOENNEN AUSEINANDERLAUFEN. Gemessen beim
    // Limit-Test am 2026-08-31: ein Git-Push mitten im Burst erzeugte ein
    // neues Deployment, dessen Build VOR dem Hochschalten begonnen hatte.
    // Es kam mit 2 Instanzen hoch, obwohl die Einstellung 6 sagte, und
    // diese Funktion sah "6 = 6" und tat nichts. Die eigene Wahrheit steht
    // in worker_heartbeat (Migration 0058): melden sich deutlich weniger
    // Worker als das Ziel, wird ausgerollt, damit die Einstellung wirkt.
    // Schwelle: WENIGER ALS DIE HAELFTE des Ziels. Absichtlich grob, denn
    // direkt nach einem Redeploy sind die neuen Herzschlaege noch nicht da
    // (Takt 30 s), und eine engere Schwelle wuerde im naechsten Minutentakt
    // erneut ausrollen, eine Schleife aus Neustarts. Bei 6 gewollten und 2
    // tatsaechlichen Workern (der gemessene Fall) feuert sie; bei 6
    // gewollten und 4 gerade hochkommenden schweigt sie.
    if (ziel > 1 && lebendigeWorker < Math.ceil(ziel / 2)) {
      const ausgerollt = await railwayGraphql(
        token,
        `mutation($serviceId: String!, $environmentId: String!) {
           serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
         }`,
        { serviceId, environmentId }
      );
      if (ausgerollt.errors) return { aktuell, ziel, fehler: ausgerollt.errors };
      return { aktuell, ziel, geaendert: true };
    }
    return { aktuell, ziel, geaendert: false };
  }

  // Jede Aenderung loest ein Redeploy des Services aus, laufende Jobs auf
  // den alten Repliken fallen in die 15-Minuten-Rueckholung (Migration
  // 0047) und werden neu verteilt. Deshalb aendert die Logik in
  // worker-scale.ts die Zahl nur an Batch-Grenzen, nie mitten im Takt.
  const gesetzt = await railwayGraphql(
    token,
    `mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
       serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
     }`,
    { serviceId, environmentId, input: { numReplicas: ziel } }
  );
  if (gesetzt.errors) return { aktuell, ziel, fehler: gesetzt.errors };
  const ausgerollt = await railwayGraphql(
    token,
    `mutation($serviceId: String!, $environmentId: String!) {
       serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
     }`,
    { serviceId, environmentId }
  );
  if (ausgerollt.errors) return { aktuell, ziel, fehler: ausgerollt.errors };
  return { aktuell, ziel, geaendert: true };
}

/** Ab dieser Quote gilt die Browser-Stufe als ausgefallen. Bewusst hoch:
 *  einzelne tote Websites und Bot-Sperren sind normal (gemessen ~10 bis 20
 *  Prozent), ein Modul- oder Imagefehler trifft dagegen JEDE Messung. */
const BROWSER_FEHLERQUOTE_ALARM = 0.5;
const BROWSER_MINDESTMENGE = 10;

/** Laenger als so viele Minuten in 'running' heisst haengend. Die Queue holt
 *  nach 15 Minuten zurueck; wer regelmaessig auch nur in die Naehe kommt,
 *  blockiert Repliken. */
const HAENGEND_AB_MINUTEN = 20;

async function wache(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const ergebnis: Record<string, unknown> = {};

  // 1. Browser-Fehlerquote je Workspace, letzte 24 Stunden.
  const seit = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: messungen } = await supabase
    .from("businesses")
    .select("workspace_id, website_audit_browser_status")
    .gte("website_audit_browser_at", seit)
    .limit(5000);
  const proWorkspace = new Map<string, { n: number; kaputt: number }>();
  for (const m of messungen ?? []) {
    const eintrag = proWorkspace.get(m.workspace_id as string) ?? { n: 0, kaputt: 0 };
    eintrag.n += 1;
    if (m.website_audit_browser_status === "failed") eintrag.kaputt += 1;
    proWorkspace.set(m.workspace_id as string, eintrag);
  }
  const browserAlarme: string[] = [];
  for (const [workspaceId, { n, kaputt }] of proWorkspace) {
    const quote = kaputt / n;
    if (n >= BROWSER_MINDESTMENGE && quote >= BROWSER_FEHLERQUOTE_ALARM) {
      browserAlarme.push(workspaceId);
      await supabase.from("provider_alerts").upsert(
        {
          workspace_id: workspaceId,
          provider: "worker-browser",
          kind: "worker_stufe",
          message:
            `${kaputt} von ${n} Browser-Messungen der letzten 24 Stunden sind fehlgeschlagen. ` +
            `Die Website-Befunde entstehen derweil nur aus dem rohen HTML.`,
        },
        { onConflict: "workspace_id,provider" }
      );
    } else {
      // Wieder gesund: von allein aufloesen, wie bei domain_broken.
      await supabase
        .from("provider_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("provider", "worker-browser")
        .is("resolved_at", null);
    }
  }
  ergebnis.browser_alarme = browserAlarme.length;

  // 2. Haengende Jobs.
  const grenze = new Date(Date.now() - HAENGEND_AB_MINUTEN * 60_000).toISOString();
  const { data: haengend } = await supabase
    .from("jobs")
    .select("id, workspace_id, type, locked_at")
    .eq("status", "running")
    .lt("locked_at", grenze)
    .limit(20);
  const jeWorkspace = new Map<string, string[]>();
  for (const j of haengend ?? []) {
    const liste = jeWorkspace.get(j.workspace_id as string) ?? [];
    liste.push(j.type as string);
    jeWorkspace.set(j.workspace_id as string, liste);
  }
  for (const [workspaceId, typen] of jeWorkspace) {
    await supabase.from("provider_alerts").upsert(
      {
        workspace_id: workspaceId,
        provider: "worker-queue",
        kind: "worker_stufe",
        message:
          `${typen.length} Job(s) haengen seit ueber ${HAENGEND_AB_MINUTEN} Minuten in 'running' ` +
          `(${[...new Set(typen)].join(", ")}). Die 15-Minuten-Rueckholung scheint nicht zu greifen.`,
      },
      { onConflict: "workspace_id,provider" }
    );
  }
  if ((haengend ?? []).length === 0) {
    await supabase
      .from("provider_alerts")
      .update({ resolved_at: new Date().toISOString() })
      .eq("provider", "worker-queue")
      .is("resolved_at", null);
  }
  ergebnis.haengende_jobs = (haengend ?? []).length;

  return ergebnis;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createServiceClient();
  const lage = await queueLage(supabase);
  // Wie viele Worker sich in den letzten zwei Minuten gemeldet haben; die
  // Schwelle spiegelt worker_health() (Migration 0058).
  const { count: lebendige } = await supabase
    .from("worker_heartbeat")
    .select("worker", { count: "exact", head: true })
    .gte("last_seen_at", new Date(Date.now() - 2 * 60_000).toISOString());
  const [skalierung, waechter] = await Promise.all([
    skaliere(lage, lebendige ?? 0),
    wache(supabase),
  ]);
  return NextResponse.json({ lage, lebendige_worker: lebendige ?? 0, skalierung, waechter });
}
