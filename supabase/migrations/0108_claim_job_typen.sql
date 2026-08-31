-- EIGENE SPUREN JE JOBTYP
--
-- Bisher gab es eine Schlange fuer alles, und das hat am 2026-08-31 messbar
-- wehgetan: 200 browser_check-Jobs standen ueber eine Stunde hinter 240
-- find_decisionmaker-Jobs (je 50 bis 60 Sekunden OpenAI-Websuche), obwohl
-- die Messungen selbst nur ~25 Minuten Arbeit waren. claim_job nimmt jetzt
-- optional eine Liste von Jobtypen: ein Worker, der nur bestimmte Typen
-- faehrt (Env WORKER_JOB_TYPES, siehe apps/worker/worker/main.py), laesst
-- die uebrigen fuer andere liegen.
--
-- Ohne p_types verhaelt sich die Funktion exakt wie bisher. Die alte
-- Ein-Parameter-Fassung wird ersetzt statt ueberladen: zwei Fassungen
-- nebeneinander waeren fuer PostgREST-RPC-Aufrufe mit benannten Argumenten
-- mehrdeutig. Ein alter Worker, der waehrend des Deployments noch
-- {p_worker} ohne p_types schickt, trifft die neue Fassung, der Default
-- fuellt auf.
--
-- Das Wiedereinsammeln haengengebliebener Jobs (Migration 0047) bleibt
-- absichtlich UNGEFILTERT: jeder Worker darf jeden haengenden Job
-- zuruecklegen, sonst raeumt eine reine Browser-Replik nie einen
-- haengengebliebenen Recherche-Job auf.

drop function if exists public.claim_job(text);

create or replace function public.claim_job(p_worker text, p_types text[] default null)
 returns setof jobs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
     and (p_types is null or type = any(p_types))
   order by case when type = 'get_businesses' then 0 else 1 end, run_at
   for update skip locked
   limit 1;
  if j_id is null then return; end if;
  update public.jobs
     set status = 'running', locked_at = now(), locked_by = p_worker, attempts = attempts + 1
   where id = j_id;
  return query select * from public.jobs where id = j_id;
end $function$;
