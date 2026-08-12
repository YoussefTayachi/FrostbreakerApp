-- Das Angebot: was der Nutzer verkauft, an wen, mit welchem Nutzen.
--
-- WARUM ES DAS BISHER NICHT GAB, UND WARUM DAS DAS EIGENTLICHE LOCH IST
--
-- Die App weiss alles ueber den EMPFAENGER -- Firma, Person, Rolle, Website,
-- Technologie, Bewertung, recherchierte Firmenbeschreibung -- und nichts
-- ueber den ABSENDER. Es gibt bis heute keine Stelle in dieser Datenbank, an
-- der steht, was der Nutzer eigentlich anbietet.
--
-- Deshalb faengt jede Textstelle der App bei null an: die vier Stufen einer
-- Kampagne (campaign_steps), die LinkedIn-Vorlage (linkedin_templates), der
-- Antwortassistent (er kennt nur calendar_link und reply_sender_name aus
-- Migration 0073). Vier leere Textfelder sind fuer die meisten Nutzer das
-- Ende der Akquise, egal wie gut die Lead-Liste ist.
--
-- Und der eine KI-Baustein, den es gibt, ist davon per Prompt ausdruecklich
-- ausgeschlossen: personalize.py verbietet dem Modell, "deine eigene
-- Dienstleistung oder Loesung zu beschreiben oder zu pitchen". Der Icebreaker
-- ist absichtlich nur der erste Satz. Die drei Saetze danach -- Problem,
-- Nutzen, Frage -- konnte niemand automatisch schreiben, weil die Datenbank
-- sie nicht kannte.
--
-- WARUM EINE EIGENE TABELLE UND KEINE SPALTEN AN workspaces
--
-- Dieselbe Ueberlegung wie bei linkedin_templates (Migration 0080), und aus
-- demselben Anlass: eine Agentur bedient zwei Nischen, ein Shop verkauft zwei
-- Produkte. Mit Spalten an workspaces (wie calendar_link in 0073) hiesse das
-- zweite Angebot: Felder ueberschreiben, Kampagne bauen, Felder
-- zurueckaendern. Genau dieser Schmerz hat 0080 ausgeloest, und ihn ein
-- zweites Mal zu bauen waere aus dem eigenen Fehler nichts gelernt.
--
-- WARUM ZEHN EINZELFELDER UND KEIN GROSSES FREITEXTFELD
--
-- Ein einziges "beschreibe dein Angebot" ist fuer den Nutzer wieder ein
-- leeres Blatt -- also genau das Problem, das hier geloest werden soll. Jedes
-- Feld hier ist eine beantwortbare Frage UND ein einzelner Prompt-Baustein.
-- Damit kann der Generator gezielt formulieren ("nenne das Problem aus
-- problem, belege es mit proof") statt einen Absatz zu interpretieren.
--
-- DIE WICHTIGSTE REGEL STEHT IN DEN LEEREN FELDERN
--
-- Jedes Feld darf leer bleiben, und leer bedeutet nicht "denk dir was aus",
-- sondern erzeugt eine ausdrueckliche Anweisung an das Modell, an dieser
-- Stelle NICHTS zu behaupten. Das ist dieselbe Entscheidung wie bei
-- calendar_link in Migration 0073: ein Modell ohne Terminlink erfindet
-- calendly.com/vorname, ein Modell ohne Referenzen erfindet "ueber 200
-- zufriedene Kunden". Beides faellt nicht dem auf, der die Mail schreibt --
-- es faellt dem Empfaenger auf, und dann ist der Kontakt verbrannt.

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Pflichtname, gleiche Begruendung wie in 0080 und 0075: eine Auswahlliste
  -- aus "Angebot 1, Angebot 2" ist keine Auswahl, sondern ein Ratespiel.
  name text not null check (length(trim(name)) between 1 and 80),

  -- Die sieben inhaltlichen Felder. Alle mit Default '' statt null: sie
  -- werden ausnahmslos als Text in einen Prompt gebaut, und ein null waere
  -- an jeder dieser Stellen ein zweiter Fall ohne eigene Bedeutung.
  -- "Nicht ausgefuellt" und "leer gelassen" sind hier dasselbe.
  offering text not null default '',   -- Was wird verkauft? Ein Satz.
  icp text not null default '',        -- An wen? Branche, Groesse, Rolle.
  problem text not null default '',    -- Was ist beim Kunden VORHER kaputt?
  outcome text not null default '',    -- Was ist danach anders? Moeglichst mit Zahl.
  proof text not null default '',      -- Referenzen, Ergebnisse, Zahlen.
  cta text not null default '',        -- Was soll der Empfaenger tun?
  tone text not null default '',       -- Haertegrad, Eigenheiten der Ansprache.

  -- Anrede getrennt vom Ton, weil sie keine Geschmacksfrage ist, sondern eine
  -- Entscheidung mit genau zwei Antworten -- und weil ein Modell sie in einem
  -- Freitextfeld ("locker, aber professionell") zuverlaessig ueberliest.
  -- Fuer language='en' ohne Bedeutung; der Prompt laesst sie dann weg, statt
  -- dem Modell eine Unterscheidung zu erklaeren, die es im Englischen nicht
  -- gibt.
  address_form text not null default 'du' check (address_form in ('du', 'sie')),

  -- Sprache der erzeugten MAILS, nicht der Oberflaeche. Dieselbe Trennung wie
  -- workspaces.personalization_language (Migration 0083) -- und aus demselben
  -- gemeldeten Fehler: eine deutsche Oberflaeche mit amerikanischen
  -- Zielkunden ist der Normalfall, nicht die Ausnahme.
  language text not null default 'de' check (language in ('de', 'en')),

  -- Quelle fuer das Vorbefuellen der Felder oben. Bleibt gespeichert, damit
  -- ein spaeteres "nochmal einlesen" nicht wieder getippt werden muss.
  website text,

  -- Welches Angebot beim Oeffnen vorausgewaehlt ist. Genau eines je
  -- Workspace, siehe Teilindex unten.
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.offers enable row level security;
create policy offers_owner on public.offers
  for all using (public.is_workspace_owner(workspace_id));

create index offers_workspace_idx on public.offers (workspace_id, created_at);

-- Hoechstens EIN Standardangebot je Workspace -- als Teilindex, nicht als
-- Anwendungslogik. Begruendung wie bei linkedin_templates_one_default (0080):
-- sonst haengt die Eindeutigkeit an der Reihenfolge zweier Schreibvorgaenge,
-- und beim Umschalten gaebe es je nach Reihenfolge kurz zwei oder gar keines.
create unique index offers_one_default
  on public.offers (workspace_id)
  where is_default;

comment on table public.offers is
  'Was der Workspace verkauft. Grundlage fuer den Sequenzgenerator (api/copy/sequence), die LinkedIn-Vorlage und spaeter den Antwortassistenten. Ein leeres Feld heisst ausdruecklich "dazu nichts behaupten" -- siehe die Erlaeuterung in Migration 0090.';

comment on column public.offers.proof is
  'Referenzen, Ergebnisse, Zahlen. LEER LASSEN, wenn es keine gibt: der Prompt weist das Modell dann an, keine zu erfinden. Eine erfundene Referenz faellt erst dem Empfaenger auf.';

comment on column public.offers.cta is
  'Der Schluss der Mail. Leer = der Generator setzt eine kleine Rueckfrage statt einer Terminbitte; ein Terminlink kommt nur aus workspaces.calendar_link (Migration 0073) und wird nie erfunden.';

comment on column public.offers.language is
  'Sprache der erzeugten Mails, NICHT der Oberflaeche. Vgl. workspaces.personalization_language (0083).';
