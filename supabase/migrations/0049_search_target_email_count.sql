-- Ziel-Anzahl an Leads MIT gefundener E-Mail, getrennt von max_results (der
-- tatsaechlich abgefragten Rohzahl an Firmen).
--
-- Hintergrund: die KI-Websuche findet bei gemessenen ~22% der Firmen
-- ueberhaupt eine E-Mail (siehe Kommentar in worker/pipelines/get_businesses.py).
-- Bisher musste man das selbst hochrechnen (fuer 20 E-Mails ca. 100 Firmen
-- suchen). new-search-form.tsx fragt jetzt direkt nach der gewuenschten
-- E-Mail-Zahl (gedeckelt bei 20 -- mehr ist bei 100 Firmen/Suche und ~20%
-- Trefferquote nicht zuverlaessig erreichbar) und rechnet max_results daraus
-- hoch. Diese Spalte speichert nur, was der Nutzer wollte, fuer Anzeige/
-- Reporting -- am eigentlichen Suchablauf (get_businesses.py liest weiterhin
-- ausschliesslich max_results) aendert sich nichts.
--
-- NULL fuer Suchen von vor diesem Feature (direkte Rohzahl-Eingabe, keine
-- Zielangabe vorhanden).
alter table public.searches add column target_email_count integer
  check (target_email_count is null or target_email_count between 1 and 20);

-- search_overview() (zuletzt 0045) gibt die neue Spalte mit aus, damit die
-- Suchliste "X von Ziel Y" anzeigen kann, statt sie separat nachzuladen.
drop function if exists public.search_overview(uuid);
create or replace function public.search_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id))
select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
from (
  select s.id, coalesce(s.name, s.query) as name, s.query, s.location, s.source, s.status,
    s.error, s.max_results, s.target_email_count, s.created_at, s.schedule, s.next_run_at,
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
