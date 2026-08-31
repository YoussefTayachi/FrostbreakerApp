-- WORKER-SKALIERUNG UND WAECHTER IM MINUTENTAKT
--
-- Ruft apps/web/app/api/cron/worker-ops auf (gleiches Muster wie
-- instantly-sync, Migration 0041): pg_cron -> pg_net -> Vercel-Route, Auth
-- ueber das cron_secret aus supabase_vault.
--
-- Die Route macht zwei Dinge:
--   1. Skalieren: Railway-Replikzahl an der Queue-Tiefe ausrichten
--      (lib/worker-scale.ts). Abgerechnet wird bei Railway pro Minute
--      tatsaechlicher Nutzung; stossweises Hochfahren kostet dasselbe wie
--      langsames Durchlaufen, nur ohne das Warten.
--   2. Wachen: stille Ausfaelle melden (Browser-Fehlerquote, haengende
--      Jobs), als provider_alerts-Zeile mit provider 'worker'. Anlass: die
--      Browser-Stufe lief vom Einbau bis zum 2026-08-31 in Produktion NIE
--      (Playwright fehlte im Image), und niemand hat es gemerkt, weil der
--      Fehlschlag als Messergebnis gespeichert wird und kein Job scheitert.
--
-- Jede Minute statt alle fuenf: die Route ist billig (eine Zaehl-Query;
-- Railway wird nur bei einer Aenderung der Zielzahl angesprochen), und beim
-- Skalieren zaehlt die Reaktionszeit, sonst zahlt man Leerlauf.

select cron.schedule(
  'worker-ops',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://system3-app.vercel.app/api/cron/worker-ops',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
