-- Personen-Befund von aussen: Claude mit Aside recherchiert, der Worker prueft.
--
-- Listen mit filters.person_findings_mode = 'claude' reihen keine OpenAI-
-- Recherche ein. Die Kontakte warten stattdessen auf 'awaiting_research',
-- bis eine Claude-Code-Sitzung auf Youssefs Rechner sie ueber das
-- Frostbreaker-MCP abholt (get_research_queue) und Fund samt Schnipseln
-- abliefert (set_person_findings, Status 'submitted'). Der Worker-Job
-- validate_person_snippets prueft ohne Modellaufruf und setzt 'found'.
-- Seit 2026-09-29, Youssef: "komplett ohne OpenAI".
alter table public.contacts drop constraint contacts_person_finding_status_check;
alter table public.contacts
  add constraint contacts_person_finding_status_check
  check (person_finding_status in (
    'pending', 'running', 'found', 'none', 'failed', 'skipped_limit', 'awaiting_research', 'submitted'
  ));

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
    'write_person_finding',
    'validate_person_snippets',
    'sync_sent',
    'send_batch',
    'poll_inbox',
    'poll_instantly'
  ));
