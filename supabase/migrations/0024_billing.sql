-- Stripe-Billing. Abo ist an den Account (auth.users / owner_id) gebunden, nicht
-- an einen einzelnen Workspace -- eine Agentur mit mehreren Workspaces (siehe
-- 0017) zahlt ein Abo fuer ihren gesamten Account, nicht pro Kunde.
--
-- 14 Tage Trial ab Signup, danach nur mit aktivem Abo neue Suchen anlegen.
-- Bestehende Daten (Suchen, Leads, Kampagnen) bleiben nach Trial-Ende weiterhin
-- sicht- und bearbeitbar -- es wird nur das Anlegen NEUER Suchen gesperrt, damit
-- niemand versehentlich den Zugriff auf bereits bezahlte/erledigte Arbeit verliert.
--
-- Durchsetzung auf DB-Ebene (RLS-Policy), nicht nur im Frontend -- gleiche
-- Konvention wie prevent_delete_last_workspace in 0017.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'agency')),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subscriptions_owner_id_ux on public.subscriptions(owner_id);

alter table public.subscriptions enable row level security;
create policy subscriptions_owner_read on public.subscriptions for select
  using (owner_id = auth.uid());
-- Insert/Update/Delete NUR ueber Service-Role (Webhook), niemals vom Client --
-- daher bewusst keine Policy dafuer (RLS default: alles ausser select verboten).

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Prueft, ob ein Account (owner) aktuell suchen/kampagnen anlegen darf:
-- aktives bezahltes Abo ODER noch innerhalb der Trial-Frist.
create or replace function public.has_active_subscription(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.owner_id = p_owner_id
      and (
        s.status = 'active'
        or (s.status = 'trialing' and s.trial_ends_at > now())
      )
  );
$$;
revoke execute on function public.has_active_subscription(uuid) from public, anon;
grant execute on function public.has_active_subscription(uuid) to authenticated;

-- Auto-Trial bei Signup: handle_new_user() aus 0001 erweitern.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspaces (owner_id, name) values (new.id, 'Mein Workspace');
  insert into public.subscriptions (owner_id) values (new.id);
  return new;
end;
$$;

-- Backfill fuer bereits bestehende Accounts -- Trial startet JETZT (nicht
-- rueckwirkend ab dem urspruenglichen Signup-Datum), damit niemand durch
-- diese Migration ausgesperrt wird.
insert into public.subscriptions (owner_id)
select u.id from auth.users u
where not exists (select 1 from public.subscriptions s where s.owner_id = u.id);

-- Durchsetzung: searches_owner (0001, "for all") aufsplitten. Lesen/Aendern/
-- Loeschen bleibt uneingeschraenkt, nur INSERT braucht ein aktives Abo.
drop policy if exists searches_owner on public.searches;

create policy searches_owner_select on public.searches for select
  using (public.is_workspace_owner(workspace_id));

create policy searches_owner_update on public.searches for update
  using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

create policy searches_owner_delete on public.searches for delete
  using (public.is_workspace_owner(workspace_id));

create policy searches_owner_insert on public.searches for insert
  with check (
    public.is_workspace_owner(workspace_id)
    and public.has_active_subscription((select w.owner_id from public.workspaces w where w.id = workspace_id))
  );
