-- Nachtrag zu 0032: Trigger-Funktionen gehoeren nicht in die REST-API.
--
-- Supabase exponiert jede Funktion im public-Schema als /rest/v1/rpc/<name>.
-- log_contact_status_change() war dadurch fuer anon und authenticated aufrufbar
-- (Security-Advisor 0028/0029). Ein direkter Aufruf wuerde am fehlenden
-- Trigger-Kontext scheitern, aber eine SECURITY-DEFINER-Funktion, die niemand
-- von aussen aufrufen soll, braucht auch kein EXECUTE-Recht von aussen.
--
-- Der Trigger selbst laeuft unabhaengig davon weiter: er wird im Kontext des
-- Tabelleneigentuemers ausgefuehrt, nicht mit den Rechten des Aufrufers.
revoke execute on function public.log_contact_status_change() from public, anon, authenticated;

-- Gleiche Klasse, schon vor diesem Branch vorhanden (Trigger aus 0017a):
-- ebenfalls eine reine Trigger-Funktion ohne Grund fuer externes EXECUTE.
revoke execute on function public.prevent_delete_last_workspace() from public, anon, authenticated;

-- Hinweis: crm_timeline() und crm_pipeline_stats() bleiben fuer authenticated
-- aufrufbar -- das ist beabsichtigt und der etablierte Weg in diesem Projekt
-- (wie dashboard_stats/search_overview). Beide pruefen intern
-- is_workspace_owner() und liefern fuer fremde Workspaces leere Ergebnisse.
