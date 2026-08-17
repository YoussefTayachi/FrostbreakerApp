# Case Study: Frostbreaker, B2B-Lead-Gen-System solo in drei Wochen gebaut

> **Hinweis für dich (nicht Teil des Texts an Kunden):** Dieser Text ist als
> Baukasten gedacht. Für eine Kaltakquise-Mail nimmst du Intro + 2–3 Punkte aus
> "Technik" + den letzten Absatz, kürzt auf ~150 Wörter. Für LinkedIn kannst du
> den Text fast komplett so posten. Für ein persönliches Gespräch sind die
> Zahlen unten Gesprächsstoff, nicht Werbeversprechen: sag ehrlich, dass es
> ein eigenes Projekt ohne zahlende Kunden ist, das aber production-ready läuft.
> Das wirkt glaubwürdiger als es zu verschweigen.

---

## Die Ausgangslage

Ich wollte selbst B2B-Kaltakquise betreiben, ohne dafür vier verschiedene
Tools zu abonnieren und mühsam zu verkabeln (Kontaktdatenbank, E-Mail-Finder,
Verifizierung, Sequencer, dazu eine Tabelle als improvisiertes CRM). Diese
Kombination kostet leicht 150–300 €/Monat und bleibt trotzdem fragmentiert:
Daten liegen in vier Systemen, niemand hat die volle Kontrolle.

Also habe ich das System selbst gebaut, und zwar so, dass es nicht nur für
mich funktioniert, sondern als eigenständige App für jeden nutzbar ist.

## Was ich gebaut habe

Eine durchgehende Pipeline, komplett automatisiert:

**Google-Maps-Suche** (Nische + Ort) → **KI-Recherche der Entscheider** pro
Firma (OpenAI mit Web-Search, strukturierter Output) → **E-Mail-Finding**
(Hunter.io) → **automatische Verifizierung** (NeverBounce, verhindert
Bounces vor dem Versand) → **KI-Personalisierung** pro Kontakt →
**Versand über eigene Postfächer** (Instantly-Integration) → **Antwort-
Tracking** → **CRM** (Pipeline/Kanban, Notizen, Aktivitäten-Timeline, Deals).

Das komplette System ist **BYOK** (Bring Your Own Key): Jeder Nutzer
hinterlegt seine eigenen API-Keys, die serverseitig verschlüsselt gespeichert
werden (Fernet), nie im Klartext geloggt oder einsehbar sind. Kein
Anbieter-Lock-in, jeder zahlt nur echte Nutzung.

## Technik

- **Next.js**-Frontend, **FastAPI**-Backend, eigener **Python-Worker** für
  asynchrone Pipelines mit eigener Postgres-basierter Job-Queue (kein Redis
  nötig: eine Kostenentscheidung, keine Notlösung)
- **Supabase** (Postgres + Auth + Row-Level-Security), EU-Hosting
  (Frankfurt), 49 Schema-Migrationen in drei Wochen, sauber versioniert
- Verschlüsselte Speicherung nutzerspezifischer API-Keys
- Anbindung von sechs externen Diensten in einem konsistenten Datenmodell:
  Google Maps, OpenAI, Hunter.io, NeverBounce, Instantly, Stripe
- **Stripe**-Abo-System mit Trial-Logik
- CRM-Modul: Pipeline/Kanban-Board, Notizen, Aktivitäten-Timeline,
  Deal-Tracking

## Stand heute

- Live-System, aktiv in Betrieb: 511 Firmen durchsucht, 1.317 Kontakte
  identifiziert, E-Mail-Adressen automatisch gefunden und verifiziert
- Reale Kampagnen über eigene Postfächer versendet, mit funktionierendem
  Antwort-Sync
- Eigene Marketing-Website mit vollständigen Rechtstexten (Impressum, AGB,
  Datenschutz) dazu aufgebaut
- Ehrlich dazu: noch keine zahlenden Fremdkunden. Das Projekt ist der
  Beweis für die technische Umsetzung, nicht (noch) für Product-Market-Fit

## Was das für dich bedeutet

Genau dieses Tempo und diese Bandbreite (Datenmodellierung, KI-Integration,
Zahlungsanbindung, Sicherheitsarchitektur, saubere Anbindung mehrerer
Drittanbieter-APIs) bringe ich auch für eure Anforderungen mit. Ob interne
Automatisierung, Kunden-App oder Erweiterung eines bestehenden Systems: Ich
baue es, wie ihr es braucht, nicht wie es zufällig bei mir gelandet ist.
