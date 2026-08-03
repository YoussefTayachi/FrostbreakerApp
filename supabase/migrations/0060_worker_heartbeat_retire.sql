-- Ausrangierte Worker altern aus.
--
-- Fehler in 0058, aufgefallen beim ersten echten Durchlauf: worker_health()
-- zaehlte JEDE je gesehene Zeile als Arbeitsprozess, der zu antworten hat.
-- Das geht nicht auf, weil die Kennung der Hostname des Containers ist -- und
-- Railway vergibt bei jedem Deployment neue Container. Gemessen nach einem
-- einzigen Deployment standen dort bereits drei Zeilen:
--
--   ecdc7968b2c0   lebendig   (Railway, aktuelle Fassung)
--   f359688d7293   lebendig   (Railway, zweite Replica)
--   DESKTOP-5L0U19K  tot      (Entwicklungsrechner, s.u.)
--
-- Ohne Alterung sammelt sich pro Deployment ein weiterer "toter" Worker an.
-- Der Hinweis "nur 2 von 5 Arbeitsprozessen antworten" waere binnen einer
-- Woche Dauerzustand -- also genau die Sorte Fehlalarm, die dazu erzieht,
-- Warnungen zu ignorieren. Damit haette sich die Warnung aus 0058 selbst
-- entwertet.
--
-- Die dritte Zeile hatte eine eigene Ursache: die Worker-Tests rufen main()
-- auf und ersetzen claim_job/sleep durch Attrappen, den neuen Herzschlag aber
-- nicht -- damit schrieben sie in die Produktionsdatenbank. Das ist im Test
-- selbst behoben (tests/test_main_loop.py), die Alterung hier faengt es
-- zusaetzlich ab.

/**
 * Herzschlag setzen und dabei ausrangierte Instanzen wegraeumen.
 *
 * Einen Tag: lang genug, dass ein Wochenendausfall noch als "war mal da"
 * sichtbar bleibt, kurz genug, dass sich Container-Kennungen nicht anhaeufen.
 * Das Aufraeumen laeuft beim Schreiben mit, damit es keinen zweiten
 * Mechanismus (Cron) braucht, der selbst ausfallen kann.
 */
create or replace function public.worker_ping(p_worker text, p_version text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.worker_heartbeat (worker, last_seen_at, version)
  values (p_worker, now(), p_version)
  on conflict (worker) do update
    set last_seen_at = now(), version = excluded.version;

  delete from public.worker_heartbeat
   where last_seen_at < now() - interval '1 day';
end $$;
revoke execute on function public.worker_ping(text, text) from public, anon, authenticated;

/**
 * Betriebszustand, jetzt nur ueber die zuletzt aktiven Instanzen.
 *
 * Das Zeitfenster von einer Stunde beantwortet die Frage "wer soll hier
 * ueberhaupt laufen": eine Instanz, die seit einer Stunde schweigt, ist beim
 * naechsten Deployment ersetzt worden und wird nicht vermisst. Eine, die vor
 * fuenf Minuten noch da war, schon.
 *
 * any_alive bleibt die eigentliche Aussage (laeuft ueberhaupt etwas), die
 * Einzelaufstellung ist nur die Begruendung dazu.
 */
create or replace function public.worker_health()
returns jsonb language sql stable security definer set search_path = public as $$
  with recent as (
    select * from public.worker_heartbeat
    where last_seen_at > now() - interval '1 hour'
  )
  select jsonb_build_object(
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'worker', r.worker,
        'last_seen_at', r.last_seen_at,
        'version', r.version,
        'alive', r.last_seen_at > now() - interval '2 minutes'
      ) order by r.worker)
      from recent r
    ), '[]'::jsonb),
    'any_alive', exists (
      select 1 from recent r where r.last_seen_at > now() - interval '2 minutes'
    ),
    -- Absichtlich ueber die volle Tabelle, nicht ueber "recent": nach einem
    -- Ausfall ueber Nacht waeren alle Zeilen aelter als eine Stunde, und
    -- "noch nie gesehen" wuerde die Warnung genau dann abschalten, wenn sie
    -- gebraucht wird.
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
