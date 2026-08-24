-- Der Website-Befund als EIGENER Satz, getrennt vom Icebreaker.
--
-- WARUM DIESE TRENNUNG SEIN MUSS
--
-- Migration 0102 hat den Website-Check gebracht, und der Befund ging danach
-- als Zusatzsignal in den Icebreaker-Prompt (personalize.audit_hint). Das war
-- an drei Stellen falsch:
--
--   1. workspaces.personalization_prompt ist ein NUTZERTEXT. Der Betreiber
--      dieses Workspaces hat ihn selbst geschrieben und nachgeschaerft. Ihm
--      unbemerkt eine zusaetzliche Aufgabe unterzuschieben ("bring auch noch
--      einen Website-Mangel unter") aendert das Verhalten eines Prompts, den
--      er verfasst hat, ohne dass er die Aenderung irgendwo sieht.
--   2. Die beiden Saetze haben verschiedene Aufgaben. Der Icebreaker beweist,
--      dass man die Welt des Empfaengers versteht. Der Befund benennt ein
--      Problem, das man loesen kann. Verschiedene Tonlage, verschiedene
--      Stelle in der Mail.
--   3. Solange der Befund im Icebreaker steckt, steht er zwangslaeufig im
--      EROEFFNUNGSSATZ. Wo in der Sequenz er auftaucht, soll der Nutzer
--      entscheiden.
--
-- Der Check selbst (0102) bleibt unveraendert. Nur seine Verwendung aendert
-- sich: aus einem Zusatz im fremden Prompt wird ein eigener Erzeugungsschritt
-- mit eigenem Prompt und eigenem Ergebnisfeld.

-- 1. Der neue Job-Typ ------------------------------------------------------
--
-- Wie schon in 0102: jobs.type traegt eine CHECK-Constraint, die Postgres
-- nicht erweitern kann, sie wird deshalb komplett neu gesetzt. Die Liste ist
-- die aus 0102 plus write_website_finding, im Uebrigen unveraendert
-- (send_batch, poll_inbox und poll_instantly bleiben drin, obwohl ungenutzt;
-- sie zu streichen waere eine zweite, unabhaengige Entscheidung).
--
-- Warum ein eigener Job und nicht ein zweiter Modellaufruf in personalize:
-- die Begruendung steht bei HANDLERS in apps/worker/worker/main.py und gehoert
-- dorthin, nicht ins Schema.
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('get_businesses', 'find_decisionmaker', 'hunt_persons', 'personalize',
                   'check_website', 'write_website_finding',
                   'send_batch', 'poll_inbox', 'poll_instantly'));

-- 2. Das Ergebnisfeld ------------------------------------------------------
--
-- Vorbild ist personalization / personalization_needs_review (Migration
-- 0012), einschliesslich der Nachpruefung: dieser Satz geht durch dieselbe
-- Wortgrenze und dieselbe Zeichen-Verbotsliste wie der Icebreaker, also
-- braucht er dieselbe Markierung, wenn beide Versuche daran scheitern.
--
-- Nullable und ohne Default, aus demselben Grund wie website_audit_status in
-- 0102: leer heisst hier "dieser Lead hat keinen Befund" und ist ein
-- HAEUFIGER, richtiger Zustand (keine Website, Seite nicht erreichbar, keine
-- der acht Pruefungen schlaegt an). Ein Default-Leerstring wuerde diesen Fall
-- von "noch nicht erzeugt" nicht mehr unterscheidbar machen.
alter table public.businesses
  add column if not exists website_finding text,
  add column if not exists website_finding_needs_review boolean not null default false;

comment on column public.businesses.website_finding is
  'Ein einzelner Satz zum ranghoechsten Website-Befund dieses Leads, erzeugt vom Job write_website_finding aus businesses.website_audit (Migration 0102). Geht beim Kampagnen-Upload als eigene Instantly-Variable {{websiteFinding}} mit, getrennt von personalization. LEER IST EIN ERGEBNIS: kein Befund, keine Website, Seite nicht erreichbar. Leads mit leerem Feld werden von einer Kampagne, deren Sequenz die Variable benutzt, zurueckgehalten (lib/instantly/create-campaign.ts), damit keine Mail mit einem Loch rausgeht.';

comment on column public.businesses.website_finding_needs_review is
  'Beide Versuche haben Wortgrenze oder Zeichen-Verbot gerissen. Gleiche Bedeutung wie personalization_needs_review.';

-- 3. Der eigene Prompt -----------------------------------------------------
--
-- Genau wie personalization_prompt (0006/0012): nullable, kein Default. Leer
-- heisst "es gilt der Standard in der eingestellten Sprache"
-- (worker/pipelines/website_finding.py, DEFAULT_FINDING_PROMPT_DE/EN). Den
-- Standard hier als Spalten-Default zu hinterlegen wuerde ihn einfrieren:
-- bestehende Workspaces bekaemen eine spaetere Verbesserung nie zu sehen,
-- und es gaebe zwei Wahrheiten ueber den Standardtext.
alter table public.workspaces
  add column if not exists website_finding_prompt text;

comment on column public.workspaces.website_finding_prompt is
  'Eigener System-Prompt fuer den Website-Befund-Satz. Bewusst getrennt von personalization_prompt: das ist der Icebreaker-Prompt des Nutzers, und der soll nichts von Website-Maengeln wissen muessen. Leer = Standard aus worker/pipelines/website_finding.py.';

-- 4. KEINE eigenen Einstellungen fuer Wortgrenze und Verbotsliste ----------
--
-- Bewusst nicht. personalization_max_words, personalization_banned_words und
-- personalization_language gelten sinngemaess weiter, mit einer Ausnahme, die
-- im Code steht und keine Spalte braucht: die Wortgrenze. Ein Befundsatz ist
-- kuerzer als ein Icebreaker, die Grenze ist deshalb eine Konstante in
-- website_finding.py (FINDING_MAX_WORDS) und keine vierte Einstellung.
--
-- Sprache und verbotene Zeichen sind dagegen Eigenschaften des WORKSPACES,
-- nicht dieses einen Textes: ein Gedankenstrich ist in beiden Saetzen
-- dasselbe Erkennungszeichen fuer Maschinentext, und zwei Saetze derselben
-- Mail in zwei Sprachen waeren ein Fehler. Sie zu verdoppeln hiesse, dem
-- Nutzer vier neue Felder hinzustellen, von denen drei immer gleich stehen
-- muessen.
