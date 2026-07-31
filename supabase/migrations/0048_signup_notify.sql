-- Slack-Benachrichtigung bei jeder neuen Anmeldung. handle_new_user() (0024)
-- feuert zusaetzlich zu Workspace/Subscription-Anlage einen asynchronen
-- pg_net-POST an die interne Route api/internal/notify-signup, die den
-- eigentlichen Slack-Webhook aufruft (Secret bleibt in Vercel-Env, nicht in
-- der DB). Das Bearer-Secret fuer den Aufruf liegt in supabase_vault (Name
-- 'internal_notify_secret', per execute_sql angelegt, nicht hier -- landet
-- sonst im Git-Verlauf), gleiche Konvention wie cron_secret (0041).
--
-- Der Notify-Call steht in einem eigenen BEGIN/EXCEPTION-Block: schlaegt er
-- fehl (Vault-Eintrag fehlt noch, Netzproblem), darf das den eigentlichen
-- Signup trotzdem nicht verhindern.
create extension if not exists pg_net;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspaces (owner_id, name) values (new.id, 'Mein Workspace');
  insert into public.subscriptions (owner_id) values (new.id);

  begin
    perform net.http_post(
      url := 'https://system3-app.vercel.app/api/internal/notify-signup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'internal_notify_secret')
      ),
      body := jsonb_build_object('email', new.email)
    );
  exception when others then
    null; -- Benachrichtigung ist best-effort, siehe Kommentar oben
  end;

  return new;
end;
$$;
