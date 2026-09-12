-- 'sync_sent' fehlte im CHECK-Constraint von jobs.type.
--
-- GEFUNDEN BEIM ERSTEN ECHTEN LAUF, 2026-09-12. Die Funktion aus 0114 war
-- richtig, die Tabelle liess den Jobtyp nur nicht zu:
--
--   ERROR: new row for relation "jobs" violates check constraint
--          "jobs_type_check"
--
-- Der Fehler war unsichtbar, und das ist der lehrreiche Teil: pg_cron ruft
-- enqueue_sent_sync() ohne Empfaenger auf. Die Ausnahme landet in
-- cron.job_run_details und sonst nirgends. Der Cron stand auf active, die
-- Postfaecher waren verbunden, und trotzdem waere nie ein Job entstanden.
-- Aufgefallen ist es nur, weil die Funktion einmal von Hand aufgerufen wurde.
--
-- Die beiden Jobtypen der nie gebauten Phase 3 ('send_batch', 'poll_inbox')
-- und der abgeloeste 'poll_instantly' bleiben absichtlich in der Liste: es
-- gibt 0 Zeilen damit, und ein Constraint zurueckzubauen ist mehr Risiko als
-- Nutzen (dieselbe Ueberlegung wie bei 'anthropic' in api_keys, siehe
-- app/api/keys/route.ts).
alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs
  add constraint jobs_type_check check (type in (
    'get_businesses',
    'find_decisionmaker',
    'hunt_persons',
    'personalize',
    'check_website',
    'browser_check',
    'write_website_finding',
    'confirm_website_unreachable',
    -- Der Gesendet-Ordner per IMAP, siehe 0114 und
    -- worker/pipelines/sync_sent.py.
    'sync_sent',
    'send_batch',
    'poll_inbox',
    'poll_instantly'
  ));
