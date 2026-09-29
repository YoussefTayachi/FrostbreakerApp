-- Personen-Befund je Workspace: 'openai' (Worker recherchiert per OpenAI-
-- Websuche) oder 'claude' (Claude mit Aside auf Youssefs Rechner, siehe 0125).
--
-- Youssef am 2026-09-29 nach dem Aside-Test (10 von 10 versandbereit, 0 $
-- OpenAI): "ab jetzt immer ohne OpenAI und nur noch mit Aside". Das gilt fuer
-- seinen Workspace retaiyn, nicht fuer alle: andere Workspaces haben kein
-- Aside, dort wuerden die Leads sonst ewig warten. filters.person_findings_mode
-- an der Suche geht weiterhin vor.
alter table public.workspaces
  add column if not exists person_findings_mode text not null default 'openai'
  check (person_findings_mode in ('openai', 'claude'));

comment on column public.workspaces.person_findings_mode is
  'Wer Personen recherchiert: openai (Worker) oder claude (Aside, Migration 0125). Suche kann per filters.person_findings_mode abweichen.';

update public.workspaces set person_findings_mode = 'claude'
 where id = '82aa389f-6574-4822-9223-e138383836d8';
