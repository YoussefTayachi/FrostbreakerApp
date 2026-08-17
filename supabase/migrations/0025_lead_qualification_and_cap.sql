-- Qualifizierte Leads (personenbezogene statt generische E-Mails wie info@/
-- office@) + monatlicher Lead-Cap fuers Starter-Paket (5.000 qualifizierte
-- Firmen/Monat, Agentur unlimitiert). Preis-Update: Starter 99 Euro, Agentur
-- 199 Euro -- "unlimitiert echte Ansprechpartner" ist der Kernunterschied.

-- Klassifizierung wird vom Worker gesetzt: Hunter liefert das Feld direkt
-- mit (type: personal/generic), bei der KI-Websuche per Praefix-Heuristik.
-- Generische Treffer werden im Worker gar nicht erst gespeichert (siehe
-- hunt_persons.py/find_decisionmaker.py) -- die Spalte existiert trotzdem als
-- expliziter Wert statt nur "email vorhanden ja/nein", falls sich das
-- Filterverhalten spaeter mal aendern soll.
alter table public.contacts
  add column if not exists email_type text check (email_type in ('personal', 'generic'));

-- Zaehleinheit ist die FIRMA, nicht der einzelne Kontakt -- eine Firma mit
-- zwei gefundenen Personen zaehlt einmal als "eine erreichbare Firma".
create or replace function public.qualified_lead_count_this_month(p_owner_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(distinct b.id)
  from public.businesses b
  join public.workspaces w on w.id = b.workspace_id
  join public.contacts c on c.business_id = b.id
  where w.owner_id = p_owner_id
    and c.email_type = 'personal'
    and b.created_at >= date_trunc('month', now());
$$;
revoke execute on function public.qualified_lead_count_this_month(uuid) from public, anon;
grant execute on function public.qualified_lead_count_this_month(uuid) to authenticated;

create or replace function public.under_lead_cap(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select s.plan from public.subscriptions s where s.owner_id = p_owner_id) = 'agency' then true
    else public.qualified_lead_count_this_month(p_owner_id) < 5000
  end;
$$;
revoke execute on function public.under_lead_cap(uuid) from public, anon;
grant execute on function public.under_lead_cap(uuid) to authenticated;

-- searches_owner_insert (0024) um den Lead-Cap erweitern -- gleiche Stelle,
-- gleiches Prinzip wie die Trial-Sperre, nur ein zusaetzliches Kriterium.
drop policy if exists searches_owner_insert on public.searches;
create policy searches_owner_insert on public.searches for insert
  with check (
    public.is_workspace_owner(workspace_id)
    and public.has_active_subscription((select w.owner_id from public.workspaces w where w.id = workspace_id))
    and public.under_lead_cap((select w.owner_id from public.workspaces w where w.id = workspace_id))
  );
