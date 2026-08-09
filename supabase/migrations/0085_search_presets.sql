-- Suchvorlagen gehoeren in die Datenbank, nicht in den Browser.
--
-- DER ANLASS
--
-- Ein Kunde hatte eine Vorlage gespeichert ("ecommerce/whatsapp marketing")
-- und fand sie nicht wieder. Nachgesehen am 2026-08-09: sie ist nicht
-- verloren gegangen -- sie war nie an einem Ort, an dem sie wiederauffindbar
-- gewesen waere.
--
-- Die Vorlagen lagen im localStorage unter fb_search_presets_<workspace>.
-- Die Begruendung im Code lautete: "es gibt keinen Bedarf, sie zwischen
-- Geraeten zu teilen, und so bleibt die Aenderung ohne Migration und ohne
-- zusaetzliche RLS-Regeln." Beides stimmte zum Zeitpunkt der Entscheidung und
-- beides traegt jetzt nicht mehr:
--
--   * localStorage haengt an Browser UND Profil UND Geraet. Ein Wechsel des
--     Rechners, ein zweiter Browser, geloeschte Browserdaten oder ein
--     privates Fenster -- in all diesen Faellen ist die Vorlage weg, ohne
--     dass irgendetwas kaputt waere.
--   * Seit Migration 0081 hat ein Workspace mehrere Personen. Eine Vorlage,
--     die nur der sieht, der sie angelegt hat, ist fuer ein Team wertlos.
--   * Es ist inkonsistent: personalization_templates (0069) und
--     linkedin_templates (0080) liegen laengst in der Datenbank. Die
--     Suchvorlage war die einzige Ausnahme.
--
-- WARUM config ALS jsonb UND NICHT ALS SPALTEN
--
-- Anders als bei den LinkedIn-Vorlagen, wo "body" ein einzelnes Feld mit
-- eigener Bedeutung ist, ist eine Suchvorlage eine Momentaufnahme des ganzen
-- Formulars: Modus, Ort, Umkreis, Branche, Land, Firmengroesse, Stichwoerter,
-- Positionen, Senioritaeten, Technologien, Marktsegmente -- rund zwanzig
-- Felder, und mit jedem neuen Filter kaeme eine Spalte dazu (zuletzt am
-- 2026-08-09 die Marktsegmente). Die Werte werden ausserdem IMMER vollstaendig
-- zusammen gelesen und geschrieben, nie einzeln abgefragt oder sortiert.
--
-- Das ist genau die Abwaegung wie bei campaign_steps.variants (0071): was nur
-- als Ganzes vorkommt, darf als Ganzes liegen.

create table public.search_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Wie bei linkedin_templates: der Name ist Pflicht, sonst ist die Auswahl
  -- ein Ratespiel.
  name text not null check (length(trim(name)) between 1 and 80),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.search_presets enable row level security;
create policy search_presets_owner on public.search_presets
  for all using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

create index search_presets_workspace_idx
  on public.search_presets (workspace_id, created_at);

-- Ein Name je Workspace. Die Oberflaeche ersetzte bisher eine gleichnamige
-- Vorlage stillschweigend ("Speichern unter demselben Namen = ueberschreiben")
-- -- damit das auch dann gilt, wenn zwei Personen gleichzeitig speichern,
-- steht die Regel hier und nicht nur im Browser.
--
-- lower(): "Ecommerce" und "ecommerce" sind fuer einen Menschen derselbe Name,
-- und eine Liste mit beiden waere genau die Verwechslung, die der Pflichtname
-- verhindern soll.
create unique index search_presets_name_uniq
  on public.search_presets (workspace_id, lower(trim(name)));

comment on table public.search_presets is
  'Benannte Suchvorlagen fuer das Formular "Neue Suche". config ist eine '
  'Momentaufnahme aller Formularfelder; die Oberflaeche ignoriert Schluessel, '
  'die sie nicht kennt, damit aeltere Vorlagen nach neuen Filtern weiter '
  'funktionieren. Loeste die Ablage im localStorage ab (Migration 0085).';
