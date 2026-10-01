-- Gebouncte Adressen aus Instantly zurueckholen, statt vorab per NeverBounce
-- zu pruefen. Youssef am 2026-10-01: "geht es auch 100% kostenlos", danach
-- "bau beides, apollo verified filter und bounces".
--
-- bounces_synced_count haelt fest, bis zu welcher Bounce-Zahl einer Kampagne
-- die Adressen schon markiert sind. Der Cron (app/api/cron/instantly-sync)
-- fragt Instantly nur, wenn bounced_count darueber liegt. Default 0: beim
-- ersten Lauf werden auch alle bisherigen Bounces nachgeholt.
--
-- Gemessen, bevor die NeverBounce-Pruefung fuer retaiyn wieder abgeschaltet
-- wurde: 19 gepruefte Apollo-Adressen, 0 invalid. Der Apollo-Filter
-- (contact_email_status=verified, apps/worker/worker/pipelines/apollo.py)
-- traegt also; NeverBounce lieferte vor allem die Catch-all-Trennung.

alter table public.instantly_campaign_stats
  add column if not exists bounces_synced_count integer not null default 0;

comment on column public.instantly_campaign_stats.bounces_synced_count is
  'Bis zu dieser Bounce-Zahl sind die Adressen in contacts als invalid markiert (Migration 0129).';

update public.workspaces set auto_verify_emails = false
 where id = '82aa389f-6574-4822-9223-e138383836d8';
