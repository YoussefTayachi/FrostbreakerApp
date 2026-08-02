-- Eine Suche kann erfolgreich durchlaufen und trotzdem nichts liefern. Bisher
-- stand dann nur "fertig, 0 Leads" da, ohne jeden Anhaltspunkt woran es lag --
-- der Nutzer musste raten, welcher der sechs Apollo-Filter zu eng war. Am
-- 2026-08-02 lief so eine 300-Lead-Suche leer, weil ein Technologie-Slug bei
-- Apollo gar nicht existierte; Apollo meldet so etwas nicht als Fehler.
--
-- Bewusst eine eigene Spalte statt searches.error: error bedeutet "die Suche
-- ist fehlgeschlagen" und wird im Frontend rot als Fehlschlag gezeigt. Eine
-- erfolgreich abgeschlossene Suche mit einer Fehlermeldung darin waere
-- irrefuehrend fuer jeden, der die Zeile liest (siehe auch den Kommentar in
-- get_businesses.run, der error beim Neustart genau deshalb zuruecksetzt).
-- note heisst dagegen "durchgelaufen, aber es gibt etwas zu sagen".
alter table public.searches add column if not exists note text;

-- search_overview() muss die neue Spalte mit ausgeben, sonst bleibt sie im
-- Frontend unsichtbar -- derselbe Fehler wie seinerzeit bei error (0045).
drop function if exists public.search_overview(uuid);
create or replace function public.search_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id))
select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
from (
  select s.id, coalesce(s.name, s.query) as name, s.query, s.location, s.source, s.status,
    s.error, s.note, s.max_results, s.target_email_count, s.created_at, s.schedule, s.next_run_at,
    (select count(*) from public.businesses b where b.search_id = s.id) as businesses,
    (select count(*) from public.businesses b where b.search_id = s.id
       and b.decisionmaker_status not in ('pending','running')) as businesses_done,
    (select count(*) from public.contacts c join public.businesses b on b.id = c.business_id
       where b.search_id = s.id) as contacts,
    (select count(*) from public.contacts c join public.businesses b on b.id = c.business_id
       where b.search_id = s.id and c.email is not null) as with_email
  from public.searches s, ws
  where s.workspace_id = ws.id and s.deleted_at is null
) t;
$$;
revoke execute on function public.search_overview(uuid) from public, anon;
grant execute on function public.search_overview(uuid) to authenticated;
