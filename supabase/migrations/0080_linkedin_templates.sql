-- Mehrere LinkedIn-Vorlagen statt einer.
--
-- Bisher lag genau EINE Vorlage in workspaces.linkedin_message_template
-- (Migration 0057). Sie galt fuer jeden Kontakt in jeder Liste. Wer
-- Agenturen anders anschreiben will als Shops -- und das ist der Normalfall,
-- die Mail-Sequenzen sind ja auch je Kampagne verschieden --, musste den Text
-- vor jeder Liste von Hand austauschen und danach zurueckaendern.
--
-- WARUM EINE EIGENE TABELLE UND KEIN jsonb-ARRAY AM WORKSPACE
--
-- Weil eine Vorlage ein Ding mit eigenem Lebenslauf ist: sie wird benannt,
-- geaendert, ausgewaehlt und irgendwann geloescht. In einem Array am
-- Workspace waere jede dieser Aktionen ein Lesen-Aendern-Schreiben des ganzen
-- Feldes -- und zwei offene Tabs wuerden sich gegenseitig ueberschreiben.
--
-- Bei campaign_steps.variants (Migration 0071) ist die Entscheidung bewusst
-- andersherum gefallen: Varianten werden IMMER vollstaendig zusammen mit
-- ihrem Schritt gelesen und geschrieben, nie einzeln. Hier ist es umgekehrt.

create table public.linkedin_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Der Name ist Pflicht: eine Liste aus "Vorlage 1, Vorlage 2, Vorlage 3"
  -- ist keine Auswahl, sondern ein Ratespiel. Dieselbe Ueberlegung wie beim
  -- Pflichtnamen des CSV-Imports (Migration 0075).
  name text not null check (length(trim(name)) between 1 and 80),
  body text not null default '',
  -- Welche Vorlage beim Oeffnen der Liste vorausgewaehlt ist. Genau eine je
  -- Workspace -- siehe den Teilindex unten.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.linkedin_templates enable row level security;
create policy linkedin_templates_owner on public.linkedin_templates
  for all using (public.is_workspace_owner(workspace_id));

create index linkedin_templates_workspace_idx
  on public.linkedin_templates (workspace_id, created_at);

-- Hoechstens EINE Standardvorlage je Workspace.
--
-- Als Teilindex statt als Anwendungslogik: sonst haengt die Eindeutigkeit an
-- der Reihenfolge zweier Schreibvorgaenge, und beim Umschalten des Standards
-- (erst neue setzen, dann alte loeschen -- oder umgekehrt) gaebe es je nach
-- Reihenfolge kurz zwei oder gar keine. Die Datenbank haelt das fest, der
-- Code muss nur noch in der richtigen Reihenfolge schreiben.
create unique index linkedin_templates_one_default
  on public.linkedin_templates (workspace_id)
  where is_default;

/**
 * Die vorhandene Vorlage uebernehmen.
 *
 * Wer schon eine geschrieben hat, soll sie nach dem Update wiederfinden --
 * und zwar ausgewaehlt. Ohne diesen Schritt staende die Liste leer da und die
 * Arbeit waere scheinbar weg.
 *
 * Nur wo tatsaechlich etwas drinsteht: ein leeres Feld bedeutet "es galt die
 * Vorgabe aus dem Code", und daraus eine gespeicherte Vorlage zu machen waere
 * eine Entscheidung, die der Nutzer nie getroffen hat.
 */
insert into public.linkedin_templates (workspace_id, name, body, is_default)
select w.id, 'Standard', w.linkedin_message_template, true
from public.workspaces w
where coalesce(trim(w.linkedin_message_template), '') <> '';

comment on column public.workspaces.linkedin_message_template is
  'VERALTET seit Migration 0080. Der Inhalt wurde nach linkedin_templates uebernommen; die Spalte bleibt nur stehen, damit ein Rueckbau moeglich waere. Nichts liest sie mehr.';

comment on table public.linkedin_templates is
  'Benannte Nachrichtenvorlagen fuer die LinkedIn-Arbeitsliste. Platzhalter wie bei den Mail-Kampagnen: {{firstName}}, {{companyName}}, {{personalization}}.';
