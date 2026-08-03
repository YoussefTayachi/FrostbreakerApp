-- Mehrkanal-Akquise: Aktivitaeten bekommen einen Kanal.
--
-- Ausgangslage: contacts fuehrt seit Migration 0001 die Spalten linkedin,
-- twitter, instagram, facebook und (seit 0008) phone. Alle drei Pipelines
-- befuellen sie -- Apollo (apollo.py:316), die KI-Websuche
-- (find_decisionmaker.py:129) und Hunter (hunt_persons.py:53). Gemessen am
-- Bestand vom 2026-08-03, 2.625 Kontakte:
--
--   E-Mail    920      Twitter/X   58
--   LinkedIn  908      Instagram   16
--   Telefon   318      Facebook     5
--
-- 230 Kontakte haben AUSSCHLIESSLICH LinkedIn und kein E-Mail-Feld -- fuer die
-- App bisher tote Datensaetze, obwohl ihre Recherche bezahlt ist. 214 davon
-- haben bereits einen fertigen Icebreaker in businesses.personalization
-- liegen. Es fehlte also nie die Information, nur der Ort, an dem eine
-- Kontaktaufnahme ausserhalb von E-Mail festgehalten werden kann.
--
-- WARUM EINE EIGENE SPALTE UND KEIN NEUER type-WERT:
-- activities.type beschreibt die FORM der Interaktion (Anruf, Termin,
-- Aufgabe), nicht das Medium. 'linkedin' als type einzutragen wuerde beides
-- vermischen: eine Aufgabe ist eine Aufgabe, unabhaengig davon, ob sie per
-- LinkedIn oder Telefon erledigt wird. Getrennt gehalten ist ein neuer Kanal
-- spaeter ein Wert in der CHECK-Liste und kein Umbau der Auswertungen.
--
--   LinkedIn-DM  -> type 'message', channel 'linkedin'
--   Anruf        -> type 'call',    channel 'phone'
--   Aufgabe      -> type 'task',    channel null (eine Aufgabe hat kein Medium)
--
-- Die Kanalliste enthaelt bewusst auch instagram/x/whatsapp, obwohl dort
-- kaum Daten liegen: der Wert kostet nichts, und wer einen Kontakt manuell
-- ueber Instagram anschreibt, soll das festhalten koennen, ohne dass dafuer
-- erst eine Migration noetig ist.
--
-- KEIN automatisierter Versand ueber diese Kanaele, und zwar nicht aus
-- Bequemlichkeit: LinkedIn hat keine API fuer Nachrichten oder Kontakt-
-- anfragen, jede Automatisierung laeuft ueber Browser-Steuerung und verstoesst
-- gegen die Nutzervereinbarung (Kontosperrung als Folge). WhatsApps Cloud API
-- verlangt fuer geschaeftlich initiierte Nachrichten ein vorheriges Opt-in,
-- Instagram erlaubt Nachrichten nur innerhalb von 24 Stunden NACHDEM der
-- Nutzer geschrieben hat. Versendet wird deshalb von Hand; die App bereitet
-- vor und protokolliert.

alter table public.activities
  add column channel text check (channel in (
    'email', 'phone', 'linkedin', 'whatsapp', 'instagram', 'x', 'in_person'
  ));

-- 'message' als vierter Typ: eine Direktnachricht ist weder Anruf noch Termin
-- noch geplante Aufgabe. Der bestehende Constraint muss dafuer weichen und neu
-- gesetzt werden -- Postgres kennt kein "check erweitern".
alter table public.activities drop constraint activities_type_check;
alter table public.activities
  add constraint activities_type_check
  check (type in ('call', 'meeting', 'task', 'message'));

-- Bestandsdaten: ein geloggter Anruf ist per Definition ueber das Telefon
-- gelaufen, der Kanal ist dort also nicht unbekannt, sondern nur bisher nicht
-- benannt. Bei 'meeting' bleibt er offen -- ein Termin kann vor Ort oder per
-- Video stattgefunden haben, und geraten waere schlechter als leer.
update public.activities set channel = 'phone' where type = 'call' and channel is null;

-- Fuer die Arbeitsliste unter /linkedin: alle Kontakte eines Workspace mit
-- Profil-URL. Ohne den Index ist das ein Seq Scan ueber contacts, der mit
-- jedem Suchlauf waechst.
create index contacts_workspace_linkedin_idx
  on public.contacts (workspace_id)
  where linkedin is not null;

-- Gegenstueck fuer die Frage "wurde dieser Kontakt schon ueber LinkedIn
-- angeschrieben" -- die Liste blendet Erledigte sonst nicht aus.
create index activities_workspace_channel_idx
  on public.activities (workspace_id, channel, contact_id)
  where channel is not null;

-- Nachrichtenvorlage fuer die LinkedIn-Arbeitsliste.
--
-- Als Spalte auf workspaces, gleiche Konvention wie personalization_prompt und
-- reply_notify_email: Einstellungen dieses Workspaces stehen dort, nicht in
-- einer eigenen Tabelle und erst recht nicht im Browser-Speicher (die Vorlage
-- soll geraetuebergreifend gelten).
--
-- Die Platzhalter heissen absichtlich exakt wie die Merge-Tags der
-- E-Mail-Kampagnen ({{firstName}}, {{companyName}}, {{personalization}}) --
-- wer eine Sequenz in Instantly geschrieben hat, muss fuer LinkedIn keine
-- zweite Schreibweise lernen. Null heisst "Standardvorlage aus dem Code
-- verwenden", damit eine spaetere Verbesserung der Vorgabe auch bei allen
-- ankommt, die nie etwas geaendert haben.
alter table public.workspaces add column linkedin_message_template text;

-- crm_timeline neu, unveraendert bis auf 'channel' im activity-Zweig.
-- Die Funktion wird komplett neu geschrieben statt gepatcht, weil
-- create or replace keinen anderen Weg kennt; inhaltlich ist der einzige
-- Unterschied die eine zusaetzliche Zeile in jsonb_build_object.
create or replace function public.crm_timeline(
  p_contact_id uuid default null,
  p_business_id uuid default null
)
returns jsonb language sql stable security definer set search_path = public as $$
with scope as (
  select
    coalesce(
      (select c.business_id from public.contacts c where c.id = p_contact_id),
      p_business_id
    ) as business_id,
    coalesce(
      (select c.workspace_id from public.contacts c where c.id = p_contact_id),
      (select b.workspace_id from public.businesses b where b.id = p_business_id)
    ) as workspace_id
),
authorized as (
  select s.business_id, s.workspace_id
  from scope s
  where s.workspace_id is not null and public.is_workspace_owner(s.workspace_id)
),
contact_ids as (
  select c.id
  from public.contacts c, authorized a
  where c.workspace_id = a.workspace_id
    and (
      (p_contact_id is not null and c.id = p_contact_id)
      or (p_contact_id is null and c.business_id = a.business_id)
    )
),
events as (
  select
    case when m.direction = 'inbound' then 'email_in' else 'email_out' end as kind,
    m.id,
    coalesce(m.sent_at, m.created_at) as at,
    m.contact_id,
    m.subject as title,
    m.body,
    jsonb_build_object('ai_interest', m.ai_interest, 'status', m.status) as meta
  from public.messages m
  where m.contact_id in (select id from contact_ids)

  union all

  select
    'note',
    n.id,
    n.created_at,
    n.contact_id,
    null::text,
    n.body,
    jsonb_build_object(
      'scope', case when n.business_id is not null then 'business' else 'contact' end,
      'author_email', (select u.email::text from auth.users u where u.id = n.author_user_id),
      'edited', n.updated_at > n.created_at
    )
  from public.notes n, authorized a
  where n.workspace_id = a.workspace_id
    and (n.contact_id in (select id from contact_ids) or n.business_id = a.business_id)

  union all

  select
    'status',
    h.id,
    h.changed_at,
    h.contact_id,
    null::text,
    null::text,
    jsonb_build_object(
      'old_status', h.old_status,
      'new_status', h.new_status,
      'automatic', h.changed_by is null
    )
  from public.contact_status_history h
  where h.contact_id in (select id from contact_ids)

  union all

  -- Aktivitaeten: geloggte Anrufe, Nachrichten, Termine und Aufgaben
  select
    'activity',
    act.id,
    coalesce(act.occurred_at, act.completed_at, act.due_at, act.created_at),
    act.contact_id,
    act.subject,
    act.note,
    jsonb_build_object(
      'type', act.type,
      'channel', act.channel,
      'outcome', act.outcome,
      'duration_seconds', act.duration_seconds,
      'due_at', act.due_at,
      'completed_at', act.completed_at,
      'scope', case when act.contact_id is null then 'business' else 'contact' end
    )
  from public.activities act, authorized a
  where act.workspace_id = a.workspace_id
    and (act.contact_id in (select id from contact_ids) or act.business_id = a.business_id)

  union all

  select
    'deal',
    d.id,
    d.updated_at,
    d.contact_id,
    d.title,
    d.lost_reason,
    jsonb_build_object(
      'value', d.value,
      'currency', d.currency,
      'stage', d.stage,
      'status', d.status,
      'probability', d.probability,
      'expected_close_date', d.expected_close_date,
      'closed_at', d.closed_at
    )
  from public.deals d, authorized a
  where d.workspace_id = a.workspace_id
    and (d.contact_id in (select id from contact_ids) or d.business_id = a.business_id)
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'kind', e.kind,
      'id', e.id,
      'at', e.at,
      'contact_id', e.contact_id,
      'title', e.title,
      'body', e.body,
      'meta', e.meta
    ) order by e.at desc
  ),
  '[]'::jsonb
)
from events e;
$$;
revoke execute on function public.crm_timeline(uuid, uuid) from public, anon;
grant execute on function public.crm_timeline(uuid, uuid) to authenticated;
