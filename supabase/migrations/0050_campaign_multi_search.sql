-- Ein Fan-out (mehrere Orte/Nischen in einer Suche, siehe new-search-form.tsx)
-- erzeugt mehrere searches-Zeilen. Bisher konnte jede davon nur eine eigene
-- Instantly-Kampagne bekommen (campaigns.search_id war 1:1). Diese Tabelle
-- haelt zusaetzlich ALLE Suchen, die eine Kampagne speist -- campaigns.search_id
-- bleibt unveraendert die "primaere" Suche (daran haengen weiterhin Analytics/
-- instantly_campaign_stats, siehe cron/instantly-sync/route.ts), diese Tabelle
-- ist die vollstaendige Quelle fuer "welche Suchen speisen diese Kampagne".
create table public.campaign_searches (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  search_id uuid not null references public.searches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, search_id)
);

alter table public.campaign_searches enable row level security;
create policy campaign_searches_owner on public.campaign_searches for all
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.is_workspace_owner(c.workspace_id)))
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and public.is_workspace_owner(c.workspace_id)));

-- Bestehende Kampagnen ruecwirkend eintragen, damit der neue "weitere Leads
-- nachreichen"-Pfad (der ab jetzt ueber campaign_searches liest) fuer sie
-- weiterhin funktioniert.
insert into public.campaign_searches (campaign_id, search_id)
select id, search_id from public.campaigns where search_id is not null;
