-- Cron-Intervall von alle 5 Minuten auf jede Minute verkuerzt. Der Rate-Limit-
-- Engpass (20 Req/Min bei Instantly) besteht weiterhin und gilt weiterhin pro
-- Workspace (jeder Kunde bringt seinen eigenen Instantly-Key mit, BYOK) -- das
-- aendert sich hier nicht. Was sich aendert: bisher lag zwischen zwei Batches
-- 5 Minuten Leerlauf, obwohl das Limit in dieser Zeit laengst wieder frei war.
-- Bei vielen Postfaechern in einem Workspace (z.B. Agentur-Kunden) sinkt der
-- Worst-Case fuer ein einzelnes Postfach dadurch von ~15 auf ~2-3 Minuten.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'instantly-sync'),
  schedule := '* * * * *'
);
