-- Eigene, frei definierbare Angebotsfelder, ZUSAETZLICH zu den zwoelf festen.
--
-- WARUM ZUSAETZLICH UND NICHT ERSETZEND
--
-- Die zwoelf Felder aus 0090/0093 sind kein Schema, sie sind das Playbook.
-- Jedes traegt eine benannte Rolle in der Mail-Architektur: friction traegt
-- den Satz, mit dem Mail 1 anfaengt; cta ist der Micro-Yes, der ueber alle
-- vier Stufen woertlich wiederholt wird; ein leeres proof erzeugt das
-- ausdrueckliche Verbot, ueberhaupt Referenzen zu erwaehnen; mechanism ist
-- Hintergrund und in Stufe 1 verboten. sequenceProblems() misst den Betreff
-- gegen offer.cta und die Terminbitte gegen den Text.
--
-- Wuerde man die zwoelf durch frei definierbare Felder ersetzen, wuesste der
-- Generator nicht mehr, welches der eigenen Felder der Micro-Yes ist. Das
-- Ergebnis waere kein Fehler, den jemand sieht, sondern der teurere Fall:
-- Mails, die fertig aussehen und keine Antwort bekommen.
--
-- Was dem Nutzer wirklich fehlte, ist dreierlei, und das ist additiv loesbar:
-- die Felder in SEINEN Worten zu benennen, eine eigene Anweisung ans Modell
-- zu hinterlegen, und das eine oder andere zu ergaenzen, das unter den zwoelf
-- keine Heimat hat (etwa "ungefaehre Verluste wegen des Pain Points", eine
-- Zahl, die weder problem noch outcome ist).

-- 1. Die Definitionen ------------------------------------------------------
--
-- WORKSPACE-GEBUNDEN UND NICHT ANGEBOTS-GEBUNDEN
--
-- Wer in "Risk Reversal" denkt, denkt bei jedem Angebot so. Definitionen je
-- Angebot hiessen, sie fuer jedes Angebot neu anzulegen, also genau die
-- Reibung, gegen die der Zuschnitt auf eine Lead-Liste (Aim) gebaut wurde.
-- Ausserdem waere bei Aim (ein Angebot, mehrere Listen) sonst unklar, wessen
-- Definitionen gelten.
create table if not exists public.offer_field_defs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Der Schluessel, unter dem der Wert in offers.custom_fields steht. Wird
  -- beim Anlegen aus dem Label erzeugt (bei Kollision mit Suffix) und ist
  -- danach UNVERAENDERLICH: die bereits geschriebenen Werte zeigen darauf.
  -- Das Label darf jederzeit umbenannt werden, der Schluessel nie.
  key text not null,
  label text not null,

  -- Die Anweisung ans Modell, die woertlich in den Prompt wandert. Das ist
  -- der eigentliche Hebel dieser Migration: ohne sie waere ein eigenes Feld
  -- nur eine zweite Ueberschrift ueber demselben Textfeld.
  instruction text not null default '',

  -- Aus welchem Material das Feld gefuellt wird.
  --
  -- KEINE BEQUEMLICHKEIT, SONDERN DIE TRENNLINIE, DIE SCHON
  -- SEARCH_SUGGESTED_FIELDS ZIEHT (lib/copy/offer-from-search.ts):
  -- Core liest die Verkaeuferseite (was DU verkaufst), Aim liest die
  -- recherchierten Firmenbeschreibungen (an WEN). "Risk Reversal" ist
  -- absenderseitig, "Painpoint auf der Website des Leads" empfaengerseitig.
  -- Wer beides aus derselben Quelle zieht, bekommt erfundene Werte.
  --
  -- manual = das Modell fuellt es nie, der Nutzer tippt es selbst.
  fill_from text not null default 'core'
    check (fill_from in ('core', 'aim', 'both', 'manual')),

  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  -- Zwei Felder mit demselben Schluessel waeren zwei Beschriftungen ueber
  -- demselben Wert.
  unique (workspace_id, key)
);

-- Die Reihenfolge ist fachlich relevant: sie bestimmt, in welcher Folge die
-- Felder im Formular und im Prompt stehen.
create index if not exists offer_field_defs_workspace_idx
  on public.offer_field_defs (workspace_id, sort_order);

-- RLS nach dem Muster von personalization_examples (Migration 0097): eine
-- einzige for-all-Policy mit using UND with check auf dem Workspace.
alter table public.offer_field_defs enable row level security;
drop policy if exists offer_field_defs_member on public.offer_field_defs;
create policy offer_field_defs_member on public.offer_field_defs for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

comment on table public.offer_field_defs is
  'Eigene Angebotsfelder eines Workspaces, ZUSAETZLICH zu den zwoelf festen Spalten in offers. key ist unveraenderlich (die Werte in offers.custom_fields zeigen darauf), label und instruction nicht. fill_from entscheidet, ob Core (eigene Website) oder Aim (Lead-Liste) das Feld vorschlagen darf.';

comment on column public.offer_field_defs.instruction is
  'Die Anweisung ans Modell, woertlich in den Prompt gesetzt (lib/copy/offer-custom-fields.ts). Leer heisst: es steht nur das Label da, und das Modell muss raten.';

-- 2. Die Werte -------------------------------------------------------------
--
-- WARUM JSONB UND KEINE WERTETABELLE
--
-- Ein Angebot wird ueberall als EINE Zeile mit OFFER_COLUMNS gelesen
-- (app/offers/page.tsx und fuenf API-Routen). Eine Wertetabelle waere dort
-- ueberall ein Join oder eine zweite Abfrage. Gelesen werden die Werte nur im
-- Ganzen (Prompt bauen) und geschrieben nur im Ganzen (Formular speichern);
-- es gibt keine Abfrage, die nach einem einzelnen eigenen Feld filtert oder
-- aggregiert. Genau dafuer ist jsonb da.
--
-- Die zwoelf festen Felder bleiben ausdruecklich SPALTEN:
-- REQUIRED_FOR_GENERATION, completeness() und jede Playbook-Pruefung lesen
-- sie namentlich, und TypeScript faengt heute jeden Tippfehler. Sie in einen
-- untypisierten Beutel zu schieben, taeuschte Flexibilitaet vor, wo sich nie
-- etwas aendert, und kostete die Compilerpruefung.
alter table public.offers
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column public.offers.custom_fields is
  'Werte der eigenen Felder, Schluessel = offer_field_defs.key. VERWAISTE WERTE SIND ABSICHT: wird eine Definition geloescht, bleibt ihr Wert stehen. Der Prompt wird aus den Definitionen gebaut, ein verwaister Wert wird also nirgends gelesen; das macht das Loeschen umkehrbar und kostet nichts.';
