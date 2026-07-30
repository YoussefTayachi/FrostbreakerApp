-- Verwaiste Jobs wieder einsammeln.
--
-- claim_job() setzt einen Job auf 'running' und markiert ihn mit locked_at/
-- locked_by. Stirbt der Worker danach -- Absturz, Neustart, Redeploy des
-- Containers -- bleibt der Job fuer immer auf 'running'. Kein Mechanismus hat
-- ihn je zurueckgeholt: die Queue holt sich nur 'pending', der Backoff in
-- fail_job() greift nur, wenn der Worker den Fehler ueberhaupt noch melden
-- konnte. Real beobachtet: zwei Jobs 12,5 Minuten auf 'running', beide
-- innerhalb derselben Sekunde gesperrt, danach nie wieder angefasst -- die
-- Leads dahinter blieben stillschweigend liegen.
--
-- Deshalb raeumt claim_job() jetzt vor jedem Claim auf: Jobs, die zu lange
-- 'running' sind, gelten als verwaist und gehen zurueck in die Warteschlange
-- (bzw. auf 'failed', wenn ihre Versuche aufgebraucht sind -- sonst haetten
-- sie eine Endlosschleife).
--
-- 15 Minuten sind bewusst grosszuegig: find_decisionmaker macht eine
-- OpenAI-Websuche mit bis zu drei tenacity-Versuchen und exponentiellem
-- Backoff. Ein noch echt arbeitender Job soll auf keinen Fall ein zweites Mal
-- gestartet werden, das wuerde Kosten verdoppeln.
create or replace function public.claim_job(p_worker text)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
declare j_id uuid;
begin
  update public.jobs
     set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
         last_error = 'Worker hat den Job nicht abgeschlossen (Absturz oder Neustart) -- nach Zeitueberschreitung wieder eingesammelt'
   where status = 'running'
     and locked_at is not null
     and locked_at < now() - interval '15 minutes';

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
