-- messages_instantly_email_id_ux (Migration 0019) war ein PARTIELLER Unique-Index
-- (where instantly_email_id is not null). Postgres akzeptiert einen partiellen
-- Index fuer "ON CONFLICT (spalten)" nur, wenn die WHERE-Klausel im Konflikt-Ziel
-- exakt wiederholt wird -- PostgREST/supabase-js .upsert({onConflict: "a,b"})
-- schickt das nicht mit, deshalb schlug jeder Upsert mit "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification" fehl. Die WHERE-
-- Klausel war ohnehin unnoetig: ein normaler Unique-Index erlaubt beliebig viele
-- NULLs in derselben Spalte (Standard-SQL-NULL-Semantik), das Verhalten aendert
-- sich also nicht -- nur der Index wird jetzt ON CONFLICT-tauglich.
drop index if exists public.messages_instantly_email_id_ux;
create unique index messages_instantly_email_id_ux
  on public.messages (workspace_id, instantly_email_id);
