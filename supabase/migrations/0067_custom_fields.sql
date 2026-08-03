-- Eigene Felder.
--
-- Die erste Frage jedes Umsteigers, und ohne sie ist ein CRM fuer ihn kein
-- CRM. Pipedrives Deal-Detail sagt es woertlich: "Ihr Detailbereich ist leer.
-- Fuegen Sie benutzerdefinierte Felder hinzu oder fuellen Sie ihn durch Drag &
-- Drop mit bestehenden Feldern aus."
--
-- Jeder gewachsene Bestand hat solche Felder -- Branche, Mitarbeiterzahl,
-- Vertragsende, Zustaendigkeit, was auch immer der jeweilige Vertrieb braucht.
-- Ohne sie ist auch ein Import wertlos: die Daten haetten kein Ziel.
--
-- ZWEI ENTWURFSENTSCHEIDUNGEN, DIE MAN KENNEN MUSS:
--
-- 1. Werte als jsonb-Spalte am Objekt, NICHT als eigene Wertetabelle (EAV).
--    Eine Wertetabelle waere flexibler, kostet aber bei jeder Liste einen
--    weiteren Join und macht "sortiere nach Feld X" zur Uebung. Der jsonb-Weg
--    liest sich mit dem Objekt zusammen, laesst sich per GIN indizieren und
--    entspricht dem, was der Nutzer ohnehin sieht: Felder gehoeren zum
--    Datensatz. Der Preis -- keine referenzielle Integritaet zwischen
--    Definition und Wert -- ist hier tragbar, weil Definitionen selten
--    geloescht werden und ein verwaister Wert nur ungenutzt herumliegt.
--
-- 2. Feste Typenliste statt beliebiger Typen. Vier Typen decken erfahrungs-
--    gemaess fast alles ab; jeder weitere kostet Darstellung, Eingabe,
--    Pruefung und Sortierung an je einer Stelle mehr.

create table public.custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- An welcher Objektart haengt das Feld?
  entity text not null check (entity in ('contact', 'business', 'deal')),
  -- Schluessel im jsonb des Objekts. Technisch, nicht uebersetzt, unveraenderlich --
  -- wer das Label aendert, soll nicht die vorhandenen Werte verlieren.
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(btrim(label)) > 0),
  field_type text not null default 'text'
    check (field_type in ('text', 'number', 'date', 'select')),
  -- Nur bei 'select' belegt: die zulaessigen Werte, als Array von Strings.
  options jsonb not null default '[]'::jsonb,
  -- Reihenfolge in der Anzeige. Pipedrive laesst Felder per Drag & Drop
  -- sortieren; hier reicht vorerst eine Zahl, die beim Anlegen hochzaehlt.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, entity, key)
);

alter table public.custom_field_defs enable row level security;
create policy custom_field_defs_owner on public.custom_field_defs for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create index custom_field_defs_lookup_idx
  on public.custom_field_defs (workspace_id, entity, position);

-- Die Werte. Ein leeres Objekt statt NULL, damit der Lesepfad nie zwischen
-- "kein Feld gesetzt" und "Spalte ist null" unterscheiden muss.
alter table public.contacts   add column custom jsonb not null default '{}'::jsonb;
alter table public.businesses add column custom jsonb not null default '{}'::jsonb;
alter table public.deals      add column custom jsonb not null default '{}'::jsonb;

-- GIN nur dort, wo spaeter gefiltert wird. Die Indizes kosten Schreibzeit und
-- Platz; auf deals waeren sie bei den erwartbaren Mengen Verschwendung.
create index contacts_custom_idx   on public.contacts   using gin (custom);
create index businesses_custom_idx on public.businesses using gin (custom);
