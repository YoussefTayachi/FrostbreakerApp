-- Gesperrte Absender zaehlen nicht mehr als ungelesen.
--
-- Der Befund (2026-08-12, im Produktivstand nachgemessen): das Inbox-Badge
-- stand auf 2, die Inbox selbst zeigte nichts Ungelesenes. Beide Nachrichten
-- waren Abmeldungen -- jemand hat "stop" geantwortet, suppressOnOptOut hat die
-- Adresse in die Sperrliste geschrieben, und seitdem blendet
-- lib/suppression.ts::filterSuppressed die Konversation in der Inbox aus.
-- Als gelesen markiert wurde sie nie.
--
-- Damit zaehlte das Badge (serverseitiger count ueber alle eingehenden
-- Nachrichten ohne read_at) etwas, das der Nutzer gar nicht mehr oeffnen kann.
-- Eine Zahl, die sich nicht wegklicken laesst, ist schlimmer als keine Zahl:
-- nach dem dritten Mal sieht man das Badge nicht mehr an.
--
-- Die Regel steht ab jetzt in der Datenbank und nicht in einer der Routen:
-- WER AUF DER SPERRLISTE STEHT, DESSEN EINGAENGE SIND GELESEN. Zwei Ausloeser,
-- weil beide Reihenfolgen vorkommen --
--   1. Nachricht ist schon da, Sperre kommt dazu (der normale Abmeldefall:
--      der Sync schreibt erst die Nachricht, 0,5 s spaeter die Sperre),
--   2. Sperre ist schon da, Nachricht kommt dazu (zweite "stop"-Mail derselben
--      Adresse -- der Upsert mit ignoreDuplicates legt dann keine neue Zeile
--      an, Ausloeser 1 feuert also nicht).
--
-- In der Route allein waere die Regel unvollstaendig: die Sperrliste wird auch
-- ueber app/api/unsubscribe und die Blockliste in den Einstellungen gefuellt.

-- Der Domain-Vergleich spiegelt domainOf() aus lib/suppression.ts: Teil hinter
-- dem @, kleingeschrieben, fuehrendes "www." weg.
create or replace function public.suppression_matches_email(
  p_email text,
  p_supp_email text,
  p_supp_domain text
) returns boolean
language sql
immutable
as $$
  select
    (p_supp_email is not null and lower(p_email) = lower(p_supp_email))
    or (
      p_supp_domain is not null
      and regexp_replace(lower(split_part(p_email, '@', 2)), '^www\.', '')
        = regexp_replace(lower(p_supp_domain), '^www\.', '')
      and split_part(p_email, '@', 2) <> ''
    );
$$;

-- Ausloeser 1: neue Sperre -- alles Ungelesene dieser Adresse abhaken.
create or replace function public.mark_suppressed_messages_read()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages m
     set read_at = now()
   where m.workspace_id = new.workspace_id
     and m.direction = 'inbound'
     and m.read_at is null
     and m.from_email is not null
     and public.suppression_matches_email(m.from_email, new.email, new.domain);
  return new;
end;
$$;

drop trigger if exists suppression_marks_messages_read on public.suppression_list;
create trigger suppression_marks_messages_read
  after insert on public.suppression_list
  for each row execute function public.mark_suppressed_messages_read();

-- Ausloeser 2: neue Nachricht von einer bereits gesperrten Adresse.
create or replace function public.mark_message_read_if_suppressed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction = 'inbound' and new.read_at is null and new.from_email is not null then
    if exists (
      select 1 from public.suppression_list s
       where s.workspace_id = new.workspace_id
         and public.suppression_matches_email(new.from_email, s.email, s.domain)
    ) then
      new.read_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists message_read_if_suppressed on public.messages;
create trigger message_read_if_suppressed
  before insert on public.messages
  for each row execute function public.mark_message_read_if_suppressed();

-- Einmalig aufraeumen, was sich bis heute angesammelt hat.
update public.messages m
   set read_at = now()
  from public.suppression_list s
 where s.workspace_id = m.workspace_id
   and m.direction = 'inbound'
   and m.read_at is null
   and m.from_email is not null
   and public.suppression_matches_email(m.from_email, s.email, s.domain);
