-- Jobtyp reveal_emails: E-Mails erst nach der Recherche freischalten.
--
-- Teil des Modus "erst pruefen, dann freischalten" (searches.filters.verify_first,
-- 2026-10-01). Gemessen an fuenf retaiyn-Suchen vom 2026-09-30: 2333 Apollo-
-- Credits fuer 492 versandbereite Leads (4,7 je Lead). Mit dem neuen Ablauf
-- wird nur noch fuer Kontakte mit freigegebenem Befund bezahlt, je 1 Credit.
-- Siehe apps/worker/worker/pipelines/reveal_emails.py.

alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type = any (array[
  'get_businesses', 'find_decisionmaker', 'hunt_persons', 'personalize',
  'check_website', 'browser_check', 'write_website_finding',
  'confirm_website_unreachable', 'write_person_finding',
  'validate_person_snippets', 'sync_sent', 'send_batch', 'poll_inbox',
  'poll_instantly', 'reveal_emails'
]));
