-- CRM Phase 1: Freitext-Notizen, die der Vertriebler selbst schreibt.
--
-- Bewusst auf zwei Ebenen: contact_id fuer "mit Herrn Huber telefoniert",
-- business_id fuer firmenweite Erkenntnisse ("Empfang ist Gatekeeper"), die in
-- der Timeline jedes Kontakts dieser Firma auftauchen sollen, ohne dass die
-- Notiz pro Kontakt dupliziert wird. Genau eines von beiden ist gesetzt.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete cascade,
  -- Default auth.uid(): der Client muss den Autor nicht mitschicken und kann
  -- ihn dadurch auch nicht faelschen.
  author_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_target_check check (
    (contact_id is not null and business_id is null)
    or (contact_id is null and business_id is not null)
  )
);

alter table public.notes enable row level security;
create policy notes_owner on public.notes for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create index notes_workspace_contact_idx on public.notes (workspace_id, contact_id, created_at desc);
create index notes_workspace_business_idx on public.notes (workspace_id, business_id, created_at desc);
