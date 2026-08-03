# Betrieb: was läuft wo

Stand: 2026-08-03. Jede Angabe hier ist am laufenden System nachgesehen, nicht
aus dem Code abgeleitet — Code sagt, was passieren *soll*, diese Datei sagt,
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
| Datenbank, Auth, Cron | Supabase | — |

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
  Directory noch Dockerfile Path sind gesetzt — Railway hat
  `apps/worker/Dockerfile` selbst gefunden. Das funktioniert, ist aber
  implizit: sobald ein zweites Dockerfile ins Repo kommt, kann die Erkennung
  auf das falsche fallen. Beide Felder explizit zu setzen wäre robuster.
- 2 Replicas. Das ist sicher, weil `claim_job` mit `for update skip locked`
  arbeitet (siehe Migration 0046/0047) — zwei Worker können sich denselben
  Job nicht doppelt greifen, es entstehen also keine doppelten API-Kosten.
  Doppelt ist nur der Container-Verbrauch.
- Restart Policy: On Failure, max. 10 Versuche.
- Drei Umgebungsvariablen, exakt die aus `worker/config.py`:
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`.
  Die API-Keys der Nutzer stehen **nicht** hier — die liegen Fernet-
  verschlüsselt in `public.api_keys` und werden zur Laufzeit mit
  `APP_ENCRYPTION_KEY` entschlüsselt.

**Zwei bekannte Schwachstellen:**

1. **Keine Watch Paths.** Jeder Push auf `main` baut und startet den Worker
   neu, auch wenn nur `apps/web` geändert wurde. Am 2026-08-02 waren das
   zehn Deployments, von denen keines den Worker betraf. Jeder Neustart
   reißt laufende Jobs mittendrin ab; die bleiben auf `running` stehen, bis
   `claim_job` sie nach 15 Minuten wieder einsammelt (Migration 0047). Die
   dort dokumentierte Beobachtung — „zwei Jobs 12,5 Minuten auf 'running'" —
   ist sehr wahrscheinlich genau das. Behebbar mit einem Watch Path auf
   `apps/worker/**`.
2. **Das Guthaben ist ein Trial.** Am 2026-08-03 zeigte Railway „10 days or
   $4.02 left", also Ablauf um den **2026-08-13**. Ohne hinterlegte
   Zahlungsmethode stoppt der Worker dann, und die Lead-Suche steht still —
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
lautet `https://system3-app.vercel.app` — nicht die Kundendomain
`app.frostbreaker.app`. Beim Umzug auf eine andere Vercel-Domain muss diese
URL mitwandern, sonst laufen Signup-Meldungen ins Leere.

---

## Vercel: Frontend und Routen

Region `fra1`. Deployt bei jedem Push auf `main`.

Vier Routen laufen bewusst **ohne** Supabase-Session und prüfen ihre
Authentifizierung selbst — sie sind deshalb im Middleware-Matcher
ausgenommen (siehe `apps/web/middleware.ts`):

| Route | Prüft |
|---|---|
| `api/billing/webhook` | Stripe-Signatur |
| `api/cron/*` | `CRON_SECRET` |
| `api/internal/*` | `INTERNAL_NOTIFY_SECRET` |
| `api/unsubscribe` | bewusst nichts (CAN-SPAM verlangt Opt-out ohne Hürden) |

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
`RESEND_FROM` setzen — überschreibbar ohne Deploy.

Supabase-Auth verschickt Bestätigungsmails **nicht** über Resend, sondern
über Supabases eingebauten Dienst. Der ist geteilt und ratenbegrenzt und von
Supabase selbst nicht für Produktivbetrieb empfohlen. Ob eine
Bestätigungsmail bei einer echten neuen Adresse ankommt, ist **nie getestet
worden** — bislang hat sich außer dem Betreiber niemand registriert. Eine
Umstellung auf Resend lohnt erst nach der Domain-Verifizierung, vorher käme
die Mail nur von `resend.dev` statt von `supabase.co`.

---

## Was tot ist

**`apps/api`** — FastAPI-Backend, wird von nirgendwo aufgerufen. Das Frontend
spricht direkt mit Supabase bzw. mit den eigenen Next.js-Routen. Letzte
inhaltliche Änderung: ein Rebrand-Commit am 2026-07-19. Steht noch im
Verzeichnisbaum und im alten README, ist aber kein Teil des laufenden
Systems.

**`start_worker.bat`** — startete den Worker lokal, bevor er auf Railway lag.
Funktioniert weiterhin, aber wer es benutzt, betreibt einen dritten Worker
gegen dieselbe Queue. Wegen `skip locked` richtet das keinen Schaden an,
nötig ist es nicht mehr.

**Sending Engine (Phase 3 im PROJEKTPLAN)** — bewusst nie gebaut. Instantly
bleibt die Sende-Infrastruktur, siehe Kommentar in `worker/main.py`.

---

## Erste Anlaufstellen bei Störungen

| Symptom | Zuerst nachsehen |
|---|---|
| Suche bleibt auf „läuft", nichts passiert | Railway: Guthaben aufgebraucht? Service online? Logs zeigen `claim_job`-Polls im 5-Sekunden-Takt, wenn er lebt |
| Jobs hängen auf `running` | Wurde der Worker neu deployt? Reclaim greift nach 15 Min automatisch |
| Antworten kommen nicht in der App an | Vercel-Logs der Route `api/cron/instantly-sync`; danach Instantlys Rate-Limit (20/Min) |
| Antwort-Benachrichtigung kommt nicht | Einstellungen → „Testmail senden". Der Knopf zeigt Resends Originalfehler |
| Kampagnenliste leer | Nicht mehr stillschweigend möglich — die Route meldet DB-Fehler jetzt explizit (Session 3) |
