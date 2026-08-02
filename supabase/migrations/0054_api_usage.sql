-- Echte Erfassung der API-Kosten statt einer Hochrechnung.
--
-- Bisher entstand die Zahl auf dem Dashboard ausschliesslich aus Job-Zaehlern
-- (estimateCosts() in app/page.tsx): Anzahl Geocode-Jobs mal Preis, Anzahl
-- Personalisierungs-Jobs mal Preis. Das hatte drei Probleme:
--   * Apollo und NeverBounce tauchten gar nicht auf, obwohl beide Geld kosten
--   * "140 Hunter-Credits" war schlicht die Anzahl erledigter hunt_persons-Jobs,
--     nicht der tatsaechliche Verbrauch
--   * ein Job, der zwei OpenAI-Aufrufe brauchte (Korrektur-Versuch), zaehlte
--     wie einer
--
-- Deshalb schreibt jetzt jeder kostenpflichtige Aufruf eine Zeile.
--
-- units statt nur cost_usd, weil die Anbieter in unterschiedlichen Einheiten
-- abrechnen: Apollo in Credits, NeverBounce in Pruefungen, OpenAI in Tokens.
-- Der Euro-Betrag ist daraus abgeleitet und kann sich mit den Tarifen aendern
-- -- die gemessene Menge bleibt richtig, auch wenn ein Preis veraltet.
-- cost_usd darf deshalb NULL sein: lieber "so viele Credits, Preis unbekannt"
-- als eine erfundene Zahl.
create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('openai','hunter','apollo','neverbounce','google_maps')),
  -- Welcher Aufruf, z.B. 'bulk_match', 'personalize', 'verify'. Frei gehalten:
  -- eine Aufzaehlung muesste bei jedem neuen Aufruf per Migration wachsen.
  operation text not null,
  units numeric not null default 0,
  unit_kind text not null check (unit_kind in ('credits','checks','tokens','requests')),
  cost_usd numeric,
  -- Zuordnung zur Suche, damit sich spaeter "was hat diese Liste gekostet"
  -- beantworten laesst. Bleibt NULL bei Aufrufen ausserhalb einer Suche.
  search_id uuid references public.searches(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Die Kostenseite fragt immer nach Workspace und Zeitraum.
create index if not exists api_usage_workspace_created_idx
  on public.api_usage (workspace_id, created_at desc);

alter table public.api_usage enable row level security;

drop policy if exists api_usage_owner on public.api_usage;
create policy api_usage_owner on public.api_usage
  for all using (public.is_workspace_owner(workspace_id));

-- Aufschluesselung pro Anbieter fuer einen Zeitraum. Als Funktion statt als
-- Abfrage im Frontend, damit Dashboard-Kachel und Kostenseite garantiert
-- dieselbe Summe zeigen.
create or replace function public.api_usage_summary(
  p_workspace_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)),
gefiltert as (
  select u.*
  from public.api_usage u, ws
  where u.workspace_id = ws.id
    and (p_from is null or u.created_at >= p_from)
    and (p_to is null or u.created_at < p_to)
),
-- Erst pro Einheit buendeln: ein Anbieter kann in mehreren Einheiten
-- abrechnen (OpenAI in Tokens, dazu perspektivisch Requests), und Credits
-- und Tokens duerfen nicht in dieselbe Summe fallen.
pro_kind as (
  select provider, unit_kind,
         sum(units) as units,
         sum(cost_usd) as cost_usd,
         count(*) as calls
  from gefiltert
  group by provider, unit_kind
),
pro_anbieter as (
  select provider,
         coalesce(sum(cost_usd), 0) as cost_usd,
         sum(calls) as calls,
         jsonb_object_agg(unit_kind, units) as units
  from pro_kind
  group by provider
)
select jsonb_build_object(
  'total_usd', coalesce((select sum(cost_usd) from pro_anbieter), 0),
  'providers', coalesce(
    (select jsonb_agg(
       jsonb_build_object(
         'provider', provider,
         'cost_usd', cost_usd,
         'calls', calls,
         'units', units
       ) order by provider)
     from pro_anbieter),
    '[]'::jsonb)
);
$$;

revoke execute on function public.api_usage_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.api_usage_summary(uuid, timestamptz, timestamptz) to authenticated;
