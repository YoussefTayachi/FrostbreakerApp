-- Loest den lokal laufenden Python-Worker fuer Instantly-Polling ab (siehe
-- apps/web/app/api/cron/instantly-sync/route.ts): pg_cron ruft alle 5 Minuten
-- per pg_net die Route auf, unabhaengig davon ob irgendjemand einen Worker
-- laufen hat. Das eigentliche Secret liegt in supabase_vault (Name
-- 'cron_secret', einmalig per execute_sql angelegt, nicht in dieser Datei --
-- landet sonst im Git-Verlauf) und wird hier nur per Name referenziert.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'instantly-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://system3-app.vercel.app/api/cron/instantly-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
