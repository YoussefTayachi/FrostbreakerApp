-- Haertung + UI-Anbindung fuer den Lead-Cap aus 0025.
--
-- qualified_lead_count_this_month(uuid) nimmt bisher eine beliebige owner_id
-- entgegen und ist an "authenticated" granted -- jeder eingeloggte User
-- koennte damit die monatliche Lead-Zahl eines fremden Accounts erfragen,
-- wenn er dessen UUID kennt/erraet. Das Execute-Recht wird entzogen; die
-- interne Nutzung durch under_lead_cap() (Teil der RLS-Policy auf searches)
-- bleibt unberuehrt, weil SECURITY DEFINER-Funktionen intern mit den Rechten
-- des Funktions-Eigentuemers laufen, nicht mit denen des urspruenglichen
-- Aufrufers -- under_lead_cap() braucht dafuer kein eigenes Execute-Recht auf
-- die innere Funktion.
revoke execute on function public.qualified_lead_count_this_month(uuid) from authenticated;

-- Fuer die UI (Fortschrittsanzeige "X / 5.000 Leads diesen Monat" in den
-- Einstellungen): parameterlose Variante, die ausschliesslich den eigenen
-- Account des eingeloggten Users abfragt -- kein Missbrauchspotenzial, weil
-- kein Parameter uebergeben werden kann.
create or replace function public.my_qualified_lead_count()
returns bigint language sql stable security definer set search_path = public as $$
  select public.qualified_lead_count_this_month(auth.uid());
$$;
revoke execute on function public.my_qualified_lead_count() from public, anon;
grant execute on function public.my_qualified_lead_count() to authenticated;
