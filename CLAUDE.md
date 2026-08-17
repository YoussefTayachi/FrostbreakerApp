# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sprache

Code-Kommentare, Commit-Messages, UI-Texte und Doku sind auf Deutsch. Neue
Kommentare und Commits ebenfalls auf Deutsch schreiben. Bezeichner (Variablen,
Funktionen, Tabellen) sind Englisch.

## Befehle

```bash
# Frontend (apps/web)
npm install
npm run dev                      # next dev, Port 3000
node dev-3200.js                 # Dev-Server auf Port 3200, chdir vorher (Tailwind v4 braucht apps/web als CWD)
npm test                         # vitest run — nur lib/**/*.test.ts, node-Env, kein jsdom
npx vitest run lib/crm/pipeline.test.ts        # einzelne Datei
npx vitest run -t "Teilstring des Testnamens"  # einzelner Test
npx tsc --noEmit                 # Typecheck (läuft NICHT in CI)

# Worker (apps/worker)
pip install -e ".[dev]"
python -m worker.main            # startet den Poll-Loop gegen die echte Queue
python -m pytest
python -m pytest tests/test_apollo.py::test_name   # einzelner Test
ruff check .                     # Lint+Format, line-length 100
```

CI (`.github/workflows/ci.yml`) läuft nur `ruff check` + `pytest` für
`apps/api` und `apps/worker`. Das Frontend wird von CI **nicht** geprüft —
`npm test` und `npx tsc --noEmit` vor einem Push selbst ausführen.

`python -m worker.main` lokal zu starten heißt: ein dritter Worker gegen
dieselbe Produktions-Queue. Dank `for update skip locked` gefahrlos, aber er
verbraucht echte API-Credits des Workspaces. Nur zum Debuggen.

## Architektur

Monorepo mit drei Apps, von denen zwei laufen:

| Pfad | Was | Wo |
|---|---|---|
| `apps/web` | Next.js 15 App Router, React 19, Tailwind v4 — Frontend **und** alle `/api`-Routen | Vercel, Region `fra1` |
| `apps/worker` | Python-Daemon, führt die Lead-Pipelines aus | Railway, 2 Replicas |
| `apps/api` | **Tot.** FastAPI, wird von nirgendwo aufgerufen | — |

`docs/BETRIEB.md` ist die gepflegte Quelle dafür, was tatsächlich wo läuft
(Env-Variablen, bekannte Schwachstellen, Störungssuche). Vor Aussagen über den
Betrieb dort nachsehen, nicht aus dem Code ableiten.

### Der Datenfluss

```
searches (INSERT aus dem Frontend)
  └─ DB-Trigger enqueue_search_job (Migration 0004) → jobs
        └─ Worker: claim_job() alle 5s → HANDLERS in worker/main.py
              get_businesses    Firmen finden (Google Maps | Hunter Discover | Apollo | Prospeo | CSV)
                └─ enqueued je Firma: find_decisionmaker (OpenAI Websuche) + hunt_persons (Hunter/E-Mail-Suche)
                      └─ enqueued: personalize (OpenAI, Eröffnungszeile pro Lead)
  → Kampagnenversand läuft über Instantly, nicht über eigenen Code
```

Es gibt **keine eigene Sende-Engine**. Die „Phase 3" im `docs/PROJEKTPLAN.md`
wurde bewusst nie gebaut — Instantly ist und bleibt die Sende-Infrastruktur.
Der PROJEKTPLAN ist in diesem Punkt überholt.

Die Queue ist Postgres (`public.jobs`). `claim_job(p_worker)` nutzt
`for update skip locked`; hängende Jobs holt sie nach 15 Minuten zurück
(Migration 0047). `main.py` fängt Netzfehler beim Abholen mit Backoff ab — der
Prozess darf an einem DNS-Aussetzer nicht sterben. `fail_job` macht aus
„Guthaben alle" eine Zurückstellung um eine Stunde statt eines verbrauchten
Versuchs.

### Instantly-Sync läuft nicht im Worker

Supabase `pg_cron` ruft jede Minute per `pg_net` die Vercel-Route
`app/api/cron/instantly-sync` auf (Analytics-Rollup + Antworten, beide
Richtungen). Budgets pro Aufruf existieren wegen Instantlys Grenze von 20
Requests/Minute pro Workspace. Auth per `CRON_SECRET` aus `supabase_vault`.

### BYOK und Verschlüsselung

Nutzer hinterlegen eigene API-Keys (google_maps, openai, hunter, apollo,
neverbounce, instantly, prospeo). Gespeichert Fernet-verschlüsselt in
`public.api_keys.key_ciphertext`, entschlüsselt zur Laufzeit mit
`APP_ENCRYPTION_KEY`.

Zwei Implementierungen, die kompatibel bleiben müssen:
`apps/worker/worker/crypto.py` (Python) und `apps/web/lib/fernet.ts` (TS).
Lesen/Schreiben geht ausschließlich über `worker/keys.py::get_api_key` bzw.
`apps/web/lib/api-keys.ts::getApiKey` — keine zweite Kopie anlegen.

### Workspace-Scoping (häufigste Fehlerquelle)

Ein Account kann mehrere Workspaces haben. Welcher aktiv ist, entscheidet
allein das Cookie `thaw_ws` (siehe `lib/workspace/server.ts`). RLS regelt nur,
auf welche Accounts jemand zugreifen darf — **nicht**, welcher der eigenen
Workspaces gemeint ist.

Jede Query gegen eine workspace-gebundene Tabelle (`searches`, `businesses`,
`contacts`, `api_keys`, …) braucht zusätzlich explizit
`.eq("workspace_id", ws.workspace.id)`. Ohne diesen Filter kommen Zeilen aus
allen Workspaces des Users zurück.

Drei Supabase-Clients: `lib/supabase/client.ts` (Browser),
`lib/supabase/server.ts` (Server Components/Routes, Session-gebunden),
`lib/supabase/service.ts` (Service-Role, **umgeht RLS** — nur für Code ohne
User-Session wie den Stripe-Webhook, nie an den Client durchreichen).

### Auth-Middleware

`apps/web/middleware.ts` schiebt jeden Request ohne Session auf `/login`. Vier
Routen sind im Matcher ausgenommen, weil sie ohne Supabase-Session aufgerufen
werden und ihre Auth selbst prüfen: `api/billing/webhook` (Stripe-Signatur),
`api/cron/*` (`CRON_SECRET`), `api/internal/*` (`INTERNAL_NOTIFY_SECRET`),
`api/unsubscribe` (bewusst gar keine — CAN-SPAM). Wer eine solche Route
hinzufügt, muss den Matcher mit ändern.

### Migrations

`supabase/migrations/`, fortlaufend nummeriert (aktuell bis 0096), angewandt
über Supabase MCP/CLI. **Niemals eine bestehende Migration editieren** — nur
neue anlegen. Sie sind Source of Truth fürs Schema; es gibt keine generierten
Typen im Repo.

### i18n

`lib/i18n/dict.ts` (ein großes de/en-Objekt, ~4600 Zeilen), Sprache aus dem
Cookie `lang` via `getLangServer()`. Neue UI-Texte in beide Sprachen.

### Weitere Feature-Bereiche unter `apps/web/app`

Über den Kern-Datenfluss hinaus (Suche → Leads → Instantly) existieren
mehrere eigenständige Bereiche, die jeweils eigene Routen und Migrationen
mitbringen:

- **Angebote** (`app/offers`, `app/api/offers/*`) — Angebote aus Suche oder
  Website ableiten, inkl. Produkterkennung. Migrationen 0090–0091, 0093.
- **CRM/Pipeline** (`app/crm`, `app/pipeline`) — Lead-Status jenseits des
  Versands, inkl. Archivierung. Migration 0095.
- **LinkedIn-Outreach** (`app/linkedin`, `app/api/copy/linkedin`) — zweiter
  Versandkanal neben Instantly, mit eigenen Vorlagen. Migrationen 0080, 0082.
- **Team/Workspace-Mitglieder** (`app/settings/team`) — mehrere Nutzer pro
  Workspace, nicht nur der Owner. Migration 0081.
- **Billing** (`app/api/billing/{checkout,portal,status,lead-usage,webhook}`) —
  Stripe-Checkout und -Portal, nicht nur der Webhook. Proration nach
  Workspace-Alter seit Migration 0088.

`Resend` (Transaktions-E-Mails, `lib/email.ts`) ist eine weitere Abhängigkeit
mit einer bekannten Falle (Env-Var-Schreibweise `Resend_API_KEY` vs.
`RESEND_API_KEY`) — Details stehen in `docs/BETRIEB.md`, nicht hier
dupliziert.

### Kosten

Jeder zahlungsrelevante API-Aufruf schreibt über `worker/usage.py::record`
eine Zeile mit der tatsächlich verbrauchten Menge. Die Preistabelle steht
bewusst nur dort. Ist ein Preis unbekannt (Hunter/Apollo rechnen in Credits),
bleibt `cost_usd` leer — eine ehrliche Lücke statt einer erfundenen Zahl.
Bereits geschriebene Zeilen behalten bei einer Preisänderung ihren Betrag.

## Konventionen

- Kommentare halten **gemessenes** Verhalten fremder APIs fest, keine
  Vermutungen. Wenn eine Zeile existiert, weil Instantly/Apollo/Prospeo sich
  unerwartet verhält, gehört das Messergebnis danebengeschrieben (gern mit
  Datum) — sonst entfernt es die nächste Person als vermeintlich überflüssig.
  Diese Kommentare sind quer durch den Code der eigentliche Wissensträger;
  beim Umbauen nicht wegkürzen.
- Änderungen an Kosten-, Credit- oder Retry-Logik immer daraufhin prüfen, ob
  sie fremde API-Credits doppelt verbrauchen können. Mehrere Commits in der
  Historie existieren genau deswegen.
- Vitest-Setup läuft ohne DOM: Tests gehören zu reiner Logik in `lib/**`,
  nicht zu Komponenten.
- Secrets nur in `.env` / Deployment-Env, `.env.example` dokumentiert die
  Namen.
- Push auf `main` deployt Vercel **und** Railway.
