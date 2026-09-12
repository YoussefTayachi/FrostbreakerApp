-- Der Eindeutigkeits-Schluessel muss ein Upsert erlauben.
--
-- 0114 hat ihn als Ausdrucks-Index ueber (workspace_id, lower(email))
-- angelegt. Fachlich richtig, praktisch unbrauchbar: PostgREST loest
-- on_conflict=workspace_id,email ueber echte Spalten auf und findet einen
-- Ausdrucks-Index nicht. Ein erneutes Eintragen derselben Zugangsdaten waere
-- damit kein Aktualisieren gewesen, sondern ein Fehler.
--
-- Die Kleinschreibung wandert dorthin, wo sie ohnehin schon passiert:
-- app/api/mailboxes/imap schreibt die Adresse gekuerzt und klein, und der
-- Worker liest sie nur.
drop index if exists public.imap_mailboxes_workspace_email_key;
alter table public.imap_mailboxes
  add constraint imap_mailboxes_workspace_email_key unique (workspace_id, email);
