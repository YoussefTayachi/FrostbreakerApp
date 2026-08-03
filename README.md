# Frostbreaker — B2B Lead-Gen & Cold-Outreach (BYOK)

SaaS: Firmen per Nische finden (Google Maps oder Apollo) → Entscheider
identifizieren (OpenAI Web Search) → E-Mail-Adressen finden (Hunter/Apollo) →
Adressen verifizieren (NeverBounce) → personalisierte Eröffnungszeile pro Lead
(OpenAI) → Kampagne **über Instantly** versenden.

**BYOK-Prinzip:** Der Nutzer hinterlegt eigene API-Keys (Google Maps, Apollo,
OpenAI, Hunter, NeverBounce, Instantly). Keys werden serverseitig
Fernet-verschlüsselt in Supabase gespeichert und zur Laufzeit mit
`APP_ENCRYPTION_KEY` entschlüsselt.

> **Wichtig, weil der PROJEKTPLAN etwas anderes sagt:** Eine eigene
> Sende-Engine (Phase 3) wurde bewusst **nicht** gebaut. Instantly ist und
> bleibt die Sende-Infrastruktur. `docs/PROJEKTPLAN.md` ist das
> Ursprungsdokument von Juli 2026 und in diesem Punkt überholt.

## Struktur

```
apps/
  web/     Next.js-Frontend + alle API-Routen  → Vercel (fra1)
  worker/  Python-Pipelines (get_businesses, find_decisionmaker,
           hunt_persons, personalize)          → Railway (US West)
  api/     TOT. FastAPI, wird von nirgendwo aufgerufen, siehe docs/BETRIEB.md
supabase/
  migrations/  SQL, Source of Truth fürs Schema (via Supabase MCP/CLI)
docs/
  BETRIEB.md              was wo läuft, Umgebungsvariablen, Störungssuche
  PROJEKTPLAN.md          Ursprungsplan Juli 2026, teilweise überholt
  KALTAKQUISE-VORLAGEN.md erprobte Mail-Sequenzen
  CASE-STUDY-FROSTBREAKER.md
  TESTLAUF.md
```

**`docs/BETRIEB.md` zuerst lesen**, wenn du wissen willst, wo etwas läuft.
Der Code beschreibt die Absicht, diese Datei den tatsächlichen Betrieb.

## Entwicklung

```bash
# Frontend
cd apps/web && npm install && npm run dev
cd apps/web && npm test          # vitest, 167 Tests
cd apps/web && npx tsc --noEmit

# Worker
cd apps/worker && pip install -e ".[dev]" && python -m worker.main
cd apps/worker && python -m pytest
```

Der Worker läuft produktiv auf Railway. Lokal starten ist nur zum Debuggen
nötig — er würde sonst als dritter Worker gegen dieselbe Queue laufen (was
dank `for update skip locked` in `claim_job` gefahrlos, aber nutzlos ist).

## Konventionen

- Python 3.11+, ruff (Lint+Format), pytest
- Migrations: fortlaufend nummeriert, **niemals editieren**, nur neue anlegen
- Secrets nur in `.env` / Deployment-Env, nie committen
- Kommentare halten *gemessenes* Verhalten fremder APIs fest, keine
  Vermutungen. Wenn eine Zeile existiert, weil Instantly/Apollo sich
  unerwartet verhält, gehört das Messergebnis danebengeschrieben — sonst
  entfernt es die nächste Person als vermeintlich überflüssig.
