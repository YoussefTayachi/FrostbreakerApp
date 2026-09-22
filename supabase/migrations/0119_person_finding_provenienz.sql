-- Provenienz, Deckel und Zustaende fuer den Personen-Befund (Fortsetzung von 0118).
--
-- ═══════════════════════════════════════════════════════════════════════
-- 1. PROVENIENZ: WOHER DER ABSATZ KOMMT
-- ═══════════════════════════════════════════════════════════════════════
--
-- 0118 speicherte nur den Text, den Status und ein Pruefflag. Damit kann
-- spaeter niemand eine versendete Mail nachpruefen ("woher wisst ihr das?")
-- oder einen Absatz begruendet verwerfen. Deshalb je Kontakt ein JSON mit
-- dem ausgewaehlten Fund: angle, claim, source_kind, source_url,
-- source_label, age_months, verbatim, identity_anchor, identity_evidence,
-- review_reason, researched_at, model, attempts.
--
-- DATENSCHUTZ. Gespeichert wird ausschliesslich, was die Person selbst
-- oeffentlich veroeffentlicht hat (Beitrag, Interview, Podcast, das von ihr
-- gepflegte Profil), mit der URL der Quelle. Nichts Privates: der
-- Recherche-Prompt schliesst Familie, Gesundheit, Politik, Religion und
-- Hobbys aus, und die Auswahl im Code laesst nur berufliche Typen zu. Die
-- Zeile haengt am Kontakt und verschwindet mit ihm: contacts -> businesses
-- -> searches kaskadieren seit 0001. Aufbewahrung: so lange der Nutzer die
-- Suche behaelt, auch im Papierkorb; endgueltiges Loeschen raeumt auf.
-- Dieselbe Regel gilt heute fuer company_summary, website_audit und
-- website_finding. Keine automatische Verfallszeit.
alter table public.contacts
  add column person_finding_source jsonb;

comment on column public.contacts.person_finding_source is
  'Der ausgewaehlte Fund hinter person_finding: Quelle, URL, Alter, Anker, Grund einer Pruefung. Nur oeffentlich Veroeffentlichtes.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. EIN ZUSTAND MEHR: WEGEN DES DECKELS NICHT RECHERCHIERT
-- ═══════════════════════════════════════════════════════════════════════
--
-- Ohne ihn blieben Kontakte, die der Deckel abgeschnitten hat, still auf
-- null stehen, und der Kampagnen-Torwart koennte "nie angefragt" nicht von
-- "wegen Limit uebersprungen" unterscheiden.
alter table public.contacts drop constraint contacts_person_finding_status_check;
alter table public.contacts
  add constraint contacts_person_finding_status_check
  check (person_finding_status in ('pending', 'running', 'found', 'none', 'failed', 'skipped_limit'));

-- ═══════════════════════════════════════════════════════════════════════
-- 3. DER CLAIM MIT DECKEL, IN EINER FUNKTION
-- ═══════════════════════════════════════════════════════════════════════
--
-- Jede Person kostet eine Websuche. Der Deckel je Suche (p_limit, im Worker
-- 300) begrenzt, was eine versehentlich grosse Liste kosten kann. Zaehlen
-- und Setzen muessen ZUSAMMEN laufen: zwei Firmen-Jobs derselben Suche
-- laufen auf zwei Worker-Repliken gleichzeitig, und ein einzelnes Statement
-- serialisiert nicht. Deshalb ein Advisory Lock auf die Suche, der mit der
-- Transaktion endet.
--
-- Zugehoerigkeit wird geprueft und nicht vorausgesetzt: die Firma muss zum
-- Workspace gehoeren, die Kontakte zur Firma UND zum Workspace. Fremde ids
-- werden ignoriert, nicht gesetzt. Aufgerufen wird die Funktion nur vom
-- Worker mit dem Service-Role-Key; Execute ist fuer alle anderen Rollen
-- entzogen, nach demselben Muster wie 0002 und 0081.
--
-- Rueckgabe: die ids, die auf 'pending' gesetzt wurden. Nur die reiht der
-- Worker ein. Was nicht mehr unter den Deckel passte, steht auf
-- 'skipped_limit'.
create or replace function public.claim_person_finding_contacts(
  p_workspace uuid,
  p_business uuid,
  p_contact_ids uuid[],
  p_limit int
) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  v_search uuid;
  v_used int;
  v_room int;
  v_claimed uuid[];
begin
  select b.search_id into v_search
    from public.businesses b
   where b.id = p_business
     and b.workspace_id = p_workspace;
  if v_search is null then
    return array[]::uuid[];
  end if;

  perform pg_advisory_xact_lock(hashtext(v_search::text));

  -- Was schon Arbeit ausgeloest hat oder auslöst: alles ausser null und
  -- ausser den bereits uebersprungenen. Uebersprungene verbrauchen keinen
  -- Platz, sonst wuerde eine zweite Runde denselben Deckel zweimal treffen.
  select count(*) into v_used
    from public.contacts c
    join public.businesses b on b.id = c.business_id
   where b.search_id = v_search
     and c.workspace_id = p_workspace
     and c.person_finding_status is not null
     and c.person_finding_status <> 'skipped_limit';
  v_room := greatest(p_limit - v_used, 0);

  with kandidaten as (
    select c.id
      from public.contacts c
     where c.id = any(p_contact_ids)
       and c.workspace_id = p_workspace
       and c.business_id = p_business
       and c.person_finding_status is null
     order by c.is_primary desc nulls last, c.created_at
  ),
  gewinner as (
    select id from kandidaten limit v_room
  ),
  gesetzt as (
    update public.contacts c
       set person_finding_status = 'pending'
      from gewinner g
     where c.id = g.id
    returning c.id
  ),
  rest as (
    update public.contacts c
       set person_finding_status = 'skipped_limit'
     where c.id in (select id from kandidaten)
       and c.id not in (select id from gewinner)
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_claimed from gesetzt;

  return v_claimed;
end;
$$;

revoke execute on function public.claim_person_finding_contacts(uuid, uuid, uuid[], int)
  from public, anon, authenticated;
grant execute on function public.claim_person_finding_contacts(uuid, uuid, uuid[], int)
  to service_role;
