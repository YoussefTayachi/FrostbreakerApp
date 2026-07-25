-- CRM Phase 5: Deals mit Wert -- die Grundlage fuer eigenes Forecasting.
--
-- Loest mittelfristig instantly_campaign_stats.total_opportunity_value ab: der
-- Pipeline-Wert soll aus eigenen Daten kommen und nicht davon abhaengen, dass
-- jemand in Instantly eine Opportunity pflegt.
--
-- probability wird explizit gespeichert, nicht aus der Stage berechnet. Die
-- Stage-Standardwerte leben in lib/crm/deals.ts (DEAL_STAGES) und werden beim
-- Anlegen/Umstufen von dort gesetzt -- so gibt es genau eine Quelle der Wahrheit
-- und der Vertriebler kann die Wahrscheinlichkeit im Einzelfall uebersteuern,
-- ohne dass eine Stage-Aenderung sie ihm wieder wegrechnet.
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  value numeric(12, 2) not null default 0 check (value >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  stage text not null default 'qualified'
    check (stage in ('qualified', 'meeting', 'proposal', 'negotiation')),
  probability integer not null default 20 check (probability between 0 and 100),
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  expected_close_date date,
  closed_at timestamptz,
  lost_reason text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ein geschlossener Deal ohne Abschlussdatum waere im Forecast unsichtbar
  -- ("gewonnen letzte 30 Tage" braucht closed_at), darum hart erzwungen.
  constraint deals_closed_at_check check (
    (status = 'open' and closed_at is null) or (status <> 'open' and closed_at is not null)
  )
);

alter table public.deals enable row level security;
create policy deals_owner on public.deals for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create index deals_workspace_open_idx on public.deals (workspace_id, stage)
  where status = 'open';
create index deals_workspace_closed_idx on public.deals (workspace_id, closed_at desc)
  where status <> 'open';
create index deals_workspace_business_idx on public.deals (workspace_id, business_id);
create index deals_workspace_contact_idx on public.deals (workspace_id, contact_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger deals_touch_updated_at before update on public.deals
  for each row execute function public.touch_updated_at();
