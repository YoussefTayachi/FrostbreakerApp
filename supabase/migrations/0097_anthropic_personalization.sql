-- Anthropic/Claude als ZWEITER Anbieter fuer die Icebreaker-Personalisierung,
-- mit hinterlegbaren Few-Shot-Beispielen.
--
-- WARUM
--
-- Der Standardweg bleibt OpenAI und aendert sich nicht. Daneben soll ein
-- Workspace Claude waehlen koennen, weil Claude in der Praxis auf eine Art
-- angelernt wird, die der OpenAI-Pfad hier nicht kennt: man legt Paare aus
-- Website-/Kontexttext und handgeschriebenem Icebreaker ab, und das Modell
-- lernt den Stil aus den Beispielen statt aus einer Regelliste. Genau so
-- arbeitet der Agentur-Betreiber, dessen Vorgehen hier nachgebaut wird.
--
-- Die Beispiele werden vom Worker als abwechselnde user/assistant-Turns VOR
-- der echten Anfrage geschickt, nicht in den System-Prompt geschrieben. Siehe
-- generate_claude() in apps/worker/worker/pipelines/personalize.py.

-- 1. Der Schluessel darf hinterlegt werden ----------------------------------
alter table public.api_keys drop constraint api_keys_provider_check;
alter table public.api_keys add constraint api_keys_provider_check
  check (provider = any (array['google_maps', 'openai', 'hunter', 'apollo', 'neverbounce', 'instantly', 'prospeo', 'anthropic']));

-- 2. Der Verbrauch darf festgehalten werden ---------------------------------
--
-- DAS IST KEIN NEBENDETAIL.
--
-- worker/usage.py::record() faengt JEDE Exception ab und schreibt nur eine
-- Warnung ins Log (Absicht: eine fehlende Kostenzeile darf keinen Lead-Import
-- kippen). Fehlte 'anthropic' in diesem CHECK, wuerde die Datenbank jede
-- Claude-Kostenzeile ablehnen, der Worker wuerde die Ablehnung verschlucken,
-- und der Verbrauch waere in der App unsichtbar. Kein Fehler, keine Meldung,
-- nur eine Kostenspalte, die dauerhaft null bleibt, waehrend echtes Geld
-- abfliesst. Wer diese Zeile fuer Formalie haelt, hat genau diesen Fall vor
-- sich.
alter table public.api_usage drop constraint api_usage_provider_check;
alter table public.api_usage add constraint api_usage_provider_check
  check (provider = any (array['openai', 'hunter', 'apollo', 'neverbounce', 'google_maps', 'prospeo', 'anthropic']));

-- 3. provider_subscriptions bleibt bewusst UNVERAENDERT ---------------------
--
-- Geprueft und begruendet, nicht vergessen.
--
-- provider_subscriptions haelt fest, was der Kunde MONATLICH fuer einen Tarif
-- zahlt, weil das von aussen nicht messbar ist (Migration 0077). Anthropic
-- hat fuer die API keinen Tarif in diesem Sinn: abgerechnet wird rein nach
-- Tokenverbrauch, und der steht ab jetzt gemessen in api_usage. In der
-- Eingabemaske (apps/web/app/costs/subscriptions.tsx) sind genau solche
-- Anbieter als `measured` markiert, mit dem ausdruecklichen Hinweis, dass ein
-- zusaetzlich eingetragener Monatsbetrag in der Summe doppelt zaehlt.
--
-- Den Wert hier zuzulassen, ohne ihn in jener Liste anzubieten, waere Schema
-- ohne Schreiber. Sollte Anthropic einmal eine Grundgebuehr einfuehren, holt
-- eine neue Migration den Wert nach; das ist ein Einzeiler.

-- 4. Welches Modell personalisiert diesen Workspace? ------------------------
--
-- Default 'openai': der bestehende Pfad ist und bleibt der Standard. Ein
-- Workspace, der nie etwas umstellt, merkt von dieser Migration nichts.
alter table public.workspaces
  add column if not exists personalization_model text not null default 'openai'
    check (personalization_model in ('openai', 'claude'));

comment on column public.workspaces.personalization_model is
  'Welches Modell den Icebreaker schreibt: openai (Standard) oder claude. Die Few-Shot-Beispiele aus personalization_examples gelten nur fuer claude.';

-- 5. Die Beispiel-Paare -----------------------------------------------------
--
-- input_context  Was das Modell ueber die Firma sieht (Website-/Kontexttext),
--                also die Entsprechung zu dem, was build_context() spaeter
--                fuer einen echten Lead zusammenstellt.
-- icebreaker     Die handgeschriebene Zeile, die dazu gehoert.
--
-- Beide mit Default '', damit ein halb angelegtes Paar speicherbar ist und
-- der Nutzer die zweite Haelfte nachtragen kann. Der Worker sortiert solche
-- Paare beim Laden aus (load_examples): ein Beispiel mit leerer Haelfte
-- bringt dem Modell die falsche Abbildung bei, statt gar keine.
create table if not exists public.personalization_examples (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  input_context text not null default '',
  icebreaker text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Die Reihenfolge ist fachlich relevant: sie bestimmt, in welcher Folge die
-- Beispiel-Turns im Prompt stehen, und damit auch, welcher Vorspann von einem
-- Aufruf zum naechsten byte-identisch bleibt (Prompt-Caching).
create index if not exists personalization_examples_workspace_idx
  on public.personalization_examples (workspace_id, sort_order);

-- RLS nach dem Muster von personalization_templates (Migration 0016): eine
-- einzige for-all-Policy mit using UND with check auf dem Workspace.
--
-- Einziger Unterschied: is_workspace_member statt is_workspace_owner. 0016 ist
-- aelter als 0081; seit 0081 ist is_workspace_owner ein Alias auf
-- is_workspace_member und traegt dort selbst den Kommentar "VERALTET seit
-- 0081 ... Neue Policies nutzen is_workspace_member". Das Verhalten ist
-- identisch, der Name sagt die Wahrheit.
alter table public.personalization_examples enable row level security;
drop policy if exists personalization_examples_member on public.personalization_examples;
create policy personalization_examples_member on public.personalization_examples for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

comment on table public.personalization_examples is
  'Few-Shot-Paare fuer die Claude-Personalisierung: input_context plus handgeschriebener icebreaker, in sort_order-Reihenfolge als user/assistant-Turns vor die echte Anfrage gesetzt.';
