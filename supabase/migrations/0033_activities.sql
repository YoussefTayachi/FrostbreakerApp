-- CRM Phase 4: Aktivitaeten -- geloggte Anrufe und faellige Aufgaben.
--
-- due_at ist der Unterschied zwischen einem Log und einem Arbeitswerkzeug: eine
-- Notiz sagt "was war", eine Aktivitaet mit Faelligkeit sagt "wen rufe ich heute
-- an". occurred_at ist getrennt von due_at, weil ein Anruf nachtraeglich geloggt
-- wird (occurred_at gesetzt, due_at leer), eine Aufgabe aber vorher geplant wird
-- (due_at gesetzt, occurred_at erst beim Abschliessen).
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  type text not null default 'call' check (type in ('call', 'meeting', 'task')),
  subject text,
  note text,
  outcome text check (outcome in (
    'reached', 'voicemail', 'no_answer', 'not_interested', 'interested', 'meeting_booked'
  )),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  due_at timestamptz,
  completed_at timestamptz,
  occurred_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint activities_target_check check (contact_id is not null or business_id is not null)
);

alter table public.activities enable row level security;
create policy activities_owner on public.activities for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- Partieller Index fuer das "Heute faellig"-Widget: fragt immer nur offene
-- Aktivitaeten ab, abgeschlossene sind fuer diese Abfrage toter Ballast.
create index activities_open_due_idx on public.activities (workspace_id, due_at)
  where completed_at is null and due_at is not null;
create index activities_workspace_contact_idx on public.activities (workspace_id, contact_id);
create index activities_workspace_business_idx on public.activities (workspace_id, business_id);
