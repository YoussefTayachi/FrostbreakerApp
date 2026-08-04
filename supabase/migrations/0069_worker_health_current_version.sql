-- Der Betriebszustand zaehlt nur noch die aktuelle Fassung.
--
-- Youssef sah am 2026-08-04 auf dem Dashboard "Nur 4 von 6 Arbeitsprozessen
-- antworten". Railway betreibt zwei Replicas. Sechs waren es nie.
--
-- Der Stand in dem Moment:
--
--   46e28b6e5a2f  d896b3c  vor 20 Sekunden    lebendig
--   51d46aed515c  d896b3c  vor 21 Sekunden    lebendig
--   6bc2c67f7cb2  75cd088  vor 1,5 Minuten    lebendig
--   6b77a20ecc84  75cd088  vor 1,5 Minuten    lebendig
--   84ab4e1ba8e9  042b89d  vor 16 Minuten     tot
--   8ff5973143d8  042b89d  vor 16 Minuten     tot
--
-- Drei Generationen desselben Zweier-Gespanns, entstanden durch drei
-- Deployments innerhalb einer Stunde. 0060 hatte die Anhaeufung bereits
-- erkannt und ein Zeitfenster von einer Stunde dagegen gesetzt -- zu lang.
-- An einem Nachmittag mit mehreren Deployments stehen darin immer zwei bis
-- drei Generationen, und die aeltere ist per Definition tot. Die Warnung war
-- also nicht falsch konfiguriert, sondern misst die falsche Sache: sie
-- fragte "wer war zuletzt hier", wo sie "wer soll jetzt laufen" fragen muss.
--
-- Die Antwort steht bereits in der Tabelle: worker_heartbeat.version haelt
-- den Git-Stand fest. Railway betreibt N Replicas EINER Fassung -- wer auf
-- einer aelteren laeuft, ist nicht ausgefallen, sondern ersetzt worden. Also
-- zaehlt ab hier ausschliesslich die Fassung, von der das letzte
-- Lebenszeichen kam.
--
-- Waehrend eines rollenden Deployments sind kurz beide Fassungen da; dann
-- zaehlt die neue, und die alte verschwindet aus der Betrachtung, statt als
-- vermisst gemeldet zu werden. Stirbt dagegen eine Replica der aktuellen
-- Fassung, meldet sich "1 von 2" -- und das ist genau der Fall, fuer den es
-- diese Warnung gibt.
--
-- Das Zeitfenster von einer Stunde bleibt als zweite Schranke stehen: sind
-- alle Instanzen der aktuellen Fassung seit Stunden still, soll nicht die
-- kleine Notiz "eine antwortet nicht" erscheinen, sondern ueber any_alive
-- der harte Alarm "es laeuft nichts".
create or replace function public.worker_health()
returns jsonb language sql stable security definer set search_path = public as $$
  with current_version as (
    select h.version from public.worker_heartbeat h
    order by h.last_seen_at desc
    limit 1
  ),
  recent as (
    select h.* from public.worker_heartbeat h, current_version c
    -- is not distinct from: eine Fassung ohne Versionsangabe (aeltere Worker,
    -- lokale Laeufe) soll sich mit ihresgleichen vergleichen und nicht durch
    -- das Nullwert-Verhalten von "=" komplett aus der Zaehlung fallen.
    where h.version is not distinct from c.version
      and h.last_seen_at > now() - interval '1 hour'
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

/**
 * Ersetzte Instanzen frueher wegraeumen.
 *
 * 0060 loeschte nach einem Tag, mit der Begruendung, ein Wochenendausfall
 * solle als "war mal da" sichtbar bleiben. Diese Begruendung ist mit der
 * Aenderung oben hinfaellig: worker_health schaut nur noch auf die aktuelle
 * Fassung, die alten Zeilen hat damit niemand mehr als Leser. Nach 32 Zeilen
 * aus zwei Tagen ist absehbar, worauf das sonst hinauslaeuft.
 *
 * Eine Fassung, die seit einer Stunde schweigt UND nicht die neueste ist,
 * kommt nicht zurueck -- Railway vergibt beim naechsten Start ohnehin eine
 * neue Kennung. Die aktuelle Fassung bleibt unangetastet, auch wenn sie
 * still ist: genau die soll ja als vermisst auffallen.
 */
create or replace function public.worker_ping(p_worker text, p_version text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.worker_heartbeat (worker, last_seen_at, version)
  values (p_worker, now(), p_version)
  on conflict (worker) do update
    set last_seen_at = now(), version = excluded.version;

  delete from public.worker_heartbeat
   where last_seen_at < now() - interval '1 hour'
     and version is distinct from p_version;
end $$;
revoke execute on function public.worker_ping(text, text) from public, anon, authenticated;
