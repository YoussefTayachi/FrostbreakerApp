-- Nachholen: die Mails, die vor dem ersten Sync verschickt wurden.
--
-- DER BEFUND (gemessen am 2026-08-04)
--
--   Instantly meldet   312 versendete Mails
--   messages enthaelt  184
--   contacts.outreach_status = 'contacted' bei 173 Kontakten
--   Instantly meldet   287 kontaktierte Leads
--
-- Die aelteste Nachricht bei uns stammt vom 2026-07-30. Kampagnen liefen
-- vorher schon. Der Inbox-Sync holt nur, was seit workspaces
-- .instantly_inbox_synced_at entstanden ist, und dieser Wasserstand wurde
-- beim allerersten Lauf einfach auf "jetzt" gesetzt -- alles davor hat nie
-- jemand geholt und wird auch nie jemand holen, weil das Zeitfenster fuer
-- immer hinter dem Wasserstand liegt.
--
-- Die Folge trifft genau das, wofuer es die Pipeline gibt: outreach_status
-- steigt von 'new' auf 'contacted', wenn der Sync eine ausgehende Mail sieht.
-- Rund 110 angeschriebene Kontakte stehen deshalb im Board weiterhin unter
-- "Neu" -- als waere nie etwas passiert.
--
-- DIE FORM
--
-- Eine Zeile je (Workspace, Postfach, Richtung), die sich merkt, wie weit sie
-- gekommen ist. Der Cron arbeitet sie seitenweise ab und ist damit gegen
-- alles unempfindlich, was einen Durchlauf abbrechen kann: Vercels
-- Zeitlimit, Instantlys 20 Anfragen je Minute, ein Deploy mittendrin. Wer
-- neu startet, macht beim Cursor weiter und nicht von vorn.
--
-- Bewusst KEIN einmaliges Skript: ein Skript muesste jemand ausfuehren, bei
-- dem der Entschluesselungs-Schluessel liegt, und es waere genau einmal
-- richtig. Diese Tabelle laeuft von allein leer und ist danach still.
create table public.instantly_backfill (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Das verbundene Postfach, wie Instantly es fuehrt (accounts.email).
  eaccount text not null,
  email_type text not null check (email_type in ('received', 'sent')),
  -- Instantlys next_starting_after der zuletzt geholten Seite. Null = noch
  -- keine Seite geholt, also von Anfang an.
  starting_after text,
  pages_done integer not null default 0,
  emails_seen integer not null default 0,
  -- Aufeinanderfolgende Fehlversuche. Wird bei jeder geglueckten Seite auf 0
  -- zurueckgesetzt; siehe die Aufgabe-Grenze in der Route.
  failed_attempts integer not null default 0,
  -- Letzte Fehlermeldung, damit ein aufgegebener Nachlauf erklaerbar bleibt.
  error text,
  -- Gesetzt = fertig (oder aufgegeben). Der Cron sucht sich die Zeilen, bei
  -- denen das noch null ist.
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, eaccount, email_type)
);

-- Die einzige Abfrage, die im Minutentakt laeuft: "gibt es hier noch was zu
-- tun". Partiell, damit der Index leer laeuft, sobald der Nachlauf durch ist
-- -- danach kostet die Frage nichts mehr.
create index instantly_backfill_pending_idx
  on public.instantly_backfill (workspace_id, created_at)
  where finished_at is null;

alter table public.instantly_backfill enable row level security;

-- Nur lesen, und nur der Eigentuemer. Geschrieben wird ausschliesslich vom
-- Cron ueber die Service-Role (umgeht RLS): ein von Hand gesetzter Cursor
-- wuerde stillschweigend Mails ueberspringen.
create policy instantly_backfill_read on public.instantly_backfill
  for select using (public.is_workspace_owner(workspace_id));
