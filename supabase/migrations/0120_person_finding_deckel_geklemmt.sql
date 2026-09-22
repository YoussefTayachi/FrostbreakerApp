-- Der Deckel je Suche wird in der Funktion selbst geklemmt, nicht vom Aufrufer.
--
-- Gefunden im Codex-Review nach dem Bau (2026-09-22): 0119 nahm p_limit
-- ungeprueft entgegen. Die Funktion ist die Stelle, an der der Deckel
-- durchgesetzt wird; wer ihr 100000 uebergibt, sei es ein Fehler im Worker
-- oder ein spaeterer Umbau, loest sonst unbegrenzt bezahlte Websuchen aus.
-- security definer schuetzt davor nicht, weil der Aufrufer ohnehin der
-- Service-Role-Key ist. Also: least(greatest(p_limit, 0), 300), und 300 steht
-- damit an genau einer Stelle hart.
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
  v_limit int;
  v_claimed uuid[];
begin
  v_limit := least(greatest(coalesce(p_limit, 0), 0), 300);

  select b.search_id into v_search
    from public.businesses b
   where b.id = p_business
     and b.workspace_id = p_workspace;
  if v_search is null then
    return array[]::uuid[];
  end if;

  perform pg_advisory_xact_lock(hashtext(v_search::text));

  select count(*) into v_used
    from public.contacts c
    join public.businesses b on b.id = c.business_id
   where b.search_id = v_search
     and c.workspace_id = p_workspace
     and c.person_finding_status is not null
     and c.person_finding_status <> 'skipped_limit';
  v_room := greatest(v_limit - v_used, 0);

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
