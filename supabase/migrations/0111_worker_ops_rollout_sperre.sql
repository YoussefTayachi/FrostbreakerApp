-- SPERRFRIST FUER WORKER-ROLLOUTS
--
-- GEMESSEN AM 2026-09-10, 15:06 BIS 15:16 UTC
-- ═══════════════════════════════════════════════════════════════════════
-- Die Drift-Pruefung aus /api/cron/worker-ops rollt aus, wenn sich weniger
-- als die Haelfte der Zielrepliken meldet. Waehrend eines laufenden
-- Rollouts ist das aber der Normalzustand: die alten Repliken sind schon
-- tot, die neuen senden ihr erstes Lebenszeichen erst nach bis zu 30
-- Sekunden. Die Route hat diesen Zustand fuer die gemessene Stoerung vom
-- 2026-08-31 gehalten ("Einstellung sagt 6, Wirklichkeit ist 2") und
-- erneut ausgerollt -- was denselben Zustand wieder herstellte.
--
-- Die Antworten des Crons zeigen die Schleife Minute fuer Minute:
--
--   15:06  faellig 278  ziel 6  lebendig 2  -> ausgerollt
--   15:07  faellig 387  ziel 6  lebendig 2  -> ausgerollt
--   15:08  faellig 320  ziel 6  lebendig 8     (Rollout durch, 6 + 2 alte)
--   15:10  faellig 259  ziel 6  lebendig 2  -> ausgerollt
--   15:13  faellig 396  ziel 6  lebendig 2  -> ausgerollt
--   15:16  faellig 181  ziel 6  lebendig 2  -> ausgerollt
--
-- Fuenf Rollouts in elf Minuten, alle auf demselben Commit 4fd9ee4, also
-- kein einziges Deployment von aussen. Jeder davon hat die Jobs seiner
-- Repliken fallen lassen; sie standen danach 15 Minuten auf 'running', bis
-- claim_job() sie einsammelte (Migration 0047). Wer seine Versuche
-- aufgebraucht hatte, landete auf 'failed' -- an diesem Tag zwei
-- get_businesses-Jobs, deren Suchen laengst fertig waren.
--
-- Railway hat dabei nichts falsch gemacht: um 15:08 meldeten sich acht
-- Worker, die 6 kamen also sehr wohl hoch. Falsch war allein, die
-- Zwischenzeit eines Rollouts als Drift zu lesen.
--
-- Diese Tabelle haelt fest, wann zuletzt ausgerollt wurde. Die Route
-- schweigt danach fuer eine feste Frist (ROLLOUT_SPERRE_MINUTEN), egal wie
-- wenige Worker sie zaehlt. Der Fall vom 2026-08-31 bleibt erkannt: eine
-- Fehlbesetzung, die wirklich besteht, besteht auch nach zehn Minuten noch.
--
-- Eine einzige Zeile, erzwungen ueber den Primaerschluessel: es gibt genau
-- einen Worker-Service. Kein Verlauf, weil niemand ihn lesen wuerde -- was
-- passiert ist, steht in den Antworten des Crons und in jobs.locked_by.

create table if not exists public.worker_ops_state (
  id boolean primary key default true check (id),
  last_rollout_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.worker_ops_state (id) values (true) on conflict (id) do nothing;

-- Kein Nutzer hat hier etwas zu suchen: geschrieben wird ausschliesslich von
-- der Cron-Route mit dem Service-Role-Schluessel, und der umgeht RLS. Ohne
-- Policy ist die Tabelle damit fuer anon und authenticated dicht.
alter table public.worker_ops_state enable row level security;

comment on table public.worker_ops_state is
  'Betriebszustand der Worker-Skalierung. Eine Zeile. last_rollout_at ist die Sperrfrist gegen Rollout-Schleifen (siehe Migration 0111).';
