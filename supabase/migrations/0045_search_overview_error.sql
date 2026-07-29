-- searches.error existiert seit der ersten Migration, wurde von
-- search_overview() aber nie mit ausgegeben -- eine fehlgeschlagene Suche
-- zeigte im Frontend nur ein generisches "Fehlgeschlagen" ohne Grund. Wird
-- jetzt gebraucht, um z.B. Hunters neuen DiscoverPaginationError (Free-Plan
-- erlaubt kein Blaettern ueber die erste Ergebnisseite hinaus) sichtbar zu
-- machen statt ihn stillschweigend im DB-Feld verschwinden zu lassen.
drop function if exists public.search_overview(uuid);
create or replace function public.search_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id))
select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
from (
  select s.id, coalesce(s.name, s.query) as name, s.query, s.location, s.source, s.status,
    s.error, s.max_results, s.created_at, s.schedule, s.next_run_at,
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
