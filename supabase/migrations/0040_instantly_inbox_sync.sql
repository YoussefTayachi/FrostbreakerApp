-- Mailbox-weiter Inbox-Sync statt nur kampagnen-gebundener Antworten:
-- from_email/eaccount werden IMMER gesetzt (auch ohne Kontakt-Treffer), damit
-- unbekannte Absender trotzdem als Nachricht sichtbar sind, statt verworfen zu
-- werden. instantly_inbox_synced_at trackt den letzten workspace-weiten Sync,
-- analog zu searches.instantly_last_polled_at fuer den kampagnen-scoped Poll.
alter table public.messages add column if not exists from_email text;
alter table public.messages add column if not exists eaccount text;
alter table public.workspaces add column if not exists instantly_inbox_synced_at timestamptz;
