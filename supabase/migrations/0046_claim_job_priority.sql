-- Job-Priorisierung: eine gerade gestartete Suche darf nicht hinter der
-- Anreicherung warten.
--
-- Bisher sortierte claim_job() rein nach run_at (FIFO). Praktische Folge: wer
-- eine neue Suche startet, landet hinter allen bereits eingereihten
-- personalize-/find_decisionmaker-Jobs -- und das sind pro gefundener Firma
-- gleich mehrere OpenAI-Aufrufe à 10-30 Sekunden. Real gemessen: 88 wartende
-- Jobs vor einer frisch gestarteten Suche, also ~20-30 Minuten, in denen die
-- Oberflaeche nur "Suche laeuft" anzeigt und nichts passiert.
--
-- get_businesses ist der Job, auf dessen Ergebnis jemand aktiv wartet und der
-- ueberhaupt erst Arbeit erzeugt; die Anreicherung darf im Hintergrund
-- nachlaufen. Innerhalb derselben Prioritaet bleibt es bei FIFO (run_at),
-- damit sich an der Reihenfolge sonst nichts aendert.
create or replace function public.claim_job(p_worker text)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
declare j_id uuid;
begin
  select id into j_id from public.jobs
   where status = 'pending' and run_at <= now()
   order by case when type = 'get_businesses' then 0 else 1 end, run_at
   for update skip locked
   limit 1;
  if j_id is null then return; end if;
  update public.jobs
     set status = 'running', locked_at = now(), locked_by = p_worker, attempts = attempts + 1
   where id = j_id;
  return query select * from public.jobs where id = j_id;
end $$;
revoke execute on function public.claim_job(text) from public, anon, authenticated;
