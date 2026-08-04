-- Der Zustellbarkeits-Waechter: was nach dem Start kaputtgeht.
--
-- Der Torwart (Migration 0068er-Reihe, lib/campaign-readiness.ts) prueft
-- EINMAL, beim Anlegen. Danach passiert das Wichtigste: die Kampagne laeuft
-- Wochen, und irgendwann kippt etwas. Am 2026-08-04 hatte eine Kampagne 6
-- Bounces auf 30 Mails -- 20 Prozent, und niemand hat es gesehen, weil
-- niemand hinschaut, solange nichts blinkt.
--
-- Zwei Dinge werden ab jetzt beobachtet: die DNS-Eintraege der
-- Absender-Domains (taeglich) und die Bounce-Quote je Kampagne (laufend).

-- STAND JE ABSENDER-DOMAIN
--
-- Gespeichert, obwohl die Pruefung selbst zustandslos ist (lib/deliverability.ts
-- fragt live im DNS). Der Grund ist nicht das Zwischenspeichern, sondern der
-- VERGLEICH: gemeldet werden soll der Uebergang von "ging" zu "geht nicht
-- mehr", nicht der Zustand. Eine Domain, die seit drei Wochen kein DKIM hat,
-- jeden Tag erneut zu melden waere die zuverlaessigste Art, dafuer zu sorgen,
-- dass die Meldung weggeklickt wird -- und mit ihr die vom Tag, an dem etwas
-- Neues passiert.
create table public.domain_health (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  domain text not null,
  spf boolean not null,
  dkim boolean not null,
  dmarc boolean not null,
  checked_at timestamptz not null default now(),
  unique (workspace_id, domain)
);

alter table public.domain_health enable row level security;

-- Lesen darf der Eigentuemer; geschrieben wird ausschliesslich vom Cron ueber
-- die Service-Role. Ein von Hand gesetzter "alles gruen"-Eintrag wuerde genau
-- die Meldung unterdruecken, fuer die es die Tabelle gibt.
create policy domain_health_read on public.domain_health
  for select using (public.is_workspace_owner(workspace_id));

-- ALARM-ARTEN
--
-- provider_alerts ist die vorhandene Strecke fuer "etwas haelt deine Akquise
-- an, und du sollst es per Mail erfahren" -- samt Entdoppelung, Versandpfad
-- und Dashboard-Anzeige. Eine zweite Tabelle daneben waere ein zweiter
-- Mechanismus, der ausfallen kann, fuer dieselbe Aufgabe.
--
-- provider fuehrt bei diesen Arten die betroffene Domain bzw. Kampagne statt
-- eines Anbieternamens. Der Teilindex "hoechstens ein offener Alarm je
-- (workspace, provider)" passt dadurch unveraendert: eine Domain kann genau
-- einen offenen Zustellbarkeits-Alarm haben.
alter table public.provider_alerts drop constraint provider_alerts_kind_check;
alter table public.provider_alerts add constraint provider_alerts_kind_check
  check (kind in ('out_of_credit', 'domain_broken', 'campaign_paused'));

-- AUTOMATISCHES ANHALTEN
--
-- Ab 5 Prozent Bounce greifen die Schutzmechanismen der Empfaenger-Provider,
-- und der Ruf der Absender-Domain traegt es dauerhaft mit. Weiterzusenden ist
-- dann nicht "etwas riskant", sondern der teuerste Fehler, den man in
-- Kaltakquise machen kann -- er kostet die Domain, nicht die Kampagne.
--
-- Deshalb als Voreinstellung an. Der Eingriff ist umkehrbar (die Kampagne
-- laesst sich mit einem Klick fortsetzen), er wird per Mail angekuendigt, und
-- wer ihn nicht will, schaltet ihn hier ab. Ein Waechter, der nur zuschaut,
-- waere die Sorte Warnung, die man im Nachhinein im Log findet.
alter table public.workspaces
  add column if not exists auto_pause_on_bounce boolean not null default true;

comment on column public.workspaces.auto_pause_on_bounce is
  'Kampagne bei Bounce-Quote ab 5 Prozent (min. 50 Sendungen) automatisch anhalten.';
