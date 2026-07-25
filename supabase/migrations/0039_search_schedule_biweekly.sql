-- Lead-Abo: zusaetzliches Intervall "alle zwei Wochen".
-- Woechentlich ist fuer viele Nischen zu dicht, monatlich zu duenn.
-- Die Pruefregel aus 0010 wird ersetzt statt dort editiert.
alter table public.searches drop constraint if exists searches_schedule_check;
alter table public.searches add constraint searches_schedule_check
  check (schedule in ('none','daily','weekly','biweekly'));
