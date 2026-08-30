-- Die zweite Stufe des Website-Checks: dieselbe Seite in einem echten Browser.
--
-- WARUM EINE EIGENE SPALTE UND NICHT website_audit
--
-- Beide Stufen laufen als eigene Jobs und schreiben unabhaengig voneinander.
-- Teilen sie sich eine Spalte, ueberschreibt die langsamere die schnellere,
-- und weil ein vollstaendiges UPDATE die ganze JSONB-Spalte ersetzt, ist der
-- Verlust nicht sichtbar: es steht einfach ein Befund weniger drin. Gefunden
-- am 2026-08-30 beim Gegenlesen des Plans durch ein zweites Modell.
--
-- WOZU browser_audit_required
--
-- website_finding wartet, bis beide Stufen fertig sind. Ohne dieses Feld sind
-- drei Faelle nicht auseinanderzuhalten: eine Zeile aus der Zeit vor dieser
-- Migration, ein Lead ohne pruefbare Adresse, und eine Messung, die gerade
-- laeuft. Die ersten beiden duerfen nicht warten, die dritte muss.
--
-- WAS IN DER SPALTE STEHT
--
-- Das Ergebnis von worker/website_browser.measure(): status, die Sonden von
-- Desktop und Handy, Konsolenfehler, geblockte Anfragen, Screenshot-Pfad.
-- status kennt vier Werte, und `inconclusive` ist der wichtigste davon: eine
-- Consent-Wand oder eine Bot-Pruefung ist KEIN Mangel, sondern eine Messung,
-- die nichts sagt. Aus ihr entsteht nie ein Befund in einer Mail.

alter table public.businesses
  add column if not exists website_audit_browser jsonb,
  add column if not exists website_audit_browser_status text,
  add column if not exists website_audit_browser_at timestamptz,
  add column if not exists browser_audit_required boolean not null default false;

comment on column public.businesses.website_audit_browser is
  'Messung aus worker/website_browser.measure(). Eigene Spalte, damit die beiden Check-Stufen sich nicht gegenseitig ueberschreiben.';
comment on column public.businesses.website_audit_browser_status is
  'pending | completed | inconclusive | skipped | failed. inconclusive heisst: eine Wand stand davor, die Messung sagt nichts.';
comment on column public.businesses.browser_audit_required is
  'Ob website_finding auf die Browser-Stufe warten muss. False fuer alte Zeilen und Leads ohne pruefbare Adresse.';

-- Der Finding-Job fragt genau danach: welche Leads warten noch auf eine
-- Stufe. Ohne Index ist das bei 4365 Zeilen ein Full Scan je Job.
create index if not exists businesses_browser_audit_status_idx
  on public.businesses (website_audit_browser_status)
  where website_audit_browser_status is not null;

-- Der neue Jobtyp muss in die CHECK-Constraint, sonst scheitert enqueue.
--
-- check_website faengt den Fehlschlag beim Einreihen ab und protokolliert ihn
-- nur (derselbe Weg wie bei confirm_website_unreachable, Migration 0106).
-- Ohne diese Zeilen liefe also alles weiter und die zweite Stufe kaeme
-- schlicht nie an: ein Fehlschlag, der sich als Erfolg ausgibt.
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in (
  'get_businesses', 'find_decisionmaker', 'hunt_persons', 'personalize',
  'check_website', 'browser_check', 'write_website_finding',
  'confirm_website_unreachable', 'send_batch', 'poll_inbox', 'poll_instantly'
));
