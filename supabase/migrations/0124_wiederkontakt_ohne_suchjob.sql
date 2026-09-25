-- Wiederkontakt- und Historie-Listen sind keine Suchen.
--
-- Der Trigger on_search_created (Migration 0004) legt fuer jede neue Zeile
-- in searches einen get_businesses-Job an, ausser bei 'csv'. Die Listen aus
-- Migration 0123 ('reengage', 'instantly_history') entstehen fertig befuellt;
-- ein Suchjob darauf haette Firmen gesucht und Credits verbraucht. Am
-- 2026-09-25 stand genau so ein Job fuer "Instantly-Historie" in der Queue und
-- wurde von Hand abgebrochen, bevor der Worker ihn abholte.
create or replace function public.enqueue_search_job()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.source in ('csv', 'reengage', 'instantly_history') then
    return new;
  end if;
  insert into public.jobs (workspace_id, type, payload)
  values (new.workspace_id, 'get_businesses', jsonb_build_object('search_id', new.id, 'auto_enrich', true));
  return new;
end $function$;
