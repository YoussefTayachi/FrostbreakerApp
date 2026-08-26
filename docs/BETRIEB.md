# Betrieb: was läuft wo

Stand: 2026-08-03. Jede Angabe hier ist am laufenden System nachgesehen, nicht
aus dem Code abgeleitet: Code sagt, was passieren *soll*, diese Datei sagt,
was tatsächlich läuft. Wer etwas ändert, das hier steht, ändert bitte auch
diese Datei.

Diese Datei existiert, weil der Code allein drei falsche Schlüsse nahelegt:
`start_worker.bat` im Wurzelverzeichnis sieht aus, als liefe der Worker lokal
(tut er nicht), `apps/api` sieht aus wie ein aktives Backend (ist es nicht),
und der PROJEKTPLAN beschreibt eine eigene Sende-Engine (gibt es nicht,
Instantly übernimmt das).

---

## Die vier Laufzeitorte

| Was | Wo | Ausgelöst durch |
|---|---|---|
| Next.js-Frontend + alle `/api`-Routen | Vercel, Region `fra1` | Push auf `main` |
| Python-Worker (Lead-Pipelines) | Railway, Region US West | Push auf `main` |
| `instantly-sync` (Analytics + Antworten) | Vercel-Route, aufgerufen von Supabase `pg_cron` | jede Minute |
| Datenbank, Auth, Cron | Supabase | läuft durchgehend |

Es gibt **keinen** eigenen Mailversand. Kampagnen laufen über Instantly, der
Nutzer bringt seinen eigenen Instantly-Key mit (BYOK).

---

## Railway: der Worker

Projekt `selfless-smile`, Service `System3_App`.
Projekt-ID `6844c669-740e-411a-a2f1-d4f1fea7e71e`,
Service-ID `61208364-2b9c-4dd8-9aaa-8df543591aea`.

Der Worker pollt `public.jobs` alle 5 Sekunden über die RPC-Funktion
`claim_job` und führt die vier Pipelines aus (`get_businesses`,
`find_decisionmaker`, `hunt_persons`, `personalize`). Er ist ein Daemon ohne
öffentlichen Port („Unexposed service").

**Konfiguration:**

- Builder: Dockerfile, von Railway **automatisch erkannt**. Weder Root
  Directory noch Dockerfile Path sind gesetzt: Railway hat
  `apps/worker/Dockerfile` selbst gefunden. Das funktioniert, ist aber
  implizit: sobald ein zweites Dockerfile ins Repo kommt, kann die Erkennung
  auf das falsche fallen. Beide Felder explizit zu setzen wäre robuster.
- 2 Replicas. Das ist sicher, weil `claim_job` mit `for update skip locked`
  arbeitet (siehe Migration 0046/0047): zwei Worker können sich denselben
  Job nicht doppelt greifen, es entstehen also keine doppelten API-Kosten.
  Doppelt ist nur der Container-Verbrauch.
- Restart Policy: On Failure, max. 10 Versuche.
- Drei Umgebungsvariablen, exakt die aus `worker/config.py`:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`.
  Die API-Keys der Nutzer stehen **nicht** hier: die liegen Fernet-
  verschlüsselt in `public.api_keys` und werden zur Laufzeit mit
  `APP_ENCRYPTION_KEY` entschlüsselt.

**Zwei bekannte Schwachstellen:**

1. **Keine Watch Paths.** Jeder Push auf `main` baut und startet den Worker
   neu, auch wenn nur `apps/web` geändert wurde. Am 2026-08-02 waren das
   zehn Deployments, von denen keines den Worker betraf. Jeder Neustart
   reißt laufende Jobs mittendrin ab; die bleiben auf `running` stehen, bis
   `claim_job` sie nach 15 Minuten wieder einsammelt (Migration 0047). Die
   dort dokumentierte Beobachtung („zwei Jobs 12,5 Minuten auf 'running'")
   ist sehr wahrscheinlich genau das. Behebbar mit einem Watch Path auf
   `apps/worker/**`.
2. **Das Guthaben ist ein Trial.** Am 2026-08-03 zeigte Railway „10 days or
   $4.02 left", also Ablauf um den **2026-08-13**. Ohne hinterlegte
   Zahlungsmethode stoppt der Worker dann, und die Lead-Suche steht still:
   ohne Fehlermeldung in der App, denn Jobs werden weiterhin eingereiht, nur
   nicht mehr abgeholt.

---

## Supabase: der Cron

`pg_cron`-Job `instantly-sync` ruft jede Minute (Migration 0043) per `pg_net`
die Vercel-Route `api/cron/instantly-sync` auf. Sie erledigt zwei Dinge, die
früher der Python-Worker gemacht hat:

- **Kampagnen-Teil:** Analytics-Rollup nach `instantly_campaign_stats`,
  kampagnen-bezogene Antworten. Budget: 4 Suchen pro Aufruf.
- **Mailbox-Teil:** postfachweiter Sync über alle Instantly-Accounts, beide
  Richtungen. Budget: 15 (eaccount, Richtung)-Paare pro Aufruf, rotierend.

Beide Budgets existieren wegen Instantlys Grenze von 20 Requests/Minute, die
pro Workspace gilt (BYOK, jeder Kunde eigener Key).

Authentifiziert per `CRON_SECRET` (Bearer-Header, konstantzeitiger Vergleich).
Das Secret liegt in `supabase_vault`, nicht in einer Migration.

Ebenfalls per `pg_net`: `handle_new_user()` meldet jede Anmeldung an
`api/internal/notify-signup` (Migration 0048). Die dort fest eingetragene URL
lautet `https://system3-app.vercel.app`, nicht die Kundendomain
`app.frostbreaker.app`. Beim Umzug auf eine andere Vercel-Domain muss diese
URL mitwandern, sonst laufen Signup-Meldungen ins Leere.

---

## Vercel: Frontend und Routen

Region `fra1`. Deployt bei jedem Push auf `main`.

Sieben Routen laufen bewusst **ohne** Supabase-Session und prüfen ihre
Authentifizierung selbst; sie sind deshalb im Middleware-Matcher
ausgenommen (siehe `apps/web/middleware.ts`):

| Route | Prüft |
|---|---|
| `api/billing/webhook` | Stripe-Signatur |
| `api/cron/*` | `CRON_SECRET` |
| `api/internal/*` | `INTERNAL_NOTIFY_SECRET` |
| `api/mcp` | Bearer-Token aus `mcp_tokens` (SHA-256-Vergleich) |
| `api/oauth/*` | je Endpunkt anders, siehe unten |
| `.well-known/*` | bewusst nichts (RFC 9728/8414 verlangen offene Metadaten) |
| `api/unsubscribe` | bewusst nichts (CAN-SPAM verlangt Opt-out ohne Hürden) |

`.well-known/` und `api/oauth/` kamen am 2026-08-26 dazu. Vorher gemessen: ein
GET auf `/.well-known/oauth-protected-resource` antwortete mit **307 auf
/login**, ein Client bekam also eine HTML-Anmeldeseite, wo er JSON erwartete.
Wer diese Einträge entfernt, macht den Konnektor damit unbrauchbar.

Nicht ausgenommen ist die Seite `/oauth/authorize`: dort ist die Umleitung auf
`/login` gewünscht. Die Middleware hängt dafür ein `?next=` an, das **Pfad und
Parameter** trägt — ohne das landete der Mensch nach dem Anmelden auf dem
Dashboard, und der Konnektor wartete auf einen Code, der nie kam.

`api/mcp` ist der MCP-Server: der Nutzer verbindet ihn als Konnektor oder trägt
einen Token aus den Einstellungen in seinem eigenen Claude ein. Der
Endpunkt ist zustandslos und prüft bei **jedem** Aufruf neu, ob der Token gilt
und in welchen Workspaces sein Besitzer laut `workspace_members` Mitglied ist.
Er läuft mit Service-Role (ohne Session wäre `auth.uid()` NULL und jede
RLS-Policy false); der Ausgleich ist der ausdrückliche `workspace_id`-Filter in
jeder Abfrage, siehe `apps/web/lib/mcp/authorize.ts`. Zweiundzwanzig Werkzeuge,
davon elf lesend. Schreibend sind `set_lead_icebreaker`, `set_lead_icebreakers`,
`set_lead_website_finding`, `set_contact_status`, `add_note`, `set_offer_field`,
`create_campaign`, `set_campaign_sequence`, `update_campaign`,
`publish_campaign` und `undo_writes`; jedes davon fasst genau einen Datensatz je
Aufruf an. Mit einer Ausnahme.

Die Ausnahme ist `set_lead_icebreakers` (seit 2026-08-22): bis zu **50** Leads
je Aufruf, jeder einzeln über seine `business_id` benannt (keine Filterform),
mit `dry_run` als Vorschau, Alles-oder-nichts bei einer fremden ID, und
umkehrbar über `undo_writes`. Diese vier Bedingungen sind der Grund, warum ein
Mengenwerkzeug hier überhaupt vertretbar ist; fällt eine weg, ist die
Begründung in `lib/mcp/untrusted.ts` hinfällig. `undo_writes` schreibt aus
`mcp_write_log` den alten Wert zurück, lässt aber alles stehen, was seither in
der App geändert wurde, und markiert jede Wiederherstellung über
`mcp_write_log.undo_of` (Migration 0101), damit ein zweiter Aufruf kein
Kippschalter ist.

### Die zwei personalisierten Felder eines Leads

`set_lead_icebreaker` schreibt `businesses.personalization`,
`set_lead_website_finding` (seit 2026-08-26) schreibt
`businesses.website_finding`. Beides sind personalisierte Sätze aus der
Website, sie tun aber Verschiedenes und stehen in der Sequenz an verschiedenen
Stellen — `{{icebreaker}}` ist der Aufhänger, `{{websiteFinding}}` der gemessene
Mangel mit seiner Folge. Deshalb wurden sie mit Migration 0103 getrennt, und
deshalb hat der Befund ein eigenes Werkzeug statt eines Parameters am
bestehenden.

**Die Wortgrenzen sind verschieden, und das ist der Punkt.** Der Befund wird
gegen `FINDING_MAX_WORDS` (20, in `lib/website-finding-defaults.ts` und
`website_finding.py`) geprüft, nicht gegen die Icebreaker-Grenze des Workspaces
(Vorgabe 35). Nur so bewertet der MCP-Weg einen Satz genauso, wie ihn der
Worker bewertet hätte. Verbotene Wörter und Ausgabesprache kommen dagegen aus
den normalen Vorgaben: die gelten für jeden Satz, der in eine Mail gerät.

Ein leerer Befund ist ein gültiger Zustand — der Worker lässt das Feld genauso
leer, wenn er nichts Nachprüfbares gefunden hat. `publish_campaign` hält solche
Leads dann aus jeder Kampagne heraus, deren Sequenz `{{websiteFinding}}`
benutzt, und meldet sie als `no_website_finding`.

Wer ein drittes geprüftes Textfeld ergänzt, muss es an **vier** Stellen
eintragen, sonst geht es still halb kaputt: `UNDOABLE_FIELDS`,
`buendleNachZeile` (sonst behält ein zurückgeschriebener Satz die Markierung
des Satzes, der ihn überschrieben hatte), `GEPRUEFTE_SPALTEN` in `undo_writes`,
und die Spaltenliste in `ladeAktuelleWerte` — die letzte war beim Befund
tatsächlich vergessen, und der Fehler sah aus wie „`changed_since`, obwohl
niemand etwas angefasst hat".

### Der Konnektor (seit 2026-08-26, Migration 0105)

Bis dahin gab es nur den statischen Token aus den Einstellungen. Der
funktioniert in Claude Code, wo eine Konfigurationsdatei einen eigenen Header
aufnehmen kann — **nicht** in claude.ai und Claude Desktop: deren
Konnektor-Maske kennt nur „offen" oder „OAuth". Der Ausweg war `mcp-remote`,
ein npx-Paket, das bei jedem Start aus dem Netz kommt, unter Windows an
Leerzeichen in `args` zerbricht und bei einem 405 auf GET auf das abgeschaffte
SSE zurückfällt. **Daher kamen die wiederkehrenden MCP-Fehler, nicht aus dem
Server.**

Der Fluss ist OAuth 2.1 für öffentliche Clients, ohne `client_secret`, mit
PKCE-S256 als einziger Methode:

| Endpunkt | Was |
|---|---|
| `.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728. Beide Pfade, weil Clients sich uneinig sind, welchen sie fragen |
| `.well-known/oauth-authorization-server` | RFC 8414 |
| `api/oauth/register` | RFC 7591, **offen**. Eine Registrierung gewährt nichts, sie erlaubt nur, um Zustimmung zu fragen |
| `/oauth/authorize` | Die Zustimmungsseite. Braucht eine Sitzung, rendert ohne App-Hülle |
| `api/oauth/authorize` | Nimmt die Zustimmung entgegen, gibt den Code. **Origin-Prüfung ist hier eine Zugriffsentscheidung** (CSRF) |
| `api/oauth/token` | Code→Token und Refresh→Token, mit Rotation |
| `api/oauth/revoke` | RFC 7009. Antwortet immer 200, auch bei unbekanntem Token |

Drei Punkte, die beim Umbauen leicht kaputtgehen:

- **Die ausgestellten Token sind Zeilen in `mcp_tokens`**, keine eigene
  Tabelle. `kind = 'oauth'`, dazu `client_id`, `refresh_token_hash`,
  `refresh_expires_at`. Grund: der Prüfpfad in `app/api/mcp/route.ts` ist genau
  ein Hash-Lookup in genau einer Tabelle. Eine zweite Tokentabelle wäre ein
  zweiter Prüfpfad — die Sorte Verdopplung, bei der ein Widerruf später in der
  einen wirkt und in der anderen nicht.
- **Der Zugriffstoken lebt eine Stunde**, das Refresh-Token 90 Tage und wird
  bei jeder Nutzung rotiert. In der Token-Liste zählt deshalb
  `refresh_expires_at`, nicht `expires_at` — sonst stünde eine einwandfrei
  arbeitende Verbindung eine Stunde nach dem Verbinden als „abgelaufen" da.
- **Der Autorisierungscode wird in der Datenbank verbraucht**, per
  `update … where consumed_at is null … returning`, nicht per „lesen, prüfen,
  schreiben". Bei zwei gleichzeitigen Anfragen bekämen sonst beide einen Token.
  Ein zweites Einlösen widerruft zusätzlich alle Token dieses Clients
  (RFC 6749 §4.1.2).

Nachgeprüft am 2026-08-26 gegen die Live-App: Registrierung, untaugliche
`redirect_uri` (400), falscher Verifier (400), derselbe Code danach erneut
(400), Erfolgsfall, Zugriff auf `/api/mcp`, Nur-Lesen zeigt elf statt
einundzwanzig Werkzeugen, Erneuern, alter Refresh tot, alter Zugriffstoken
tot, Widerruf.

### Hausordnung beim Schreiben

Seit dem 2026-08-23 schreibt der Server nicht mehr an der Hausordnung des
Workspaces vorbei. Anlass war ein über `set_lead_icebreaker` gesetzter
Aufhänger mit einem Gedankenstrich: genau dieses Zeichen steht in
`DEFAULT_BANNED_WORDS`, und die Prüfseite zeigte danach dreißig Verstöße zur
Nacharbeit. `get_writing_rules` liefert dem Modell jetzt die **wirksamen**
Regeln (Wortgrenze, verbotene Wörter, Ausgabesprache, Quelltext, den
Systemprompt und die Beispiel-Paare) sowie die Sequenzregeln aus
`lib/copy/playbook.ts`. Wirksam heißt: aufgelöst gegen dieselben Standards,
die auch der Worker nimmt. Das ist der Kern des Werkzeugs, denn die Rohspalten
sind im Regelfall leer. Im gemessenen Workspace ist
`personalization_banned_words` NULL und `personalization_prompt` leer, während
die Oberfläche dort `— – -- -` verbietet; wer die Spalten durchreicht, meldet
dem Modell das Gegenteil dessen, was gilt. Die Auflösung steht an genau einer
Stelle: `apps/web/lib/personalization/settings.ts`. Im Ergebnis steht je Wert,
ob er eingestellt oder geerbt ist.

Beide Icebreaker-Werkzeuge prüfen den Text über `validateIcebreaker`, also mit
derselben Funktion wie PATCH `/api/personalization/review`. **Abgelehnt wird
nichts**: der Text wird geschrieben und dabei `personalization_needs_review`
mitgesetzt, genau wie die Route es tut. Ein Verstoß aus einem Modell landet
damit in derselben Prüfliste wie einer aus dem Worker, statt unbemerkt zu
bleiben. Eine harte Ablehnung wäre der schlechtere Weg, weil ein Modell dann
Umgehungen erfindet. Die Verstöße stehen je Lead in der Antwort, auch im
`dry_run`, und ihre Sprache folgt `personalization_language` des Workspaces.
`set_lead_icebreakers` setzte die Markierung bis dahin gar nicht, ein Stapel
von fünfzig Zeilen konnte also fünfzig Verstöße anlegen, die in der Prüfliste
als unauffällig galten. `undo_writes` bewertet die Markierung beim
Zurückholen neu; sonst trüge der alte Text die Markierung des neuen.

`create_campaign`, `set_campaign_sequence` und `update_campaign` legen
ausschließlich einen **Entwurf** an (`campaigns` ohne `instantly_campaign_id`,
ohne `activated_at`, ohne Mailboxen). Es gibt weiterhin kein Werkzeug, das
versendet, eine Suche startet, eine Kampagne aktiviert oder pausiert oder etwas
löscht: der schmale Schreibbereich ist der eigentliche Schutz gegen
Anweisungen, die in fremdem Website- oder Mailtext stecken. Jeder
Schreibvorgang landet in `mcp_write_log`.

`publish_campaign` (seit 2026-08-22) ist das einzige Werkzeug, das den Server
verlässt: es macht aus dem Entwurf eine echte Instantly-Kampagne und lädt deren
Leads hoch. Es ist derselbe Ablauf, den das Formular auslöst, weil beide
`lib/instantly/create-campaign.ts` aufrufen. Damit gelten auf dem MCP-Weg
dieselben vier Empfänger-Filter (Sperrliste inklusive Abmeldungen,
`contact_archive`, bereits geantwortet oder abgesagt, ungültige Adresse) und
dieselbe Abo-Schranke. Letztere läuft allerdings über
`getBillingStatusForUser(supabase, user_id aus dem Token)`, weil
`auth.getUser()` mit Service-Role NULL ergibt und die Prüfung der Route hier
wirkungslos wäre. Absender werden nie geraten: entweder stehen sie am Entwurf
oder sie kommen als Argument `mailboxes`, und jede genannte Adresse wird gegen
`GET /api/v2/accounts` geprüft (eine der 20 Instantly-Anfragen pro Minute).
`dry_run` legt nichts an und zeigt, wie viele Leads hochgingen und wie viele
warum zurückbleiben. **Aktiviert wird weiterhin nur in der App**: eine frisch
angelegte Instantly-Kampagne versendet nichts.

**Der Weg eines Entwurfs durch die App (seit 2026-08-22):** Er steht in der
Kampagnenliste unter Instantly > Kampagnen, mit eigenem Abzeichen („Entwurf aus
Claude") und einem Hinweis darüber, wie viele auf Prüfung warten; die
Suchen-Detailseite verlinkt ihn ebenfalls. Der Link führt **nicht** ins
Kampagnen-Detail (dessen Route braucht die Instantly-ID und antwortet ohne sie
mit „Kampagne nicht gefunden", weil sie live von Instantly liest), sondern nach
`/instantly/campaigns/new?draft=<campaign_id>`. Das Formular belegt Name,
Lead-Listen, Sequenz und Zeitplan daraus vor und legt beim Absenden über den
ganz normalen Weg an: erst Instantly, dann der Spiegel. Der Entwurf wird dabei
**weiterverwendet**, nicht gelöscht und neu angelegt: dieselbe `campaign_id`
bleibt gültig, und `mcp_write_log` zeigt weiter auf eine existierende Kampagne.
Der URL-Entwurf schlägt den halbfertigen Entwurf aus dem `localStorage` des
Formulars; dass dieser dabei verworfen wurde, sagt der Hinweis darüber.

Zwei Stellen sichern das ab: `create_campaign` lehnt einen zweiten Entwurf für
dieselbe Liste ab und nennt die vorhandene `campaign_id` (`campaigns` mit
leerer `instantly_campaign_id`, gefunden über `campaign_searches`), und
`POST /api/instantly/campaigns` räumt beim Anlegen zurückgebliebene Entwürfe
derselben Listen weg. Ohne das zweite könnte ein Entwurf nie mehr angelegt
werden, sobald seine Suche eine `instantly_campaign_id` trägt.

**Achtung bei Umgebungsvariablen:** Der Resend-Schlüssel heißt in Vercel
`Resend_API_KEY`, nicht `RESEND_API_KEY`. `process.env` unterscheidet Groß-
und Kleinschreibung; `lib/email.ts` akzeptiert deshalb beide Schreibweisen.
Nicht „aufräumen", ohne vorher in Vercel nachzusehen.

---

## Resend: Mailversand der App

Nur für Betreiber-Benachrichtigungen (Antwort auf eine Kampagne, Testmail),
nicht für Kampagnen selbst.

**Es ist keine Domain verifiziert.** Absender ist deshalb
`onboarding@resend.dev`, Resends geteilte Testadresse. Deren Einschränkung:
sie stellt ausschließlich an die Adresse zu, mit der das Resend-Konto
angelegt wurde. Solange die Benachrichtigung an `youtaybusiness@gmail.com`
geht, ist das folgenlos. Soll sie je an ein Team- oder Kundenpostfach gehen,
muss zuerst `frostbreaker.app` in Resend verifiziert werden (DNS), danach
`RESEND_FROM` setzen, überschreibbar ohne Deploy.

Supabase-Auth verschickt Bestätigungsmails **nicht** über Resend, sondern
über Supabases eingebauten Dienst. Der ist geteilt und ratenbegrenzt und von
Supabase selbst nicht für Produktivbetrieb empfohlen. Ob eine
Bestätigungsmail bei einer echten neuen Adresse ankommt, ist **nie getestet
worden**: bislang hat sich außer dem Betreiber niemand registriert. Eine
Umstellung auf Resend lohnt erst nach der Domain-Verifizierung, vorher käme
die Mail nur von `resend.dev` statt von `supabase.co`.

---

## Was tot ist

**`apps/api`**: FastAPI-Backend, wird von nirgendwo aufgerufen. Das Frontend
spricht direkt mit Supabase bzw. mit den eigenen Next.js-Routen. Letzte
inhaltliche Änderung: ein Rebrand-Commit am 2026-07-19. Steht noch im
Verzeichnisbaum und im alten README, ist aber kein Teil des laufenden
Systems.

**`start_worker.bat`**: startete den Worker lokal, bevor er auf Railway lag.
Funktioniert weiterhin, aber wer es benutzt, betreibt einen dritten Worker
gegen dieselbe Queue. Wegen `skip locked` richtet das keinen Schaden an,
nötig ist es nicht mehr.

**Sending Engine (Phase 3 im PROJEKTPLAN)**: bewusst nie gebaut. Instantly
bleibt die Sende-Infrastruktur, siehe Kommentar in `worker/main.py`.

---

## Erste Anlaufstellen bei Störungen

| Symptom | Zuerst nachsehen |
|---|---|
| Suche bleibt auf „läuft", nichts passiert | Railway: Guthaben aufgebraucht? Service online? Logs zeigen `claim_job`-Polls im 5-Sekunden-Takt, wenn er lebt |
| Jobs hängen auf `running` | Wurde der Worker neu deployt? Reclaim greift nach 15 Min automatisch |
| Antworten kommen nicht in der App an | Vercel-Logs der Route `api/cron/instantly-sync`; danach Instantlys Rate-Limit (20/Min) |
| Antwort-Benachrichtigung kommt nicht | Einstellungen → „Testmail senden". Der Knopf zeigt Resends Originalfehler |
| Kampagnenliste leer | Nicht mehr stillschweigend möglich: die Route meldet DB-Fehler jetzt explizit (Session 3) |
