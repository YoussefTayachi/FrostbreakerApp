-- Eine nicht erreichbare Website wird zum Befund, aber erst nach der zweiten
-- Beobachtung.
--
-- WAS VORHER FEHLTE
--
-- website_audit.unreachable() hat eine leere Befundliste geschrieben, es gab
-- keinen Code site_unreachable und keine Texte dafuer. Der
-- write_website_finding-Job stieg deshalb vor dem Modellaufruf aus, und
-- ausgerechnet der staerkste denkbare Aufhaenger fuer ein Website-Redesign
-- ("eure Seite laedt gar nicht") erzeugte gar nichts.
--
-- Belegt am 2026-08-27: von 24 Bau-Leads waren zwei nicht erreichbar
-- (richardwilding.net, www.leanbuild.co.uk). Der von Hand geschriebene Befund
-- fuer richardwilding.net war der beste im ganzen Satz.
--
-- WARUM ES NICHT EINFACH EINGEBAUT WURDE
--
-- Unerreichbarkeit ist die einzige Aussage dieses Katalogs, die ein einzelner
-- Netzaussetzer erfinden kann. Alle anderen Befunde stehen im HTML und sind
-- morgen dieselben. Aus EINEM gescheiterten Abruf eine Tatsachenbehauptung in
-- einer Kaltmail zu machen, waere genau der Fehler, gegen den
-- apps/worker/worker/website_audit.py im Kopfkommentar geschrieben ist.
--
-- Der Weg dorthin liegt vollstaendig im Worker und nicht im Schema; er steht
-- in apps/worker/worker/pipelines/confirm_unreachable.py. Kurz: die Fehlerart
-- muss dauerhaft sein (Name loest nicht auf, niemand lauscht, TLS bricht ab),
-- zwei Beobachtungen im Abstand einer halben Stunde muessen dasselbe sagen,
-- und eine Gegenprobe muss belegen, dass die Replik selbst ins Netz kommt.

-- 1. Der neue Job-Typ ------------------------------------------------------
--
-- Die Liste ist die aus 0103 plus confirm_website_unreachable, im Uebrigen
-- unveraendert (send_batch, poll_inbox und poll_instantly bleiben drin,
-- obwohl ungenutzt; sie zu streichen waere eine zweite, unabhaengige
-- Entscheidung).
--
-- WARUM EIN EIGENER TYP UND KEIN RETRY DES BESTEHENDEN JOBS: die Begruendung
-- steht bei HANDLERS in apps/worker/worker/main.py und gehoert dorthin, nicht
-- ins Schema. Der kurze Satz dazu: ein Retry gilt als Fehlschlag, wiederholt
-- sich bis max_attempts und belegt sofort wieder eine Replik. Dieser Job
-- laeuft einmal, eine halbe Stunde spaeter.
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('get_businesses', 'find_decisionmaker', 'hunt_persons', 'personalize',
                   'check_website', 'write_website_finding', 'confirm_website_unreachable',
                   'send_batch', 'poll_inbox', 'poll_instantly'));

-- 2. KEINE NEUE SPALTE ----------------------------------------------------
--
-- Der Befund selbst braucht keine. Er liegt wie alle anderen in
-- businesses.website_audit, und die drei Zusatzangaben (Fehlerart, erste und
-- bestaetigende Beobachtung) liegen daneben im selben jsonb. Eine eigene
-- Spalte fuer einen Zustand, der genau einen von zwoelf Befunden betrifft,
-- waere Schema fuer einen Sonderfall.
--
-- website_audit_status bleibt ebenfalls unveraendert: 'unreachable' gab es
-- schon, und es bedeutet weiterhin dasselbe. Neu ist nur, dass die
-- findings-Liste dabei nicht mehr zwingend leer ist.
comment on column public.businesses.website_audit is
  'Befund des Website-Checks: {checked_url, final_url, findings:[{code, evidence}], page_bytes, generator}. Bei website_audit_status = unreachable stattdessen {checked_url, findings, unreachable_kind, unreachable_first_seen_at, unreachable_confirmed_at}: unreachable_kind ist die Fehlerart aus worker/website_fetch.classify_failure (dns, refused, tls, timeout, http, other), und findings traegt site_unreachable NUR, wenn unreachable_confirmed_at gesetzt ist, also eine zweite Beobachtung eine halbe Stunde spaeter dasselbe gesagt hat. Die Codes sind stabil und stehen in worker/website_audit.py (FINDING_CODES), deren Reihenfolge zugleich die Rangfolge ist. evidence ist ein kurzes woertliches Zitat von der Seite oder null, NIE ein Satz. page_bytes ist ein Messwert ohne Befund.';

comment on column public.businesses.website_audit_status is
  'null = nie geprueft (kein Default, siehe Migration 0102). pending = Job eingereiht. ok = GEPRUEFT, nicht "alles gut": die Maengel stehen in website_audit.findings, und die Liste darf lang sein. unreachable = Seite nicht abrufbar; seit Migration 0106 kann daraus der Befund site_unreachable werden, aber erst nach einer zweiten Beobachtung, sonst bleibt die Befundliste leer. skipped = keine oder keine abrufbare URL, oder die Antwort war kein HTML.';

-- 3. KEIN INDEX FUER DIE OFFENEN BESTAETIGUNGSJOBS -------------------------
--
-- Anders als bei 0070 und 0104 gibt es hier keine Doppelungssperre, die je
-- Firma nach offenen Jobs dieses Typs suchen muesste: eingereiht wird dieser
-- Job ausschliesslich vom Worker und genau einmal je gescheitertem Abruf,
-- nicht von einem Knopf, den jemand zweimal druecken kann. Gegen eine
-- doppelte Zustellung sichert der Job sich selbst ab (er steigt aus, wenn der
-- Befund schon dasteht). Ein Index waere Vorratshaltung fuer eine Abfrage,
-- die es nicht gibt.
