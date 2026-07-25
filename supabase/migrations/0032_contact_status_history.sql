-- CRM Phase 2: contacts.outreach_status haelt nur den aktuellen Stand -- fuer die
-- Timeline ("wann wurde der Lead zum Kunden?") braucht es die Bewegungen.
--
-- Per Trigger statt im App-Code: der Status wird an mehreren Stellen gesetzt
-- (leads-table.tsx, Pipeline-Board, poll_instantly.py hebt auf 'replied' an).
-- Ein Trigger erwischt alle drei, ohne dass jeder Aufrufer daran denken muss.
create table public.contact_status_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  old_status text,
  new_status text not null,
  -- null, wenn der Worker mit Service-Role umstellt (z.B. automatisch auf
  -- 'replied' nach einer eingehenden Antwort) -- das ist eine echte Information
  -- und wird im UI als "automatisch" gerendert, nicht als fehlender Wert.
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

alter table public.contact_status_history enable row level security;
-- Nur lesen: Eintraege entstehen ausschliesslich durch den Trigger unten,
-- niemand soll Historie nachtraeglich schreiben oder korrigieren koennen.
create policy contact_status_history_read on public.contact_status_history for select
  using (public.is_workspace_owner(workspace_id));

create index contact_status_history_contact_idx
  on public.contact_status_history (workspace_id, contact_id, changed_at desc);

create or replace function public.log_contact_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.outreach_status is distinct from old.outreach_status then
    insert into public.contact_status_history
      (workspace_id, contact_id, old_status, new_status, changed_by)
    values
      (new.workspace_id, new.id, old.outreach_status, new.outreach_status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger contacts_log_status_change
  after update of outreach_status on public.contacts
  for each row execute function public.log_contact_status_change();
