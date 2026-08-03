-- Lebenszeichen des Workers.
--
-- Der Worker laeuft auf Railway (siehe docs/BETRIEB.md) und ist von aussen
-- unsichtbar: kein Port, keine Oberflaeche. Faellt er aus -- abgelaufenes
-- Guthaben, fehlgeschlagenes Deployment, Absturz -- merkt das niemand. Jobs
-- werden weiter eingereiht, nur nicht mehr abgeholt, und in der App sieht
-- eine gestartete Suche exakt so aus wie eine laufende. Real absehbar: das
-- Railway-Guthaben ist ein Trial und laeuft um den 2026-08-13 aus.
--
-- Eine einzelne Tabelle mit einer Zeile pro Worker-Instanz. Bewusst NICHT an
-- workspaces oder jobs angehaengt: der Worker ist eine Betriebsressource
-- ueber alle Workspaces hinweg, und ein Herzschlag darf nicht davon abhaengen,
-- dass ueberhaupt Arbeit da ist.
create table public.worker_heartbeat (
  -- Ein Wert pro laufender Instanz. Railway faehrt aktuell 2 Replicas; jede
  -- meldet sich unter ihrem eigenen Namen, damit "eine von zwei ist tot"
  -- sichtbar wird statt sich hinter der lebenden zu verstecken.
  worker text primary key,
  last_seen_at timestamptz not null default now(),
  -- Zur Einordnung im Fehlerfall: welche Fassung meldet sich hier?
  version text
);

alter table public.worker_heartbeat enable row level security;

-- Lesen darf jeder angemeldete Nutzer: der Betriebszustand des Workers ist
-- keine Workspace-Information, sondern betrifft alle gleichermassen. Schreiben
-- darf nur der Worker selbst (Service-Role umgeht RLS).
create policy worker_heartbeat_read on public.worker_heartbeat
  for select using (auth.uid() is not null);

/**
 * Herzschlag setzen. Als Funktion statt als direktes Upsert, damit der Worker
 * nur ein Ausfuehrungsrecht braucht und nicht Schreibrecht auf der Tabelle.
 */
create or replace function public.worker_ping(p_worker text, p_version text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.worker_heartbeat (worker, last_seen_at, version)
  values (p_worker, now(), p_version)
  on conflict (worker) do update
    set last_seen_at = now(), version = excluded.version;
$$;
revoke execute on function public.worker_ping(text, text) from public, anon, authenticated;

/**
 * Betriebszustand fuer das Dashboard: lebt der Worker, und stockt die
 * Warteschlange?
 *
 * Die Schwelle liegt bei 2 Minuten. Der Worker pollt alle 5 Sekunden und
 * meldet sich seltener (siehe worker/main.py); 2 Minuten sind grosszuegig
 * genug, um einen laufenden Neustart nicht als Ausfall zu melden, und eng
 * genug, um einen echten Ausfall am selben Vormittag zu bemerken.
 *
 * pending_overdue zaehlt nur Jobs, die tatsaechlich schon faellig waren --
 * ein Job mit run_at in der Zukunft (Backoff nach einem Fehlversuch) ist kein
 * Stau, sondern Absicht.
 */
create or replace function public.worker_health()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'worker', h.worker,
        'last_seen_at', h.last_seen_at,
        'version', h.version,
        'alive', h.last_seen_at > now() - interval '2 minutes'
      ) order by h.worker)
      from public.worker_heartbeat h
    ), '[]'::jsonb),
    'any_alive', exists (
      select 1 from public.worker_heartbeat h
      where h.last_seen_at > now() - interval '2 minutes'
    ),
    -- Nie gemeldet: entweder laeuft eine Fassung ohne Herzschlag, oder es lief
    -- noch nie einer. Beides soll anders aussehen als "tot".
    'ever_seen', exists (select 1 from public.worker_heartbeat),
    'pending_overdue', (
      select count(*) from public.jobs
      where status = 'pending' and run_at <= now()
    ),
    'failed_24h', (
      select count(*) from public.jobs
      where status = 'failed' and created_at > now() - interval '24 hours'
    )
  )
  where auth.uid() is not null;
$$;
revoke execute on function public.worker_health() from public, anon;
grant execute on function public.worker_health() to authenticated;
