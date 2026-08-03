-- Guthaben-Wächter: aufgebrauchtes Anbieter-Kontingent sichtbar machen.
--
-- Am 2026-08-03 standen 467 fehlgeschlagene Jobs in der Warteschlange, 128
-- davon mit demselben Text: OpenAI meldete "You have no credits remaining".
-- Das Guthaben war leer, die App hat 128-mal weiter versucht, jeder Versuch
-- hat die Zustellversuche des Jobs aufgebraucht -- und niemand hat je eine
-- Meldung gesehen. Bei einem Produkt, dessen Kunden ihre eigenen Schluessel
-- mitbringen, ist das der wichtigste Ausfall ueberhaupt: laeuft fremdes
-- Guthaben aus, steht alles still, und es faellt erst auf, wenn eine Woche
-- Akquise fehlt.
--
-- Eine Zeile je Workspace und Anbieter, solange der Zustand anhaelt. Wird der
-- Alarm aufgeloest (Guthaben aufgeladen), bleibt die Zeile mit resolved_at
-- als Historie stehen -- "das ist uns schon dreimal passiert" ist eine
-- Information, die man haben will.
create table public.provider_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- 'openai' | 'hunter' | 'apollo' | 'google_maps' | 'neverbounce'
  provider text not null,
  -- Nur 'out_of_credit' loest Alarm aus. 'rate_limited' wird bewusst NICHT
  -- hier gefuehrt: eine Drosselung loest sich von allein, und eine Meldung
  -- darueber waere die Sorte Rauschen, die dazu erzieht, Meldungen zu
  -- ignorieren -- bis auch die ernste ueberlesen wird.
  kind text not null check (kind in ('out_of_credit')),
  -- Originaltext des Anbieters. Nicht zusammengefasst: "no credits" und
  -- "quota exceeded for this project" fuehren zu unterschiedlichen Handgriffen.
  message text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Wann die Benachrichtigung rausging. Null heisst "noch zu verschicken" --
  -- der Cron holt sich genau diese Zeilen.
  notified_at timestamptz,
  -- Vom Nutzer als erledigt markiert, oder automatisch beim naechsten
  -- erfolgreichen Aufruf desselben Anbieters.
  resolved_at timestamptz
);

-- Hoechstens ein OFFENER Alarm je Workspace und Anbieter. Als partieller Index
-- statt als Constraint, weil erledigte Zeilen als Historie liegen bleiben
-- sollen und sich sonst gegenseitig blockieren wuerden.
create unique index provider_alerts_open_idx
  on public.provider_alerts (workspace_id, provider)
  where resolved_at is null;

create index provider_alerts_unnotified_idx
  on public.provider_alerts (notified_at)
  where notified_at is null and resolved_at is null;

alter table public.provider_alerts enable row level security;

-- Lesen und auf erledigt setzen darf der Eigentuemer des Workspaces. Angelegt
-- werden die Zeilen ausschliesslich vom Worker (Service-Role umgeht RLS) --
-- ein selbst geschriebener Alarm haette keinen Wert.
create policy provider_alerts_read on public.provider_alerts
  for select using (public.is_workspace_owner(workspace_id));
create policy provider_alerts_resolve on public.provider_alerts
  for update using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

/**
 * Alarm setzen oder auffrischen.
 *
 * Beim zweiten Auftreten desselben Problems wird nur last_seen_at
 * hochgezogen, nicht neu benachrichtigt -- sonst kaeme bei 128 Fehlschlaegen
 * 128-mal dieselbe Mail.
 */
create or replace function public.record_provider_alert(
  p_workspace_id uuid,
  p_provider text,
  p_message text
)
returns void language sql security definer set search_path = public as $$
  insert into public.provider_alerts (workspace_id, provider, kind, message)
  values (p_workspace_id, p_provider, 'out_of_credit', left(p_message, 2000))
  on conflict (workspace_id, provider) where resolved_at is null
  do update set last_seen_at = now(), message = left(excluded.message, 2000);
$$;
revoke execute on function public.record_provider_alert(uuid, text, text) from public, anon, authenticated;

/**
 * Alarm aufloesen, sobald derselbe Anbieter wieder erfolgreich antwortet.
 *
 * Vom Worker nach jedem geglueckten Job aufgerufen. Der Nutzer muss also
 * nichts wegklicken, wenn er das Guthaben aufgeladen hat -- die Meldung
 * verschwindet beim naechsten erfolgreichen Aufruf von selbst. Eine Warnung,
 * die man von Hand wegraeumen muss, steht sonst wochenlang herum und wird
 * genauso ignoriert wie eine, die nie kam.
 */
create or replace function public.resolve_provider_alert(
  p_workspace_id uuid,
  p_provider text
)
returns void language sql security definer set search_path = public as $$
  update public.provider_alerts
     set resolved_at = now()
   where workspace_id = p_workspace_id
     and provider = p_provider
     and resolved_at is null;
$$;
revoke execute on function public.resolve_provider_alert(uuid, text) from public, anon, authenticated;
