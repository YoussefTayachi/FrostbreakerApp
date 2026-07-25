-- Eigene Inbox statt Umstieg auf Instantlys Unibox: die Antworten liegen durch
-- poll_instantly.py schon vollstaendig in public.messages, es fehlte nur der
-- Gelesen-Zustand, damit /inbox "neu" von "schon gesehen" unterscheiden kann.

alter table public.messages
  add column if not exists read_at timestamptz;

-- Altbestand als gelesen markieren: ohne Backfill wuerde jeder bestehende
-- Workspace beim ersten Deploy mit dreistelligen Unread-Zahlen begruesst,
-- obwohl die Antworten im Lead-Drawer laengst gesehen wurden.
update public.messages
  set read_at = coalesce(sent_at, created_at)
  where direction = 'inbound' and read_at is null;

-- public.messages hatte bisher gar keine Indizes (siehe 0001) -- die Inbox
-- fragt genau drei Muster ab: Unread-Zaehler fuer das Nav-Badge, Listing der
-- eingehenden Antworten, und den Thread eines einzelnen Kontakts.
create index if not exists messages_unread_inbound_idx
  on public.messages (workspace_id)
  where direction = 'inbound' and read_at is null;

create index if not exists messages_inbound_recent_idx
  on public.messages (workspace_id, sent_at desc)
  where direction = 'inbound';

create index if not exists messages_workspace_contact_idx
  on public.messages (workspace_id, contact_id);
