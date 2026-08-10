-- Ordnung in den Suchen: Archiv und Ordner.
--
-- ═══════════════════════════════════════════════════════════════════════
-- DER ANLASS -- UND WARUM ER TEUER WAR
-- ═══════════════════════════════════════════════════════════════════════
--
-- Ein Kunde am 2026-08-10 wollte seine Suchliste aufraeumen und hat dafuer
-- zum Loeschen gegriffen. Dann fiel ihm auf, dass er die Listen danach fuer
-- LinkedIn und Instantly nicht mehr nutzen kann.
--
-- Was er nicht sehen konnte: Loeschen ist in dieser App keine Anzeigesache.
-- Eine geloeschte Suche verschwindet aus /leads, aus /linkedin und aus der
-- Kampagnen-Auswahl, ihr Abo wird abgeschaltet -- und ihre Firmen zaehlen im
-- Dublettenschutz nicht mehr mit (worker/dedupe.py: businesses_to_skip nimmt
-- nur Firmen aus NICHT geloeschten Suchen, dazu bereits kontaktierte). Jede
-- unkontaktierte Firma einer geloeschten Liste ist damit fuer die naechste
-- Apollo-Suche wieder einkaufbar, zu rund zwei Credits pro Lead.
--
-- Aufraeumen kostete also Geld. Der Knopf hiess "Loeschen" und niemand konnte
-- ahnen, was daran haengt.
--
-- ARCHIVIEREN ist die fehlende Geste: aus den Augen, sonst unveraendert.
-- archived_at wird AUSSCHLIESSLICH von der Suchliste ausgewertet. Weder
-- Worker noch Leads, LinkedIn oder Kampagnen sehen die Spalte an -- und genau
-- das ist der Punkt. Wer sie spaeter dort einbaut, macht daraus wieder ein
-- zweites Loeschen.

alter table public.searches
  add column if not exists archived_at timestamptz;

comment on column public.searches.archived_at is
  'Nur fuer die Anzeige in der Suchliste: archivierte Suchen rutschen in einen '
  'eigenen Abschnitt. Bewusst OHNE Wirkung auf Leads, LinkedIn, Kampagnen und '
  'Dublettenschutz -- sonst waere es ein zweiter Papierkorb (Migration 0089).';

-- ═══════════════════════════════════════════════════════════════════════
-- ORDNER
-- ═══════════════════════════════════════════════════════════════════════
--
-- Eine Ablage, keine Rechteebene. Ein Ordner zu loeschen loescht keine Suche;
-- die Listen darin landen wieder in "Ohne Ordner" (on delete set null).
--
-- Warum ein Ordner und nicht mehrere Etiketten pro Liste: der Kunde hat
-- "Ordner" gesagt, und ein Ding hat genau einen Platz -- das ist die
-- Vorstellung, die ohne Erklaerung funktioniert. Etiketten waeren flexibler
-- und muessten erklaert werden.
create table if not exists public.search_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Wie bei linkedin_templates und search_presets: Name ist Pflicht, sonst
  -- ist die Auswahl ein Ratespiel.
  name text not null check (length(trim(name)) between 1 and 60),
  -- Nur ein Farbschluessel ("sky", "amber", ...), keine Hex-Werte: die
  -- Oberflaeche soll die Farbe zum Thema (hell/dunkel) waehlen duerfen.
  color text,
  created_at timestamptz not null default now()
);

alter table public.search_folders enable row level security;
drop policy if exists search_folders_owner on public.search_folders;
create policy search_folders_owner on public.search_folders
  for all using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create index if not exists search_folders_workspace_idx
  on public.search_folders (workspace_id, created_at);

-- Ein Ordnername je Workspace. lower(): "Kunden" und "kunden" sind fuer einen
-- Menschen derselbe Ordner, und zwei davon nebeneinander waeren genau die
-- Verwechslung, die der Pflichtname verhindern soll (wie in 0085).
create unique index if not exists search_folders_name_uniq
  on public.search_folders (workspace_id, lower(trim(name)));

alter table public.searches
  add column if not exists folder_id uuid references public.search_folders(id) on delete set null;

create index if not exists searches_folder_idx
  on public.searches (workspace_id, folder_id);

-- ═══════════════════════════════════════════════════════════════════════
-- search_overview gibt die beiden neuen Felder mit heraus
-- ═══════════════════════════════════════════════════════════════════════
--
-- Ohne diesen Schritt bleiben sie im Frontend unsichtbar -- derselbe Fehler
-- wie seinerzeit bei error (0045) und note (0053). Der Rest der Funktion ist
-- unveraendert aus 0053 uebernommen.
drop function if exists public.search_overview(uuid);
create or replace function public.search_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (select p_workspace_id as id where public.is_workspace_owner(p_workspace_id))
select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
from (
  select s.id, coalesce(s.name, s.query) as name, s.query, s.location, s.source, s.status,
    s.error, s.note, s.max_results, s.target_email_count, s.created_at, s.schedule, s.next_run_at,
    s.archived_at, s.folder_id,
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
