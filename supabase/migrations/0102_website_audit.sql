-- Der Website-Check: harte Maengel der Lead-Website, deterministisch erhoben.
--
-- WARUM DIESE DATEN UEBERHAUPT IN DER DATENBANK LANDEN
--
-- Der Icebreaker lebt von einem Fakt, den der Empfaenger selbst nachpruefen
-- kann. Bisher stammte dieser Fakt aus zwei Quellen, die beide Prosa sind:
-- der recherchierten Firmenbeschreibung (find_decisionmaker, OpenAI) und dem
-- gecrawlten Website-Text. Beides beschreibt, was die Firma SAGT.
--
-- Der Website-Check misst dagegen, was ihre Website IST: laeuft sie ohne
-- HTTPS, fehlt der Viewport, steht im Fussbereich noch 2019. Das kostet
-- keinen Modellaufruf und kein Fremd-Guthaben, sondern zwei HTTP-Abrufe, und
-- das Ergebnis ist keine Behauptung: der Empfaenger kann es in seinem eigenen
-- Browser nachsehen. Der Katalog steht in apps/worker/worker/website_audit.py
-- und wird von apps/web/lib/website-audit.ts gespiegelt.
--
-- Erhoben wird er von einem eigenen Job-Typ (check_website), nicht nebenbei
-- in einem bestehenden. Die Begruendung dafuer steht bei HANDLERS in
-- apps/worker/worker/main.py und gehoert dorthin, nicht ins Schema.

-- 1. Der neue Job-Typ ------------------------------------------------------
--
-- jobs.type traegt eine CHECK-Constraint; sie wird hier komplett neu gesetzt
-- (drop + add), weil Postgres eine bestehende nicht erweitern kann. Zuletzt
-- geschehen in 0019_instantly_integration.sql. Die Liste unten ist deren
-- Liste plus check_website, unveraendert im Uebrigen: send_batch und
-- poll_inbox stehen weiterhin drin, obwohl es sie nie gab (Phase 3, die
-- eigene Sende-Engine, wurde bewusst nicht gebaut), und poll_instantly ist
-- seit dem Umzug des Sync nach app/api/cron/instantly-sync ungenutzt. Sie
-- jetzt zu streichen waere eine zweite, unabhaengige Entscheidung mit einem
-- eigenen Risiko und hat in dieser Migration nichts zu suchen.
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('get_businesses', 'find_decisionmaker', 'hunt_persons', 'personalize',
                   'check_website',
                   'send_batch', 'poll_inbox', 'poll_instantly'));

-- 2. Der Befund ------------------------------------------------------------
--
-- DREI SPALTEN NACH DEM VORBILD VON traffic_rank (Migration 0079): das
-- Ergebnis, sein Zustand und der Zeitpunkt. Ein Befund ohne Datum liesse sich
-- nicht von einem alten unterscheiden, und ein Befund ohne Zustand nicht von
-- "noch nie geprueft".
alter table public.businesses
  add column if not exists website_audit jsonb not null default '{}'::jsonb,
  add column if not exists website_audit_status text,
  add column if not exists website_audit_at timestamptz;

-- Die vier moeglichen Zustaende. Vorbild sind decisionmaker_status und
-- hunter_status (Migration 0001), mit EINEM bewussten Unterschied: diese
-- Spalte ist nullable und hat KEINEN Default.
--
-- null heisst "nie geprueft", und das gilt fuer zwei grosse Gruppen: jeden
-- Lead ohne Website (da gibt es nichts zu pruefen) und jede Zeile, die vor
-- dieser Migration entstanden ist. Ein Default 'pending' wuerde beiden eine
-- Pruefung versprechen, die nie kommt, und personalize wuerde auf sie warten.
--
-- Es gibt bewusst KEINEN Wert 'failed'. Ein nicht erreichbarer Server ist ein
-- Ergebnis und kein Fehler: die Seite ist dann eben nicht abrufbar, das ist
-- eine wahre Aussage ueber diesen Lead. Ein 'failed' wuerde dazu einladen,
-- es spaeter noch einmal zu versuchen, und genau das soll nicht passieren
-- (siehe den Kommentar zum Retry-Sturm in pipelines/check_website.py).
alter table public.businesses drop constraint if exists businesses_website_audit_status_check;
alter table public.businesses add constraint businesses_website_audit_status_check
  check (website_audit_status is null
         or website_audit_status in ('pending', 'ok', 'unreachable', 'skipped'));

comment on column public.businesses.website_audit is
  'Befund des Website-Checks: {checked_url, final_url, findings:[{code, evidence}], page_bytes, generator}. Die Codes sind stabil und stehen in worker/website_audit.py (FINDING_CODES), deren Reihenfolge zugleich die Rangfolge ist. evidence ist ein kurzes woertliches Zitat von der Seite (Jahreszahl, Generator-Name, erste http-URL) oder null, NIE ein Satz. page_bytes ist ein Messwert ohne Befund.';

comment on column public.businesses.website_audit_status is
  'null = nie geprueft (kein Default, siehe Migration). pending = Job eingereiht. ok = GEPRUEFT, nicht "alles gut": die Maengel stehen in website_audit.findings, und die Liste darf lang sein. unreachable = Seite nicht abrufbar, ehrliche Leerstelle statt geratener Maengel. skipped = keine oder keine abrufbare URL, oder die Antwort war kein HTML.';

comment on column public.businesses.website_audit_at is
  'Wann geprueft wurde. Eine Website aendert sich; ohne Datum waere nicht zu sehen, ob der Befund von heute oder von vor einem halben Jahr stammt.';

-- 3. KEIN INDEX AUF DIE BEFUNDE -------------------------------------------
--
-- Bewusst nicht, und zwar weder ein GIN-Index auf website_audit noch ein
-- Ausdrucksindex auf einzelne Codes.
--
-- Eine Lead-Liste hat einige hundert Zeilen, und die Leadliste im Frontend
-- laedt sie ohnehin vollstaendig (gefiltert wird auf workspace_id und
-- search_id, und dafuer gibt es die Indizes schon). Postgres liest die
-- jsonb-Spalte dabei mit, ganz gleich ob ein Index existiert. Ein Index waere
-- Vorratshaltung fuer eine Abfrage, die es nicht gibt: er kostet bei jedem
-- Schreiben Zeit und bei jedem Backup Platz, und niemand wuerde je merken,
-- dass er nichts einbringt.
--
-- Wenn spaeter tatsaechlich workspace-weit nach einem Befund gefiltert werden
-- soll ("alle Firmen ohne HTTPS ueber alle Listen"), ist das der Zeitpunkt
-- fuer einen Index, und dann fuer genau diese Abfrage.
