# Plan Review Log: Website-Befunde massenhaft, gemessen im echten Browser

Phasen 0 bis 1 (Recon + Befragung) abgeschlossen, Plan mit Youssef gelockt.
MAX_ROUNDS=5, PLAN_FILE=PLAN.md, inspect=on.

Recon: Graph-Abfrage ueber den Wissensgraphen, dann website_audit.py,
website_finding.py, check_website.py, main.py und pyproject.toml gelesen.
Der Katalog wurde gegen 38 echte Leads laufen gelassen und mit einer
Playwright-Messung derselben Seiten verglichen.

Befragung: Q1 (ersetzen oder ergaenzen) -> ergaenzen, zweite Stufe.
Q2 (wo laeuft es) loeste sich im Code auf: der Worker laeuft lokal.
Q3 (Befundtiefe) -> Youssefs eigene Antwort: ein Mangel, 2 bis 3 Saetze mit
Begruendung, ruhiger respektvoller Ton.
Kosmetik als Batch, ohne Widerspruch.

## Runde 1 - Codex

Sandbox-Befund vorab: die read-only Sandbox von Codex blockiert unter Windows
PowerShell komplett ("rejected: blocked by policy"), Codex konnte also keine
Datei lesen. Der Plan und die Codeauszuege gehen seitdem ueber stdin in den
Prompt. Der erste Verdict (REVISE mangels Lesbarkeit) zaehlt nicht.

- `write_website_finding` wartet laut Code nur auf `check_website`; es kann daher vor `browser_check` formulieren und wird wegen Idempotenz später nicht aktualisiert. — Fix: einen expliziten Audit-Fertigkeitsstatus beider Stufen einführen und den Finding-Job erst danach einmalig freigeben.

- „Nach `check_website` eingereiht“ ist keine Abhängigkeit: Queue-Reihenfolge garantiert weder Start noch Abschluss, insbesondere bei Retries. — Fix: `browser_check` erst atomar nach erfolgreichem/terminalem HTML-Check erzeugen und Abhängigkeiten datenbankseitig prüfen.

- Zwei Jobs schreiben gleichzeitig in dieselbe JSONB-Spalte; ein vollständiges Update kann das Ergebnis der anderen Quelle verlieren. — Fix: atomisches `jsonb_set`/Merge oder getrennte, versionierte Felder (`website_audit_html`, `website_audit_browser`) verwenden.

- `source` allein definiert weder das JSON-Schema noch, wie alte flache Audits und zwei Befundkataloge zu einem Gewinner kombiniert werden. — Fix: ein versioniertes Envelope-Schema samt deterministischer `top_finding()`-Regel über beide Quellen spezifizieren und migrieren.

- `render_blocked` ist nicht zwingend ein Mangel: Client Rendering kann beabsichtigt sein, während Nutzer die Seite vollständig sehen; der Roh-HTTP-Abruf ist kein Kundenbrowser. — Fix: nie als pauschalen Mailbefund verwenden; höchstens bei belegtem SEO-/Crawler-Symptom und präziser, überprüfbarer Formulierung.

- `slow_load` ist undefiniert („bis interaktiv“), stark abhängig von Standort, Cache, CPU, Consent-Bannern und Bot-Abwehr und erzeugt leicht falsche Geschäftsfolgen. — Fix: eine klar definierte Metrik unter dokumentierten Testbedingungen mehrfach messen und nur die beobachtete Verzögerung, nicht Umsatzverlust, behaupten.

- `mobile_overflow` kann von absichtlichen Carousels, Off-canvas-Elementen oder Messartefakten stammen und beweist nicht, dass Nutzer horizontal scrollen müssen. — Fix: nur sichtbaren, nicht-interaktiven Überlauf im Hauptinhalt nachweisen und Screenshot/DOM-Beleg am konkreten Element speichern.

- `empty_section` verwechselt Tabs, Akkordeons, Cookie-Zustände, Animationen und Lazy Loading mit defektem Inhalt; der Ausschluss nur von Menü/Dialog reicht nicht. — Fix: interaktive/absichtlich eingeklappte Komponenten erkennen, nach stabiler Wartezeit messen und den Befund nur bei sichtbarer, unzugänglicher Hauptinhalt-Region zulassen.

- Drei Konsolenfehler sind häufig Third-Party-Analytics-, CORS-, Consent- oder Bot-spezifisch und sagen nichts darüber aus, ob die Website für Kunden kaputt ist. — Fix: nur first-party, ungefangene Fehler mit nachweisbarer sichtbarer Funktionsstörung als Mailbefund zulassen.

- CSS unter 12px und Ziele unter 44px sind keine universellen Fehler; Fußnoten, dicht platzierte Controls und ausreichender Abstand können legitim sein. — Fix: auf relevante sichtbare Hauptinhalte bzw. tatsächlich nicht bedienbare Controls begrenzen und neutral als Beobachtung statt als Schaden formulieren.

- Die geforderte Folge „kostet das Unternehmen Geld“ ist bei fast allen Codes eine unbelegte Kausalbehauptung und in einer Kaltmail falsifizierbar bzw. unfalsifizierbar. — Fix: Prompt und `CONSEQUENCE_DE` auf konditionale, konkrete Nutzerauswirkungen beschränken („kann auf kleinen Displays schwer lesbar sein“), ohne Umsatz-, Conversion- oder Kundenverlust zu behaupten.

- Das Prompt-Verbot, auf die eigene Prüfung hinzuweisen, entfernt den nötigen Kontext für zeitabhängige Browserbeobachtungen; ein Seiten-Deploy kann die Aussage sofort falsch machen. — Fix: eine knappe, datierte Beobachtungsform erlauben und nur Befunde versenden, deren Beleg-URL, Viewport und Zeit gespeichert sind.

- Screenshots als „Beleg“ haben keinen Speicher-, Zugriffs-, Retentions- oder Datenschutzplan und können Kontakt-, Cookie- oder personenbezogene Inhalte enthalten. — Fix: Speicherung und Zugriff explizit definieren, sensible Bereiche minimieren/redigieren und eine kurze Retention festlegen.

- Das Laden beliebiger Lead-URLs im vollwertigen Browser erweitert SSRF erheblich, inklusive Redirects, DNS-Rebinding und interner Ressourcen. — Fix: für Initial- und jeden Redirect-Zielhost private/link-local/reservierte IPs blockieren, DNS erneut prüfen und Browser-Egress begrenzen.

- Es fehlen Timeouts, Navigation-/Resource-Limits, Download-Blockierung und Browser-Prozess-Lebenszyklus; eine bösartige Seite kann Worker und RAM blockieren. — Fix: Context pro Job isolieren, harte Navigation/Gesamtzeit-/Speichergrenzen setzen, Downloads deaktivieren und Prozesse zuverlässig schließen.

- Consent-Walls, Login-Walls, Geoblocking und Bot-Challenges können Messwerte und Screenshots verfälschen, werden aber nicht als eigener neutraler Zustand modelliert. — Fix: diese Zustände erkennen, als `inconclusive` speichern und daraus keinen negativen Mailbefund erzeugen.

- Vier parallele Jobs reichen rechnerisch nur im Ideal: 4.365 × 1,8 s / 4 sind bereits rund 33 Minuten ohne Browserstart, zweites Viewport, Screenshots, Retries, Timeouts oder andere Queue-Arbeit. — Fix: vor dem Backfill Lasttest mit realem Worker durchführen und eine dedizierte, begrenzte Browser-Worker-Kapazität samt Durchsatz-SLO festlegen.

- Der Plan belegt nicht, dass die gemeinsame Queue 4.365 zusätzliche lange Jobs tragen kann; Browser-Jobs können reguläre Lead-, Personalisierungs- und Sendejobs verhungern lassen. — Fix: Job-Typ-spezifische Queues oder Reservierungen, Prioritäten und eine Backfill-Rate mit Fairness gegenüber Live-Jobs einführen.

- Ein Konsolen-Fortschritt ist nicht resumierbar und macht Abbruch, Doppel-Einreihung und exakte Backfill-Abdeckung unsichtbar. — Fix: persistierten Backfill-Run mit Cursor, idempotentem Enqueue-Key, Zählern und terminalen Fehlerzuständen anlegen.

- Mehrere Leads können dieselbe Domain haben; der Backfill erzeugt unnötige identische Browseraufrufe und erhöht Blockierungsrisiko. — Fix: nach kanonisierter finaler URL/Domain deduplizieren und Ergebnisse kontrolliert auf berechtigte Leads fan-outen.

- Der Browserweg ist nur mit HTML-Schnipseln und einer lokalen Seite getestet; die kritischen Fehler liegen in Queue-Reihenfolge, JSONB-Rennen, Redirect/SSRF, Lazy Loading, Bot-/Consent-Zuständen und Backfill-Resume. — Fix: Integrations- und Konkurrenztests für diese Fälle sowie einen kleinen produktionsnahen Canary-Backfill vor dem Vollbatch ergänzen.

VERDICT: REVISE
### Claudes Antwort

Angenommen, weil es echte Fehler im Plan waren:

- Reihenfolge war gehofft, nicht erzwungen. website_finding wartet heute nur
  auf check_website und ist idempotent, haette also aus der HTML-Stufe
  formuliert und nie nachgebessert. check_website reiht browser_check jetzt
  selbst ein, audit_pending wartet auf beide.
- Zwei Jobs auf derselben JSONB-Spalte sind ein Rennen. Eigene Spalte
  website_audit_browser plus Status.
- SSRF. Ein Browser loest DNS selbst auf und folgt Weiterleitungen; private
  und reservierte Ziele werden fuer Start-URL und jedes Redirect-Ziel
  abgewiesen, Downloads aus, harte Zeit- und Speichergrenzen, Kontext je Job.
- Consent-, Login-, Geo- und Bot-Waende sind keine Maengel. Neuer Zustand
  inconclusive, erzeugt nie einen Mailbefund.
- Vier der sieben neuen Codes duerfen nicht in eine Mail: render_blocked,
  js_errors, text_too_small, tap_targets_small. Sie werden gemessen und
  angezeigt, aber nicht behauptet. Deckt sich mit einer eigenen Messung:
  tap_targets_small traf 28 von 40 Leads.
- Keine Umsatz- oder Conversion-Behauptung. CONSEQUENCE_DE wird konditional
  getextet, auf die konkrete Folge fuer Besucher.
- Backfill resumierbar mit Cursor, dedupliziert nach Domain, ausserhalb der
  Job-Queue mit Rate-Deckel.
- Canary ueber 50 Leads vor dem Vollbatch, Fehlalarme gegen die Screenshots
  geprueft.
- mobile_overflow, empty_section und slow_load verschaerft: Hauptinhalt statt
  ganze Seite, Ausschluss von Tabs und Akkordeons, definierte Metrik dreimal
  gemessen.

Zurueckgewiesen, mit Grund:

- "Datierte Beobachtungsform in der Mail erlauben". Der Skill website-finding
  verbietet ausdruecklich jeden Hinweis darauf, woher der Befund kommt. Das
  Problem dahinter ist echt (ein Deploy macht die Aussage still falsch), wird
  aber besser durch ein Frische-Fenster geloest: aelter als 14 Tage wird vor
  dem Upload neu gemessen.
- "Eigene Queues mit Prioritaeten und Durchsatz-SLO". Ueberdimensioniert fuer
  einen Worker, den ein Mensch von Hand startet. Der Backfill laeuft ausserhalb
  der Queue, damit stellt sich die Frage nicht.
- "Speicher-, Zugriffs- und Datenschutzkonzept fuer Screenshots". Auf das
  Noetige gekuerzt: lokal, 14 Tage, verlassen den Rechner nicht.

## Runde 2 bis 4 - Codex

Runde 2: 14 Punkte, grosse Punkte aus Runde 1 als behoben bestaetigt.
  Angenommen: slow_load ist nicht mailtauglich (Cache, Netz, Standort, und
  den Messaufbau darf man laut Skill nicht nennen); browser_check muss auch
  nach einem gescheiterten HTML-Check laufen, weil genau dort 3 von 38 Seiten
  liegen; terminale Zustaende statt Wartefenster plus browser_audit_required;
  route-Handler an jeder Anfrage statt nur Vorabpruefung; Chromium-Prozess
  halten statt je Job starten; Dedup nach finaler URL; Canary mit vorher
  festgelegten Abbruchkriterien; Kennzahlen und Aufraeumen persistiert.
  Zurueckgewiesen: Egress-Proxy, eigener website_scan-Datensatz je Domain,
  eigene Queues mit Prioritaeten - alle drei ueberdimensioniert fuer einen
  Worker, den ein Mensch von Hand auf seinem eigenen Rechner startet.

Runde 3: 5 Punkte. Der wertvollste Fund des ganzen Loops: der Plan
  VERSPRACH im Ziel, die bestehenden 13 Codes wuerden am gerenderten DOM
  gemessen, und BAUTE nur einen zweiten Katalog daneben. Ein falsches no_h1
  aus rohem HTML haette weiter gewonnen - genau der bei ekomenu.nl gemessene
  Fall. Daraus wurde Schritt 7: fuenf DOM-abhaengige Codes bekommen eine
  Widerlegungsregel, site_unreachable die Umkehrung. Ebenfalls angenommen:
  ein einziger bestaetigter Fehlalarm stoppt einen Code (statt 10 Prozent
  Toleranz), Mindestzahl 15 Beobachtungen je Code, fester Ressourcenvertrag
  fuer den Backfill.

Runde 4: APPROVED. Woertlich: 'Abgesehen vom ausdruecklich akzeptierten
  DNS-Rebinding-/SSRF-Restrisiko ist der Plan jetzt implementierungsreif.'
  Der Proxy-Einwand bleibt technisch richtig und ist jetzt eine
  dokumentierte Risikowahl statt einer Planluecke.

Runden: 4 von 5. Verdict: APPROVED.

## Post-build inspection (frische Codex-Sitzung, sah den Diff kalt)

10 Befunde, 2 als kritisch eingestuft. Angenommen:

1. KRITISCH, Rennen beim Einreihen. _reihe_browser_ein lief VOR _write, der
   Browser-Job konnte also fertig sein und 'completed' schreiben, bevor
   check_website sein 'pending' hinterherschob. website_finding haette dann
   bis zum Vier-Minuten-Deckel auf eine Stufe gewartet, die schon fertig war.
   Selbst eingebaut, als ich den Testbruch 'drei Schreibvorgaenge' behoben
   habe. Jetzt: schreiben, dann einreihen, und nur im Fehlerfall ein zweiter
   Schreibvorgang zur Ruecknahme.

2. KRITISCH, keine Idempotenz in browser_check. Jede zweite Zustellung
   desselben Jobs mass die fremde Seite erneut. Jetzt derselbe Schutz wie in
   check_website: terminaler Status und kein force heisst return.

3. mobile_overflow konnte Fehlalarme in eine Mail schreiben. Jetzt zusaetzlich
   ausgeschlossen: interaktive Elemente, alles in einem waagrecht scrollenden
   VORFAHREN, Elemente unter 15 Zeichen Text.

4. empty_section ist nicht mehr versendbar. Codex hielt den Beweis fuer zu
   schwach, und der eigene Canary lieferte genau EINE Beobachtung: die eigene
   Regel sagt, unter 15 wird erweitert und nicht entschieden.

5. Der Ressourcenvertrag im Plan war technisch nicht haltbar (ein Prozess,
   vier Kontexte). Playwrights synchrone API haengt am Faden, der sie
   gestartet hat. Jetzt steht die ehrliche Fassung im Code: ein Prozess JE
   FADEN, --parallel hart auf 8 begrenzt.

6. TOTAL_TIMEOUT_MS stand da und tat nichts. Jetzt eine Frist ueber beide
   Ansichten: ist mehr als 60 Prozent verbraucht, faellt die Handy-Ansicht weg.

7. Dedup lief ueber die Eingabe-URL. Jetzt ueber eine kanonische Form
   (Host ohne www, Pfad ohne Schrägstrich am Ende, ohne Query).

8. Das Canary-Gate gab nach der Quote allein frei und meldete JA, waehrend im
   selben Bericht 'zu wenige Beobachtungen' stand. Jetzt zaehlen beide
   Kriterien, und der Grund steht daneben.

9. Vier Tests zur Reihenfolge ergaenzt, darunter genau der, der das Rennen
   gefunden haette.

OFFEN GEBLIEBEN, mit Grund:

- Das Frische-Fenster (Plan Schritt 9) ist nicht gebaut. Es gehoert in den
  Kampagnen-Upload in apps/web und damit in einen anderen Teil des Systems.
  Bis dahin kann ein Browser-Befund aelter als 14 Tage versendet werden.
- Integrationstests gegen lokal servierte Seiten (Lazy Loading, Consent-Wand,
  Akkordeon) fehlen weiterhin. Geprueft wurde stattdessen an 45 echten Leads.
- Die slow_load-Schwelle ist gesetzt und nicht aus der eigenen Verteilung
  abgeleitet. Der Code ist ohnehin nicht versendbar.

ERGEBNIS DES CANARY (20 Adressen, 2026-08-30):
  20 von 20 auswertbar, 0 Prozent nicht auswertbar.
  Befunde: 7x tap_targets_small, 4x js_errors, 3x text_too_small,
  2x render_blocked, 1x empty_section - und damit KEIN versendbarer.
  Vollbatch: NEIN, mit Grund 'kein versendbarer Befund im Canary'.

  Das ist die ehrliche Bilanz: der Wert der Browser-Stufe liegt in dieser
  Stichprobe vollstaendig im WIDERLEGEN falscher HTML-Befunde, nicht in neuen
  Vorwuerfen. Gemessen an drei Leads: drei falsche Befunde bei ekomenu.nl
  entfernt, site_unreachable bei loyaltylab.eu entfernt.
