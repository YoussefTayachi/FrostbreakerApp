# Projektplan: B2B Lead-Gen & Cold-Outreach App (BYOK-SaaS)

**Stand:** 13.07.2026 · **Basis:** Analyse deiner 3 n8n-Workflows (Get_Businesses, Find_Decisionmaker, Hunt_Persons)

---

## 1. Die Lösung für das Instantly-Problem

**Kernidee: Wir bauen den Sequencer selbst und verschicken über die eigenen Postfächer des Users (BYO-Mailbox).** Instantly ist im Kern nur: Mailbox-Rotation + Sequenzen + Warmup + Analytics. Alles außer Warmup ist mit überschaubarem Aufwand selbst gebaut — und genau das passt zu deinem BYOK-Modell.

### So funktioniert es

1. **User verbindet eigene Postfächer** per SMTP + IMAP (funktioniert mit Google Workspace via App-Passwort, Microsoft 365, Zoho, jedem Provider). Kein teurer Drittanbieter, Kosten für den User = sein ohnehin vorhandenes Postfach (~6 €/Monat Workspace statt 37+ $/Monat Instantly).
2. **Eigener Sequencer** (Python-Worker):
   - Kampagnen mit Initial-Mail + Follow-ups (Stop-on-Reply)
   - Tageslimit pro Postfach mit Ramp-up (Start 20/Tag, +5/Tag bis ~50)
   - Randomisierte Sendezeiten (Jitter), Sendefenster/Zeitzone
   - Mailbox-Rotation bei mehreren Postfächern
3. **Reply- & Bounce-Erkennung via IMAP-Polling**: Antworten stoppen die Sequenz automatisch, Bounces landen auf der Suppression-List.
4. **Deliverability-Basics in der App**: DNS-Check-Widget für SPF/DKIM/DMARC, Unsubscribe-Link + zentrale Suppression-List, Plain-Text-First-Editor, Spintax.
5. **Warmup**: bewusst KEIN Fake-Warmup-Netzwerk (Google/Microsoft sperren die zunehmend, rechtlich grau). Stattdessen: sauberer Ramp-up-Algorithmus + Onboarding-Checkliste (eigene Subdomain fürs Senden, SPF/DKIM/DMARC, 2 Wochen Vorlauf). Optional später: Integration eines günstigen Warmup-Anbieters als Add-on.

### Verworfene Alternativen

| Option | Warum nicht |
|---|---|
| Amazon SES (BYOK) | Spottbillig, aber Cold Outreach verstößt gegen SES-Policy → Account-Bans, geteilte IP-Reputation |
| Eigener SMTP-Server (Postal/Mailcow) | Deliverability-Albtraum, IP-Reputation von null aufbauen |
| Open-Source-Instantly-Klone | Nichts Reifes verfügbar, Wartungsrisiko |

### Rechtlicher Hinweis (kein Rechtsrat)

DSGVO deckt die **Datenverarbeitung** ab — dein BYOK-Ansatz + EU-Hosting (Supabase Frankfurt) + Löschfunktionen helfen hier. Aber: Kaltakquise per E-Mail ist in DE/AT nach **UWG §7** auch B2B grundsätzlich einwilligungspflichtig. Das Risiko trägt dein User (er ist Verantwortlicher, du Auftragsverarbeiter mit AVV). Die App sollte trotzdem einbauen: Pflicht-Unsubscribe, Suppression-List, Impressumspflicht-Hinweis, Double-Opt-out-Log. Das ist auch ein Verkaufsargument.

---

## 2. Architektur

```
Frontend (Next.js auf Vercel, v0-kompatibel)
        │
Backend  (Python/FastAPI + Worker, gehostet auf Railway/Fly.io, ~5 €/Monat)
        │
Supabase (EU/Frankfurt): Postgres + Auth + RLS + Vault für API-Key-Verschlüsselung
        │
User-APIs (BYOK): Google Maps · OpenAI · Hunter · eigene SMTP/IMAP-Postfächer
```

- **GitHub-Monorepo als Source of Truth**: `/apps/web` (Next.js), `/apps/api` (FastAPI), `/apps/worker` (Pipelines + Sequencer), `/supabase` (Migrations). Sauber getrennt, damit du später mit v0, Antigravity und Claude parallel dran arbeiten kannst.
- **BYOK**: API-Keys werden pro User verschlüsselt in Supabase Vault gespeichert, nie geloggt, nie im Frontend sichtbar.

### Datenmodell (Kern)

`workspaces` → `api_keys` (verschlüsselt) · `searches` (Nische+Ort) · `businesses` · `contacts` (Decisionmaker + E-Mail + Confidence) · `campaigns` · `campaign_steps` · `mailboxes` · `messages` (geplant/gesendet/geantwortet/gebounced) · `suppression_list` · `events` (Audit-Log für DSGVO)

### Die 3 Workflows als Python-Pipeline

Deine n8n-Logik wird 1:1 portiert, aber robuster:

1. **`get_businesses`**: Geocoding → Places TextSearch mit Pagination (dein NextPageToken-Loop) → Dedupe → DB. *Fix gegenüber n8n: `place_id` als Dedupe-Key statt Name.*
2. **`find_decisionmaker`**: OpenAI Responses API mit `web_search`-Tool, aber mit **Structured Output (JSON Schema)** statt „bitte antworte nur mit \```json"-Prompt → dein Switch/Stop-and-Error-Gebastel entfällt komplett.
3. **`hunt_persons`**: Hunter Domain-Search (executive/management) → nur `verification.status != invalid` übernehmen (dein aktueller Workflow speichert auch invalide!), Confidence-Score speichern.
4. **NEU `personalize`**: Website des Leads scrapen (httpx + trafilatura) → GPT generiert `{{personalization}}`-Variable → am Contact gespeichert, im Editor als Variable nutzbar.

---

## 3. Projektplan — Phasen

**Prinzip: Ich baue alles. Du lieferst nur Accounts, Keys und Freigaben.**

### Phase 0 — Setup (1 Session)
- **Ich:** Monorepo-Scaffold, CI (GitHub Actions), Supabase-Schema/Migrations, README, .env-Struktur.
- **Du:** GitHub-Repo anlegen + mir Zugriff geben (Browser-Freigabe reicht), Supabase-Projekt (Region Frankfurt) anlegen, Keys reingeben.

### Phase 1 — Lead-Pipeline in Python (2–3 Sessions)
- **Ich:** Die 3 Workflows als Python-Module portieren, Job-Queue (Postgres-basiert, kein Redis nötig → Kosten), Rate-Limiting, Retry, Tests mit deinen Pin-Daten aus den JSONs.
- **Du:** Test-API-Keys (Google Maps neu rotiert!, OpenAI, Hunter). Einen Testlauf abnicken.

### Phase 2 — Personalisierung (1 Session)
- **Ich:** Scraper + GPT-Personalisierung, Prompt-Templates, Batch-Verarbeitung pro Nische.
- **Du:** 2–3 Beispiel-Personalisierungen bewerten (Qualitätskalibrierung).

### Phase 3 — Sending Engine (2–3 Sessions) ← ersetzt Instantly
- **Ich:** SMTP/IMAP-Connector, Sequencer + Scheduler, Ramp-up, Stop-on-Reply, Bounce-Handling, Unsubscribe-Endpoint, Suppression-List, DNS-Checker.
- **Du:** Ein Test-Postfach (z. B. Google Workspace + App-Passwort) und eine Test-Sending-Domain; DNS-Einträge setzen (ich sag dir exakt welche).

### Phase 4 — Frontend (2–3 Sessions)
- **Ich:** Next.js-Dashboard: Onboarding (Keys eintragen), Suche starten (Nische + Ort), Lead-Tabelle mit Status, Kampagnen-Builder mit Variablen-Editor, Reply-Inbox, Analytics (Open/Reply/Bounce-Rate). Baue ich v0-kompatibel (shadcn/ui + Tailwind).
- **Du:** Vercel-Account verbinden, Design-Feedback.

### Phase 5 — DSGVO & Härtung (1–2 Sessions)
- **Ich:** RLS-Policies final, Key-Verschlüsselung auditieren, Datenexport + Konto-Löschung (Art. 15/17), AVV-Template, Audit-Log, Rate-Limits gegen Missbrauch.
- **Du:** AVV/Datenschutzerklärung von einem Anwalt gegenlesen lassen (das kann ich nicht ersetzen).

### Phase 6 — Monetarisierung & Launch (1–2 Sessions)
- **Ich:** Stripe-Integration (Subscription, z. B. 29–49 €/Monat — dein Pricing-Vorteil: User zahlt APIs selbst, du hast fast null variable Kosten), Landing Page, Onboarding-Docs.
- **Du:** Stripe-Account (Identitätsprüfung), Domain kaufen, Preis festlegen.

**Gesamt: ~10–14 Arbeitssessions.**

---

## 4. Deine komplette To-do-Liste (alles andere mache ich)

1. Google-Maps-Key **sofort rotieren** (ist im JSON geleakt)
2. GitHub-Repo anlegen, mir Zugriff geben
3. Supabase-Projekt (Frankfurt) anlegen
4. Vercel-Account
5. Test-Keys: Google Maps, OpenAI, Hunter
6. Test-Postfach + Sending-Domain, DNS-Einträge nach meiner Anleitung
7. Stripe-Account + Domain (erst Phase 6)
8. Anwalt für AVV/Datenschutzerklärung (erst Phase 5)

---

## 5. Laufende Kosten (dein Vorteil im Verkauf)

| Posten | Für dich | Für deinen User |
|---|---|---|
| Hosting Backend | ~5 €/Monat (Railway/Fly) | — |
| Supabase | 0 € (Free) → 25 $ (Pro) bei Wachstum | — |
| Vercel | 0 € (Hobby) → 20 $ | — |
| APIs (Maps/OpenAI/Hunter) | 0 € (BYOK) | zahlt er selbst, nutzungsbasiert |
| E-Mail-Versand | 0 € | sein eigenes Postfach (~6 €/Monat) |

→ Du kannst profitabel bei 29 €/Monat pro Kunde sein, wo Instantly + Apollo/Hunter-Bundles 100 €+ kosten.
