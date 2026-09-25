-- Wiederkontakt: Abwesende nicht verlieren, sondern nach der Rueckkehr
-- noch einmal anschreiben.
--
-- Bis hierher setzte eine Abwesenheitsnotiz den Kontakt auf 'replied', und
-- 'replied' gilt in lib/contacts.ts als "hat reagiert": der Kontakt fiel aus
-- jeder kuenftigen Kampagne. Gemessen am 2026-09-25 im retaiyn-Workspace:
-- 165 Abwesenheitsantworten seit dem 22.09., 81 davon mit Rueckkehrdatum,
-- keine davon je wieder angeschrieben.
--
-- Drei Teile: ein eigener Status 'out_of_office' (Rang wie 'contacted', also
-- weder Lead noch verbrannt), das Rueckkehrdatum am Kontakt, und die
-- Quellen 'reengage' (die Wiederkontakt-Liste je Woche und Absender) und
-- 'instantly_history' (Kontakte, die nur aus Instantlys alten Kampagnen
-- bekannt sind und in Frostbreaker nie angelegt wurden).

alter table public.contacts
  add column if not exists ooo_until date,
  add column if not exists ooo_seen_at timestamptz,
  add column if not exists ooo_estimated boolean not null default false,
  add column if not exists reengaged_from_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists reengaged_at timestamptz;

comment on column public.contacts.ooo_until is
  'Rueckkehrdatum aus der Abwesenheitsnotiz (lib/crm/ooo-date.ts); geschaetzt, wenn ooo_estimated.';
comment on column public.contacts.reengaged_from_contact_id is
  'Der Original-Kontakt, aus dem diese Kopie fuer die Wiederkontakt-Liste entstand.';
comment on column public.contacts.reengaged_at is
  'Am Original gesetzt, sobald eine Kopie in einer Wiederkontakt-Liste liegt; verhindert eine zweite Kopie.';

-- Rangfolge an drei Stellen gleich halten: lib/crm/stages.ts (STAGE_RANK),
-- app/api/cron/instantly-sync (STATUS_RANK) und hier.
alter table public.contacts drop constraint contacts_outreach_status_check;
alter table public.contacts
  add constraint contacts_outreach_status_check
  check (outreach_status in (
    'new', 'contacted', 'out_of_office', 'replied', 'lead', 'meeting_booked', 'customer', 'not_interested'
  ));

create index if not exists contacts_ooo_until_idx
  on public.contacts (workspace_id, ooo_until)
  where outreach_status = 'out_of_office';

alter table public.searches drop constraint if exists searches_source_check;
alter table public.searches add constraint searches_source_check
  check (source = any (array['maps', 'corporate', 'apollo', 'csv', 'prospeo', 'reengage', 'instantly_history']));

-- Jeden Montag 06:00 UTC (08:00 Wien): die Wiederkontakt-Listen der Woche
-- als Entwuerfe anlegen. Dieselbe Bauart wie worker-ops (0110).
select cron.schedule(
  'wiederkontakt',
  '0 6 * * 1',
  $$
  select net.http_post(
    url := 'https://system3-app.vercel.app/api/cron/wiederkontakt',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
