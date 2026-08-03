-- Pipeline-Zeilen: alles, was die Liste braucht, in einer Abfrage.
--
-- Ausgangslage: Die Pipeline war eine Insel. Das Board zeigte Name, Titel und
-- Firma -- mehr nicht. Wer jemanden anrufen wollte, musste die Nummer
-- woanders suchen; wie und wann zuletzt Kontakt bestand, stand nur in der
-- Timeline im aufgeklappten Drawer; und ein dort geplanter Rueckruf tauchte
-- zwar in /calls auf, aber davon war in der Pipeline nichts zu sehen. Drei
-- Ansichten fuer denselben Vorgang, ohne sichtbare Verbindung.
--
-- Diese Funktion liefert je Kontakt zusaetzlich:
--
--   * die Kontaktwege (E-Mail, Telefon, LinkedIn) -- liegen laengst in
--     contacts, wurden in der Pipeline nur nie angezeigt
--   * die Lead-Liste, aus der er stammt, zum Gruppieren wie unter /linkedin
--   * wann und WORUEBER zuletzt hinausgegangen wurde
--   * wann er zuletzt geantwortet hat
--   * den naechsten offenen Termin -- dieselbe Zeile, die /calls anzeigt
--
-- Als Funktion und nicht als Abfrage im Frontend, weil "letzte Beruehrung" und
-- "naechster Termin" sonst je Kontakt eine eigene Abfrage waeren. Bei tausend
-- Kontakten waeren das zweitausend Rundreisen; hier sind es zwei Lateral-Joins
-- im selben Plan.

/**
 * p_limit deckelt die Menge, damit die Seite bei einem grossen Bestand nicht
 * unbedienbar wird. Sortiert wird nach zuletzt angelegt, wie bisher im Board.
 */
create or replace function public.pipeline_rows(
  p_workspace_id uuid,
  p_limit integer default 1000
)
returns jsonb language sql stable security definer set search_path = public as $$
with ws as (
  select p_workspace_id as id where public.is_workspace_owner(p_workspace_id)
),
base as (
  select
    c.id,
    c.full_name,
    c.first_name,
    c.last_name,
    c.title,
    c.email,
    c.phone,
    c.linkedin,
    c.outreach_status,
    c.business_id,
    c.created_at,
    b.name          as company_name,
    b.website       as company_website,
    s.id            as list_id,
    coalesce(s.name, s.query) as list_name,
    s.location      as list_location,
    s.source        as list_source
  from public.contacts c
  join ws on ws.id = c.workspace_id
  join public.businesses b on b.id = c.business_id
  left join public.searches s on s.id = b.search_id
  -- Papierkorb: Kontakte aus geloeschten Suchen fliegen raus, ABER nur solange
  -- sie unberuehrt sind. Wer schon geantwortet hat oder einen Termin hat, ist
  -- ein echter Interessent und darf nicht verschwinden, bloss weil die Liste,
  -- aus der er einmal stammte, im Papierkorb liegt. Genau das waere sonst der
  -- Preis dafuer, dass die Pipeline jetzt nach Liste gruppiert.
  where s.deleted_at is null or c.outreach_status <> 'new'
  order by c.created_at desc
  limit greatest(p_limit, 1)
)
select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
from (
  select
    base.*,
    -- Zuletzt HINAUS: die letzte eigene Kontaktaufnahme, egal ueber welchen
    -- Weg. Aktivitaeten (Anruf, LinkedIn-Nachricht, Termin) und ausgehende
    -- Mails werden dafuer zusammengeworfen und die juengste gewinnt -- fuer die
    -- Frage "wann habe ich den zuletzt angefasst" ist der Kanal ein Detail,
    -- keine eigene Kategorie.
    out_touch.at        as last_touch_at,
    out_touch.channel   as last_touch_channel,
    -- Zuletzt HEREIN: getrennt gefuehrt, weil "ich habe geschrieben" und "er
    -- hat geantwortet" beim Abarbeiten zwei voellig verschiedene Dinge sind.
    (select max(coalesce(m.sent_at, m.created_at))
       from public.messages m
      where m.contact_id = base.id and m.direction = 'inbound') as last_reply_at,
    -- Naechster offener Termin: exakt der Zuschnitt, den /calls anzeigt
    -- (offen, mit Faelligkeit). Dadurch kann die Pipeline zeigen, was dort
    -- ansteht, ohne eine zweite Wahrheit zu erfinden.
    due.due_at          as next_due_at,
    due.subject         as next_due_subject,
    due.channel         as next_due_channel,
    due.type            as next_due_type
  from base
  left join lateral (
    select t.at, t.channel from (
      select a.occurred_at as at, a.channel
        from public.activities a
       where a.contact_id = base.id and a.occurred_at is not null
      union all
      select coalesce(m.sent_at, m.created_at) as at, 'email' as channel
        from public.messages m
       where m.contact_id = base.id and m.direction = 'outbound'
    ) t
    where t.at is not null
    order by t.at desc
    limit 1
  ) out_touch on true
  left join lateral (
    select a.due_at, a.subject, a.channel, a.type
      from public.activities a
     where a.contact_id = base.id
       and a.completed_at is null
       and a.due_at is not null
     order by a.due_at asc
     limit 1
  ) due on true
) x;
$$;
revoke execute on function public.pipeline_rows(uuid, integer) from public, anon;
grant execute on function public.pipeline_rows(uuid, integer) to authenticated;
