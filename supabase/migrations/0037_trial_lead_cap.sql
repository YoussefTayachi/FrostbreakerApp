-- Eigener, kleinerer Lead-Cap fuer die Testphase (500 qualifizierte Firmen),
-- statt den Starter-Cap von 5.000/Monat auch waehrend des Trials gelten zu
-- lassen.
--
-- Hintergrund: bisher greift fuer Trial UND Starter derselbe Wert aus 0025.
-- Ein 14-Tage-Trial durfte damit faktisch so viel wie ein bezahlter Monat --
-- es gab also waehrend der Testphase keinen spuerbaren Grund umzusteigen.
--
-- Gezaehlt wird ab subscriptions.created_at, nicht ab Monatsbeginn: sonst
-- haette jemand, der am 28. startet, nach drei Tagen wieder das volle
-- Kontingent, und der Cap waere je nach Startdatum unterschiedlich streng.
--
-- Wie in 0025 ist die Zaehleinheit die FIRMA, nicht der einzelne Kontakt:
-- eine Firma mit zwei gefundenen Personen zaehlt einmal.

create or replace function public.qualified_lead_count_since_trial_start(p_owner_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(distinct b.id)
  from public.businesses b
  join public.workspaces w on w.id = b.workspace_id
  join public.contacts c on c.business_id = b.id
  where w.owner_id = p_owner_id
    and c.email_type = 'personal'
    and b.created_at >= (
      select s.created_at from public.subscriptions s where s.owner_id = p_owner_id
    );
$$;
-- Gleiche Absicherung wie bei qualified_lead_count_this_month in 0026: mit
-- freiem uuid-Parameter koennte sonst jeder eingeloggte User die Lead-Zahl
-- eines fremden Accounts erfragen. Nur under_lead_cap() nutzt sie intern,
-- und SECURITY DEFINER-Funktionen brauchen dafuer kein Execute-Recht.
revoke execute on function public.qualified_lead_count_since_trial_start(uuid) from public, anon, authenticated;

-- under_lead_cap() aus 0025 um den Trial-Zweig erweitern. Reihenfolge zaehlt:
-- 'agency' bleibt unlimitiert, 'trial' bekommt die 500, alles uebrige
-- (starter) behaelt unveraendert die 5.000/Monat.
create or replace function public.under_lead_cap(p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case (select s.plan from public.subscriptions s where s.owner_id = p_owner_id)
    when 'agency' then true
    when 'trial' then public.qualified_lead_count_since_trial_start(p_owner_id) < 500
    else public.qualified_lead_count_this_month(p_owner_id) < 5000
  end;
$$;
revoke execute on function public.under_lead_cap(uuid) from public, anon;
grant execute on function public.under_lead_cap(uuid) to authenticated;

-- Gegenstueck zu my_qualified_lead_count() aus 0026 fuer die Anzeige in den
-- Einstellungen: parameterlos, damit kein fremder Account abfragbar ist.
create or replace function public.my_trial_lead_count()
returns bigint language sql stable security definer set search_path = public as $$
  select public.qualified_lead_count_since_trial_start(auth.uid());
$$;
revoke execute on function public.my_trial_lead_count() from public, anon;
grant execute on function public.my_trial_lead_count() to authenticated;

-- Die RLS-Policy searches_owner_insert aus 0025 ruft under_lead_cap() auf und
-- bleibt dadurch unveraendert gueltig -- sie muss hier nicht neu geschrieben
-- werden, weil sich nur der Funktionsinhalt geaendert hat, nicht die Signatur.
