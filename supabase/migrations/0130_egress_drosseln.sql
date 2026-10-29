-- EGRESS DROSSELN
--
-- Am 2026-10-28 um 23 Uhr Wiener Zeit hat Supabase das Projekt gesperrt:
-- exceed_egress_quota, 8,99 von 5 GB im Free-Plan (Zyklus 02.10. bis 02.11.).
-- Danach antwortete jede Anfrage mit 402, auch der Login.
--
-- Gemessen in den 24 Stunden davor: rund 128.000 Anfragen an die REST-API,
-- jede einzelne klein. Die Last kam nicht aus einer Codeaenderung (letzter
-- Commit 2026-10-01), sondern aus dem Wachstum: bis zum 22.09. kamen der
-- dritte und vierte Workspace mit Instantly-Key und 18 IMAP-Postfaecher dazu,
-- und der Sync macht seine Arbeit je Workspace und Minute.
--
-- Hier die Haelfte, die in der Datenbank liegt. Der Worker pollt zusaetzlich
-- im Leerlauf seltener (apps/worker/worker/main.py, IDLE_POLL_MAX_S).

-- Instantly-Sync alle zwei statt jede Minute (vorher Migration 0043). Die
-- Route rechnet ihre Seitenrotation mit SYNC_TICK_MINUTES, beide Werte
-- muessen zusammen geaendert werden.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'instantly-sync'),
  schedule := '*/2 * * * *'
);

-- Worker-Skalierung alle zwei Minuten (vorher Migration 0110). Hochfahren
-- dauert damit hoechstens eine Minute laenger; ein Railway-Rollout braucht
-- ohnehin ein bis drei.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'worker-ops'),
  schedule := '*/2 * * * *'
);

-- Das Protokoll der Cron-Laeufe waechst ohne Ende: 114 MB am 2026-10-29,
-- groesste Tabelle der Datenbank (Free-Plan: 0,5 GB). Kostet keinen Egress,
-- aber Plattenplatz. Drei Tage reichen zur Fehlersuche.
delete from cron.job_run_details where end_time < now() - interval '3 days';

select cron.schedule(
  'cron-protokoll-kuerzen',
  '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$
);
