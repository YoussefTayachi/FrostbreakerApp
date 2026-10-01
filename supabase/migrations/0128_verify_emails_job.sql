-- Jobtyp verify_emails: Adressen einer Liste automatisch per NeverBounce
-- pruefen, Catch-all-Firmen in eine eigene Liste "<Name> | Catch-all".
--
-- Anlass, gemessen am 2026-10-01 im Workspace retaiyn: 2663 von 2886 Adressen
-- trugen nur Apollos eigenes 'verified', keine einzige war je live geprueft.
-- Testlauf mit 10 davon: 4 valid, 5 catchall, 1 unknown, 0 invalid.
-- Youssef am selben Tag: "automatisch pruefen, catchall in eigene kampagne".
--
-- Opt-in je Workspace, weil jede Pruefung ein NeverBounce-Credit des Kunden
-- ist. Siehe apps/worker/worker/pipelines/verify_emails.py.

alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type = any (array[
  'get_businesses', 'find_decisionmaker', 'hunt_persons', 'personalize',
  'check_website', 'browser_check', 'write_website_finding',
  'confirm_website_unreachable', 'write_person_finding',
  'validate_person_snippets', 'sync_sent', 'send_batch', 'poll_inbox',
  'poll_instantly', 'reveal_emails', 'verify_emails'
]));

alter table public.workspaces
  add column if not exists auto_verify_emails boolean not null default false;

comment on column public.workspaces.auto_verify_emails is
  'Jede fertige Liste automatisch per NeverBounce pruefen und Catch-all-Firmen in eine eigene Liste verschieben (Migration 0128).';

update public.workspaces set auto_verify_emails = true
 where id = '82aa389f-6574-4822-9223-e138383836d8';
