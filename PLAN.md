# Plan: Website-Befunde massenhaft, gemessen im echten Browser

_Locked via claudex-loop - by Claude + Youssef, 2026-08-30. Fassung 4 nach Codex-Runde 3._

## Goal

Der Website-Befund in Frostbreaker soll für jeden Lead entstehen, nicht für
zwei Drittel, und er soll etwas benennen, das dem Empfänger wehtut. Heute
liest der Check rohes HTML ohne Browser, kennt 13 Mängel, wählt davon einen
und lässt daraus einen Satz mit 20 Wörtern schreiben. Gemessen an 38 echten
Leads bekommen 10 davon gar keinen Befund, und der häufigste Gewinner ist
`no_og_image`, also "beim Teilen erscheint kein Bild".

Nach diesem Plan misst eine zweite Stufe dieselbe Seite in einem echten
Chromium. Der stärkste Befund daraus geht in 2 bis 3 Sätzen in die Mail: was
kaputt ist, warum das ein Problem ist, und was es für Besucher bedeutet.
Ruhiger, respektvoller Ton, kein Alarm.

**Die Messlatte für einen versendbaren Befund:** der Empfänger kennt seine
Seite besser als wir. Was er in dreißig Sekunden widerlegen kann, darf nicht
in die Mail. Das schneidet mehr aus dem Katalog heraus, als der erste Entwurf
vorsah, und ist der Kern dieser Fassung.

## Approach

1. **`apps/worker/worker/website_browser.py`** (neu). Playwright für Python,
   `measure(url) -> dict`: navigieren, in Schritten durchscrollen (sonst meldet
   Lazy Loading falsche Befunde), Sonden im DOM, Desktop- und iPhone-Kontext,
   Screenshot, Ladezeit. Wirft nie: ein Fehler ist selbst ein Ergebnis.
   Portiert aus `apps/web/scripts/lead-scan.mjs`, das an 40 echten Leads lief.

   Harte Grenzen, weil eine fremde Seite feindlich sein kann: eigener
   Browser-**Kontext** je Job, Navigations- und Gesamtzeitlimit, Downloads aus,
   Kontext im `finally` geschlossen.

   Der Chromium-**Prozess** wird dagegen gehalten und erst nach N Jobs
   rotiert. Ein Kaltstart kostet rund eine Sekunde und damit mehr als die
   halbe Messung selbst.

2. **Zieladressen prüfen, und zwar an jeder Anfrage.** Vorab wird die Ziel-IP
   der Start-URL aufgelöst und gegen private, link-local und reservierte
   Bereiche geprüft, IPv4 und IPv6. Weil eine Vorabprüfung nichts über die
   Verbindung sagt, die Chromium danach wirklich aufbaut, hängt zusätzlich ein
   `route`-Handler an **jeder** Anfrage des Kontexts, auch an Bildern,
   Skripten und iframes, und bricht sie bei nicht-öffentlichem Ziel ab.

   Der von Codex verlangte eigene Egress-Proxy ist abgelehnt: der Worker läuft
   auf einem Heim-PC, und der heutige httpx-Weg trägt dasselbe Risiko ohne
   jede Prüfung. Der Route-Handler schließt die Lücke, die praktisch
   erreichbar ist, und kostet zehn Zeilen statt einer Infrastruktur.

3. **Ein neuer Zustand: `inconclusive`.** Consent-Wall, Login-Wall, Bot-Challenge
   oder Geoblock sind **kein Mangel**, sondern eine Messung, die nichts sagt.
   Sie werden erkannt, so gespeichert und erzeugen nie einen Mailbefund.

4. **Der Browser-Katalog ist kurz.** Nur was ein Inhaber nicht widerlegen kann:

   | Code | Bedingung | in die Mail |
   |---|---|---|
   | `mobile_overflow` | waagrechter Überlauf im Hauptinhalt, nicht interaktiv, mit Beleg-Element | ja |
   | `empty_section` | großer Textblock unsichtbar nach stabiler Wartezeit, kein Menü, Dialog, Tab, Akkordeon oder Cookie-Zustand | ja |
   | `render_blocked` | HTML ohne Hauptinhalt, Browser mit | **nein** |
   | `slow_load` | definierte Metrik, dreimal gemessen, Median gespeichert | **nein** |
   | `js_errors` | first-party, ungefangen | **nein** |
   | `text_too_small` | Hauptinhalt unter 12px | **nein** |
   | `tap_targets_small` | Ziele unter 44px | **nein** |

   Die fünf mit **nein** werden gemessen und gespeichert, weil sie in der
   Oberfläche etwas wert sind, gehen aber nie in eine Mail. Gründe der Reihe
   nach: Client-Rendering ist eine Entscheidung und kein Fehler; Konsolenfehler
   kommen meist von fremden Skripten; kleine Schrift und dichte Knöpfe sind
   Geschmack, und `tap_targets_small` traf gemessen 28 von 40 Leads. Was fast
   jeder hat, überzeugt niemanden.

   **`slow_load` ist nachträglich dazugekommen** und das tut weh, weil die
   Ladezeit der offensichtlichste Gewinn eines echten Browsers wäre. Sie ist
   trotzdem nicht versendbar: gemessen wird von einem Rechner, mit einem Netz,
   zu einer Zeit. Der Inhaber lädt seine Seite aus dem Cache und sieht etwas
   anderes, und den Messaufbau dürfen wir laut Skill nicht nennen. Damit steht
   Aussage gegen Erfahrung, und die Mail ist erledigt. Dieselbe Begründung
   steht längst im Docstring von `website_audit.py`; ein echter Browser ändert
   daran weniger, als es zuerst aussieht.

   **Damit bleiben zwei versendbare neue Codes.** Das ist der ehrliche Ertrag:
   der Gewinn liegt weniger in neuen Vorwürfen als darin, dass die bestehenden
   13 endlich am gerenderten DOM gemessen werden und die falschen darunter
   verschwinden.

5. **Eigene Spalte statt gemeinsamer.** Migration `website_audit_browser`
   (JSONB) plus `website_audit_browser_status`. Beide Stufen in dieselbe Spalte
   schreiben zu lassen heißt, dass die langsamere die schnellere überschreibt.

6. **Die Reihenfolge wird erzwungen, nicht gehofft.** `check_website` reiht
   `browser_check` selbst ein, nachdem sein eigenes Ergebnis geschrieben ist,
   **auch wenn es selbst gescheitert ist**: genau dort liegt ein Teil des
   Gewinns, denn 3 von 38 Seiten waren per rohem HTTP nicht abrufbar und im
   Browser schon. Nur bei fehlender oder abgewiesener URL wird der Status auf
   `skipped` gesetzt und kein Job erzeugt.
   `website_finding.audit_pending()` wartet auf **beide** Stufen, und zwar auf
   einen terminalen Zustand (`completed`, `inconclusive`, `skipped`, `failed`)
   statt auf ein Zeitfenster; das bestehende Vier-Minuten-Fenster bleibt nur
   als Notbremse. Gewartet wird ausserdem nur, wenn `browser_audit_required`
   für diese Zeile gesetzt ist: alte Zeilen ohne Browser-Stufe und Leads ohne
   prüfbare URL wären sonst von "wartet noch" nicht zu unterscheiden.

   Ohne diese Verdrahtung formuliert der Finding-Job aus der HTML-Stufe, und
   sein Idempotenz-Schutz (`if biz.get("website_finding") and not force`)
   sorgt dafür, dass er nie wieder nachbessert. Der Browser-Befund käme dann
   an, ohne je in einer Mail zu landen. Von Codex gefunden.

7. **Der Browser widerlegt den HTML-Check, bevor `top_finding()` wählt.**
   Das ist der eigentliche Ertrag und stand in Fassung 3 nur im Ziel, nicht
   im Vorgehen: ein zweiter Katalog daneben ändert nichts daran, dass ein
   falsches `no_h1` aus dem rohen HTML weiterhin gewinnen kann. Von Codex
   gefunden, und es ist genau der Fall, der bei ekomenu.nl gemessen wurde.

   Fünf der 13 bestehenden Codes hängen am DOM und bekommen deshalb eine
   Widerlegungsregel: sieht der Browser das Element, wird der HTML-Befund
   verworfen statt gerankt.

   | HTML-Code | verworfen, wenn der Browser sieht |
   |---|---|
   | `no_h1` | mindestens ein sichtbares `h1` |
   | `no_meta_description` | eine nicht leere `meta description` |
   | `no_contact_route` | Formular, `mailto:` oder `tel:` |
   | `no_tel_link` | einen `tel:`-Verweis |
   | `no_og_image` | ein `og:image` |
   Die übrigen acht (`site_unreachable`, `ssl_broken`, `no_https`,
   `no_viewport`, `stale_copyright`, `mixed_content`, `site_builder`,
   `legacy_markup`) hängen am Transport oder am gelieferten Dokument und
   werden vom gerenderten DOM nicht widerlegt.

   `site_unreachable` bekommt die Umkehrung: erreicht der Browser die Seite,
   ist sie nicht unerreichbar. Gemessen betrifft das 3 von 38 Leads.

   Zeilen ohne Browser-Stufe verhalten sich unverändert wie heute.

8. **`website_finding.py` umstellen.** `FINDING_MAX_WORDS` von 20 auf 55.
   Prompt: ein Mangel, 2 bis 3 Sätze, Tatsache, warum sie ein Problem ist, was
   sie für Besucher bedeutet. **Keine Umsatz-, Conversion- oder
   Kundenverlust-Behauptung** und keine Prozentzahl: das ist eine Kausalkette,
   die niemand belegen kann. `CONSEQUENCE_DE` der neuen Codes wird entsprechend
   konditional getextet ("auf einem Handy muss man seitwärts schieben, um den
   Text zu Ende zu lesen").

9. **Frische-Fenster.** Ein Browser-Befund älter als 14 Tage wird vor dem
   Kampagnen-Upload neu gemessen. Eine Beobachtung aus einem Browser ist an
   einen Zeitpunkt gebunden, und ein Deploy beim Lead macht sie still falsch.
   Das ist der Ersatz für Codex' Vorschlag, das Datum in die Mail zu schreiben:
   das verbietet der Skill `website-finding` ausdrücklich.

10. **Backfill als eigenes Skript, nicht in der Job-Queue.** Resumierbar über
    einen Cursor, idempotenter Schlüssel je Lead, Zähler, terminale
    Fehlerzustände. Dedupliziert **innerhalb eines Laufs** nach kanonisierter
    finaler URL: mehrere Leads teilen sich eine Website, und dieselbe Seite
    fünfmal zu laden erhöht nur das Risiko, geblockt zu werden. Das Ergebnis
    einer Domain wird danach auf alle ihre Leads geschrieben.

    Codex' Vorschlag, dafür einen eigenen `website_scan`-Datensatz je Domain zu
    modellieren, auf den Leads verweisen, ist sauberer und trotzdem abgelehnt:
    eine Schemaänderung mit Fan-out-Logik für ein Problem, das ein Dictionary
    im Lauf löst. Wird der Backfill zur Dauereinrichtung, gehört es nachgeholt.

    **Der Ressourcenvertrag steht vorher fest**, nicht als "Rate-Deckel":
    höchstens 4 gleichzeitige Kontexte, genau 1 Chromium-Prozess, Rotation
    nach 50 Jobs, 30 Sekunden je Seite und 90 Sekunden je Lead inklusive
    beider Viewports, ein Wiederholungsversuch. Die Batchgröße je Durchgang
    kommt aus den Canary-Zahlen und wird dort eingetragen, bevor der Vollbatch
    startet.

11. **Canary vor dem Vollbatch:** 50 Leads, jeder versendbare Befund von Hand
    gegen seinen Screenshot geprüft. Die Kriterien stehen **vorher** fest,
    sonst rechtfertigt ein wohlwollender Blick jeden Vollbatch:

    - **Ein einziger bestätigter Fehlalarm** eines versendbaren Codes setzt
      diesen Code auf nicht-versendbar. Keine tolerierte Quote: der Code
      behauptet eine Tatsache über die Seite eines Fremden, und bei zwei
      versendbaren Codes ist eine Quote ohnehin nicht schätzbar. Von Codex
      gefordert, gegen die zuvor geplanten 10 Prozent.
    - Mindestens **15 Beobachtungen je versendbarem Code**, sonst wird der
      Canary erweitert statt entschieden.
    - **Über 20 Prozent** blockierte oder `inconclusive` gemessene Seiten:
      Vollbatch gestoppt, erst die Ursache klären.
    - Festgehalten werden ausserdem Laufzeit im 50. und 95. Perzentil,
      Browserstartkosten, Speicherhochstand und Retryquote. Die Hochrechnung
      auf 4365 kommt aus diesen Zahlen und nicht aus der Einmalmessung von 40.

12. **Tests.** Reine Auswertung mit gespeicherten DOM-Zuständen (wie
    `test_website_audit.py`), dazu Playwright-Tests gegen lokal servierte
    Seiten für: Lazy Loading, Consent-Wall, Akkordeon (darf **kein**
    `empty_section` sein), Redirect auf eine private IP (muss abgewiesen
    werden), und die Reihenfolge beider Stufen.

    Dazu ein Test je Widerlegungsregel aus Schritt 7: HTML ohne `h1`,
    dessen `h1` erst das Skript einsetzt, darf **keinen** `no_h1`-Befund
    ergeben. Das ist der ekomenu.nl-Fall.

## Key decisions & tradeoffs

- **Zweite Stufe statt Ersatz.** Browser und HTML scheitern unterschiedlich:
  3 von 38 Seiten bekam nur der Browser, und laut Recherche wird ein
  Headless-Chromium von Cloudflare eher abgewiesen als ein schlichter Abruf.
- **Ein Mangel, drei Sätze** statt drei Mängel. `{{websiteFinding}}` steht in
  einer Sequenz, die Begrüßung, Personalisierung und CTA schon mitbringt.
- **Vier der sieben neuen Codes sind nicht versendbar.** Sie zu messen kostet
  nichts, sie zu behaupten kostet die Antwort.
- **Keine Geldbehauptung.** Youssefs Vorgabe war "warum es schlecht fürs
  Unternehmen ist"; erfüllt wird sie über die konkrete Folge für Besucher, denn
  eine Umsatzaussage ist in einer Kaltmail unbelegbar und beim ersten Zweifel
  ist die Mail erledigt.
- **Messen und Werten bleiben getrennt.** Eine Regeländerung darf nicht 4365
  Seiten neu laden.
- **Kein Rückfallsatz.** Kein Befund heißt leeres Feld. Unverändert.

## Toolchain

- **Claude (Build):** `website-finding` als Regelwerk für Gewichtung, Belege
  und Ton; `playwright-tester` für die Tests des Browserwegs.
- **Codex (Review):** keine Skills nötig.

## Assumptions

1. 13 Codes heute, ein Gewinner via `top_finding()` - Quelle: `website_audit.py`
2. Ein Satz, 20 Wörter, via OpenAI - Quelle: `pipelines/website_finding.py`
3. Ladezeit bewusst nicht erhoben, "ohne echten Browser nicht seriös messbar"
   - Quelle: Docstring `website_audit.py`
4. 10 von 35 Leads ohne Befund, häufigster Gewinner `no_og_image` (13x)
   - Quelle: echter Katalog über 38 Leads, 2026-08-30
5. 3 von 38 per rohem HTTP nicht abrufbar, im Browser schon - dieselbe Messung,
   Vorbehalt: einfacherer Abruf als `website_fetch.py`
6. 1 von 38 (ekomenu.nl) meldet fälschlich "kein h1, keine description"
7. Playwright 1,8 s je Seite bei 8 parallel - `apps/web/scripts/lead-scan.mjs`
8. Der Worker läuft lokal, nicht dauerhaft im Container - Docstring `main.py`
9. Playwright in Docker bräuchte ~1 GB je Browser und `/dev/shm` > 64 MB
   - Recherche 2026-08-30, gilt erst bei einem Umzug in einen Container
10. Der Finding-Job ist heute idempotent und bessert nie nach
    - Quelle: `website_finding.run()`, von Codex gefunden

## Risks / open questions

- **DNS-Rebinding bleibt offen, mit Ansage.** Codex besteht in drei Runden
  auf einem verbindungsdurchsetzenden Proxy, weil der Route-Handler den
  Hostnamen sieht und nicht die IP, zu der Chromium danach wirklich
  verbindet. Technisch hat er recht, das ist ein TOCTOU-Fenster. Trotzdem
  abgelehnt: die Lead-URLs stammen aus Apollo und der eigenen Suche, nicht
  von jemandem, der weiß, dass hier ein Browser läuft, der heutige
  httpx-Weg trägt dasselbe Risiko seit Monaten ohne jede Prüfung, und der
  Worker läuft auf einem Heim-PC ohne interne Dienste. Vorabprüfung plus
  Route-Handler nehmen den einfachen Fall; das Restrisiko steht hier, damit
  es eine Entscheidung ist und kein Versehen. Zieht der Worker je in eine
  Umgebung mit erreichbaren internen Diensten, wird der Proxy Pflicht.
- **Bot-Erkennung.** Unbekannt, wie viele der 4365 betroffen sind. Der Canary
  soll genau das zuerst beantworten.
- **Schwellen sind gesetzt, nicht gemessen.** Aus 40 Leads abgeleitet; bei 300
  können sie kippen. Der Canary prüft sie gegen die Screenshots.
- **Ladezeit-Schwelle offen.** Muss aus der Verteilung der eigenen Leads
  kommen, nicht aus einer Zahl aus dem Internet.
- **Durchsatz.** 4365 × 1,8 s bei 4 parallel sind rechnerisch 33 Minuten, aber
  ohne Browserstart, zweiten Viewport, Screenshots, Timeouts und Retries. Die
  echte Zahl liefert der Canary.
- **Screenshots** bleiben lokal unter `out/`, benannt nach dem Lead-Schlüssel
  und damit kollisionsfrei. Aufgeräumt wird zu Beginn des nächsten Laufs:
  alles über 14 Tage fliegt. Ein paar Zeilen Code, kein Dienst, getestet wie
  der Rest. Sie können Kontaktdaten und Cookie-Banner enthalten, verlassen den
  Rechner nicht und gehen in keine Mail.
- **Kennzahlen je Lauf werden geschrieben, nicht nur gedruckt**:
  Statusverteilung, Befundrate je Code, abgewiesene Zieladressen,
  Blockierungen, Laufzeit-Perzentile, Retries. Eine JSON-Datei je Lauf. Ein
  Konsolenzähler ist nach dem Schließen des Fensters weg, und an diesen Zahlen
  hängt die Entscheidung über den Vollbatch.

## Out of scope

- Die Sequenz und Mail 1 selbst.
- Unterseiten crawlen. Massenhaft vervielfacht es die Abrufe je Lead.
- Lighthouse und Core Web Vitals als volle Suite.
- Screenshots in Supabase Storage.
- Eigene Queues mit Prioritäten. Der Backfill läuft außerhalb der Queue, damit
  stellt sich die Fairness-Frage gar nicht erst.
