# Produktplan: von der Orchestrierung zum eigenständigen Werkzeug

Stand 2026-08-03. Ersetzt die Roadmap-Teile von `PROJEKTPLAN.md` (Juli 2026,
in den Phasen 3–6 überholt). Alle Zahlen sind am laufenden System gemessen,
nicht geschätzt: die Messungen stehen jeweils dabei.

**Zum Reviewen gedacht.** Nichts davon ist umgesetzt. Streich raus, was du
nicht willst, und sag mir, womit ich anfangen soll.

---

## 1. Die unbequeme Ausgangsfrage

Ein Kunde zahlt 99 €/Monat für Frostbreaker **und** bringt Apollo (~50–100 $),
Instantly (~37 $+), OpenAI und Hunter selbst mit. Er zahlt also rund 250 €
im Monat, davon 99 € an dich.

Wofür? Heute lautet die ehrliche Antwort: für die Verkettung der vier Dienste,
für die Personalisierung und für die Textprüfung. Das ist real, aber dünn
und nachbaubar.

**Die Marktlücke, die niemand besetzt:** Apollo verkauft Daten. Instantly
verkauft Zustellung. Beide sagen dir, *was* passiert ist (Öffnungen,
Antworten). **Keiner sagt dir, warum und was du ändern sollst.**

Frostbreaker hat als einziges System beide Hälften: es erzeugt die
Personalisierung *und* sieht die Antwort darauf. Das ist der Burggraben, und
er ist noch nicht gebaut.

> **Nordstern: das Outbound-System, das aus den Antworten lernt.**

Alles unten ordnet sich dieser Aussage unter. Was nicht darauf einzahlt,
steht in Abschnitt 8 unter „bewusst nicht".

---

## 2. Was die Daten über den heutigen Zustand sagen

| Messung | Wert | Was das bedeutet |
|---|---|---|
| Firmen gefunden | 1.304 | Die Lead-Maschine läuft |
| davon mit Icebreaker | 1.032 (79 %) | Personalisierung funktioniert |
| Verifizierte Adressen | 689 | Verifizierung läuft |
| **Eingehende Nachrichten** | **1** | **Die hintere Hälfte ist leer** |
| **Deals** | **0** | **CRM gebaut, aber ungenutzt** |
| **Notizen** | **0** | dito |
| **Sperrliste** | **0** | „stop"-Antworten laufen ins Nichts |
| **Fehlgeschlagene Jobs** | **467** | Niemand sieht sie |

Die vordere Hälfte des Produkts arbeitet. Die hintere (alles nach dem
Absenden) ist gebaut, aber es fließt nichts hindurch. Genau dort liegt aber
das Wertversprechen.

`api_usage` steht auf 0. Das ist **kein Fehler**: die Kostenerfassung ging
am 02.08. um 18 Uhr live, der letzte Job lief um 16:19. Sie ist schlicht noch
nie gelaufen. Beim nächsten Suchlauf gegenprüfen.

### Die 467 Fehler sind eine Produktdiagnose, keine Bugliste

| Anzahl | Fehler | Was daran ein Produktfehler ist |
|---|---|---|
| **128** | OpenAI: „You have no credits remaining" | Das Guthaben war leer, die App hat 128-mal weiter versucht und **nie Bescheid gesagt** |
| **23** | „Kein API-Key für Provider X hinterlegt" | Die App ließ Suchen starten, die **nie funktionieren konnten**, über 8 Tage hinweg |
| **~13** | Hunter: „429 Too Many Requests" | Kein Backoff gegen fremde Rate-Limits |
| **11** | `'email\xa0protected' is not a valid address` | Cloudflares Mail-Schutz landet ungefiltert in der Domain-Erkennung |

Das sind vier Systemlücken, nicht vier Einzelfälle: **keine Guthabenwarnung,
keine Vorprüfung, kein Backoff, keine Datenhygiene.** Für ein BYOK-Produkt ist
die erste die schlimmste: wenn fremdes Guthaben ausläuft, steht alles still,
und der Kunde merkt es erst, wenn eine Woche Akquise fehlt.

---

## 3. Säule 0: Es darf nie stillstehen

*Ohne das ist alles andere egal. Ein Werkzeug, dem man nicht vertraut, wird
nicht gekauft, egal wie clever es ist.*

| # | Was | Aufwand | Wirkung |
|---|---|---|---|
| 0.1 | **Guthaben-Wächter.** Erkennt „no credits"/402/429-Muster pro Anbieter, **pausiert die Warteschlange statt sie leerlaufen zu lassen**, und schickt eine Mail (Resend steht schon). Apollo und Hunter haben Verbrauchsendpunkte, OpenAI nur die Fehlermeldung, beides reicht. | S | **Sehr hoch** |
| 0.2 | **Vorprüfung beim Start einer Suche.** Welcher Suchweg braucht welche Keys? Fehlt einer, wird die Suche gar nicht erst eingereiht, sondern erklärt. `api/apollo/health` gibt es schon als Vorbild. | S | Hoch |
| 0.3 | **Betriebsseite `/status`.** Fehlgeschlagene Jobs nach Ursache gruppiert, mit „erneut versuchen". 467 Fehler waren bisher nur per SQL sichtbar. | M | Hoch |
| 0.4 | **Backoff und Drosselung** je Anbieter, zentral statt pro Pipeline. | S | Mittel |
| 0.5 | **Datenhygiene** für Cloudflare-Mailschutz und ähnliche Artefakte, mit Test. | S | Mittel |
| 0.6 | **Railway-Wächter.** Läuft der Worker? Ein Herzschlag in die DB, das Dashboard zeigt Alarm, wenn er älter als 5 Minuten ist. (Am 13.08. läuft das Guthaben aus: genau dieser Fall.) | S | Hoch |

---

## 4. Säule 1: Qualität vor dem Senden

*Hier ist Frostbreaker heute schon am stärksten. Das ist der Teil, den man in
einer Demo zeigt.*

Vorhanden: Lesbarkeit, Spam-Trigger, KI-Klang (`lib/email-quality`),
Zustellbarkeits-Check, Adressverifizierung, Icebreaker-Regeln.

| # | Was | Aufwand | Wirkung |
|---|---|---|---|
| 1.1 | **A/B-Varianten je Schritt.** Instantlys API kann das längst (`variants[]`), wir nutzen bewusst nur eine. Zwei Varianten plus Auswertung, welche gewinnt, mit Hinweis, ab wann die Zahl belastbar ist. | M | **Sehr hoch** |
| 1.2 | **Postfach-Platzierungstest.** Testmail an Seed-Postfächer, Anzeige ob Posteingang / Werbung / Spam. Dafür zahlen Teams heute separat (GlockApps, MailReach). Gebündelt ist das ein eigenes Verkaufsargument. | L | Hoch |
| 1.3 | **Icebreaker-Güte messen, nicht nur Regeln prüfen.** Heute wird auf verbotene Wörter und Länge geprüft. Fehlt: nennt die Zeile einen *überprüfbaren, spezifischen* Fakt oder ist sie generisch? Generische vor dem Versand markieren. | M | **Sehr hoch** |
| 1.4 | **Vorlagen-Bibliothek.** Erprobte Sequenzen nach Branche und Rolle, aus `docs/KALTAKQUISE-VORLAGEN.md` und dem `cold-email-copy`-Skill gespeist. Ein neuer Nutzer sieht in Minute 1 etwas Brauchbares statt eines leeren Feldes. | M | Hoch (Vertrieb!) |
| 1.5 | **Spam-Score gegen echte Regeln** (SpamAssassin-Regelwerk) statt nur Heuristik. | M | Mittel |

---

## 5. Säule 2: Der geschlossene Kreis

*Das ist der Burggraben. Alles andere kann kopiert werden, das hier braucht
beide Hälften, und die hat nur Frostbreaker.*

**Voraussetzung:** die Verbindung von Antwort zurück zur Ursache existiert
noch nicht. `messages.step_order` ist bei 0 von 33 Nachrichten gefüllt. Ohne
diese Instrumentierung ist der Rest der Säule nicht baubar.

| # | Was | Aufwand | Wirkung |
|---|---|---|---|
| 2.1 | **Instrumentierung.** Antwort → Schritt, Variante, Icebreaker, Suche, Segment zurückverfolgbar machen. Fundament für alles Weitere. | M | Voraussetzung |
| 2.2 | **Winkel-Kennzeichnung.** Jeder Icebreaker bekommt seinen Blickwinkel angeheftet (Einstellungen, Tech-Stack, Standortwachstum, Kapazität …), erzeugt vom selben Modell, das ihn schreibt. | S | Hoch |
| 2.3 | **Antwortquote je Winkel, Segment, Schritt.** „Kapazität: 4,1 % · Preis: 0,8 %". Alle Felder dafür liegen schon in der DB (Branche, Größe, Seniorität, Land, Quelle). | M | **Sehr hoch** |
| 2.4 | **Empfehlungen statt Diagramme.** „Schritt 3 bringt 0,2 % und kostet 40 % deines Volumens: streichen?" Das ist der Satz, den kein Wettbewerber sagen kann. | M | **Sehr hoch** |
| 2.5 | **Negativ-Lernen.** Welche Formulierungen korrelieren mit „kein Interesse"? Fließt zurück in die Verbotsliste des Prompts. | M | Mittel |

Wenn nur eine Sache aus diesem ganzen Dokument gebaut wird, dann diese Säule.
Sie ist der Grund, warum jemand Frostbreaker behält, statt nach drei Monaten
zu Apollo + Instantly zurückzugehen.

---

## 6. Säule 3: Nach der Antwort

*0 Deals, 0 Notizen. Das CRM ist gebaut und wird nicht benutzt. Die Lehre
daraus ist nicht „mehr CRM bauen", sondern: **es muss auf dem Weg liegen**,
statt ein Ort zu sein, den man extra aufsucht.*

| # | Was | Aufwand | Wirkung |
|---|---|---|---|
| 3.1 | **Auto-Sperrliste bei Absage.** Klassifiziert der Sync „not_interested" oder enthält die Antwort „stop"/„unsubscribe", landet die Adresse automatisch in `suppression_list`. Heute: 0 Einträge, alles von Hand. Rechtlich relevant, nicht nur bequem. | S | **Sehr hoch** |
| 3.2 | **Antwort-Arbeitsfläche.** Eingehende Antwort mit KI-Entwurf, „Termin vorschlagen", „kein Interesse", „später erinnern": alles ein Klick, ohne die Seite zu wechseln. | L | **Sehr hoch** |
| 3.3 | **Terminbuchung.** Kalender-Link in der Antwort, gebuchter Termin landet als Aktivität. Der eigentliche Umwandlungsmoment, heute komplett außerhalb der App. | M | Hoch |
| 3.4 | **Deal automatisch anlegen** bei „interessiert", statt darauf zu warten, dass jemand ein Formular ausfüllt. Erklärt die 0. | S | Hoch |
| 3.5 | **Mehrkanal-Folgeschritte.** LinkedIn-Nachricht als geplanter Schritt *nach* zwei unbeantworteten Mails: die Kanal-Spalte aus 0057 trägt das schon. | M | Hoch |

---

## 7. Säule 4: Erste zehn Minuten

*Für „alle wollen das haben" der wichtigste Abschnitt. Vier fremde Accounts
vor dem ersten Nutzen ist der härteste Absprungpunkt, den ein Produkt haben
kann.*

| # | Was | Aufwand | Wirkung |
|---|---|---|---|
| 4.1 | **Geführtes Onboarding** mit Fortschritt statt einer Einstellungsseite mit sechs leeren Feldern. Jeder Schritt sagt, was er kostet und warum er nötig ist. | M | **Sehr hoch** |
| 4.2 | **Demo-Modus.** Echte Beispieldaten ohne einen einzigen Key. Man sieht das Produkt, bevor man Konten anlegt. Halbiert typischerweise die Abbruchquote im Signup. | M | **Sehr hoch** |
| 4.3 | **Erste Kampagne als Assistent.** Nische → Suche → Kampagne in einem Fluss, statt fünf Seiten in der richtigen Reihenfolge zu finden. | L | Hoch |
| 4.4 | **Tarif mit inkludierten Keys.** Du kaufst Apollo/OpenAI-Kontingent und schlägst auf. Beseitigt den größten Einwand überhaupt, aber Geschäftsentscheidung, Vorfinanzierung und ein Verbrauchslimit-System nötig. | XL | Sehr hoch, aber teuer |
| 4.5 | **Kartenpflicht beim Trial** (offener Punkt aus `SIGNUP-KORREKTUR-PLAN.md`, Vektor besteht unverändert). | M | Hoch |

---

## 8. Säule 5: Handwerk, UI, Design, Kleinkram

*Er hat ausdrücklich nach Kleinigkeiten gefragt. Diese hier kosten wenig und
sind im täglichen Gebrauch sofort spürbar.*

- **Arbeitsflächen vereinheitlichen.** `/calls`, `/linkedin`, `/inbox` sind
  dreimal dasselbe Muster (Warteschlange abarbeiten) in drei Gestalten. Ein
  gemeinsames Muster, gleiche Tastenkürzel, gleiche Kopfzeile.
- **Tastaturbedienung** in den Warteschlangen: `J`/`K` blättern, `C` kopieren,
  `E` erledigt, `/` suchen. Wer 100 Kontakte am Tag abarbeitet, merkt das sofort.
- **Sammelaktionen** in `/leads`: mehrere auswählen → sperren, Status setzen,
  einer Kampagne zuweisen.
- **Leere Zustände**, die den nächsten Schritt nennen statt „keine Daten".
- **Dubletten über Suchen hinweg** erkennen und zusammenführen: bei 21 Listen
  mit Überschneidung ein echtes Ärgernis (und doppelte Kosten).
- **Suche und Filter in `/leads`** (Branche, Land, Status, Quelle, Größe).
- **Betriebs-Widget aufs Dashboard**: Worker lebt? Guthaben knapp? Jobs
  gescheitert?
- **Spalten-Auswahl und Export** je Ansicht.
- **Dunkles Design durchgängig prüfen**: es gibt Stellen mit geratenen
  Kontrasten.
- **Mobil wenigstens lesbar.** Niemand baut Kampagnen am Handy, aber Antworten
  am Wochenende durchsehen will man schon.

---

## 9. Säule 6: Rechtssicherheit als Verkaufsargument

*Hier liegt ein Vorteil, den ein US-Wettbewerber strukturell nicht hat.*

Apollo und Instantly sind US-Produkte mit US-Rechtsverständnis (CAN-SPAM:
Opt-out genügt). In Deutschland verlangt **§ 7 UWG** für E-Mail-Werbung
grundsätzlich eine vorherige Einwilligung, auch im B2B: die Rechtslage ist
deutlich enger, als die US-Werkzeuge unterstellen. Das ist für DACH-Kunden ein
reales Risiko und damit für dich ein Verkaufsargument.

- Aufbewahrungsfristen und automatische Löschung
- Auskunft und Löschung nach Art. 15/17 DSGVO als Knopf
- AVV-Vorlage, Verzeichnis der Verarbeitungstätigkeiten
- Herkunftsnachweis je Kontakt („woher stammt diese Adresse")
- Länderabhängige Warnungen im Kampagnen-Editor

**Wichtig:** Das ist kein Rechtsrat und ersetzt keinen Anwalt. Aber ein
Produkt, das diese Fragen sichtbar behandelt, verkauft sich in der DACH-Region
gegen jedes US-Werkzeug.

---

## 10. Bewusst nicht bauen

- **Eigene Sende-Engine.** Zustellbarkeit ist ein jahrelanger Graben. Instantly
  bleibt.
- **Eigene Datenquelle.** Apollo bleibt.
- **Instagram, X, Facebook.** 16 bzw. 5 Kontakte im Bestand. Das Schema hält
  die Tür offen, mehr braucht es nicht.
- **Automatisiertes Senden auf LinkedIn/WhatsApp.** Sperrt Kundenkonten,
  siehe Migration 0057.
- **Mobile App.**
- **Mehr CRM-Umfang.** Erst muss das vorhandene benutzt werden.

---

## 11. Vorschlag zur Reihenfolge

Jede Stufe ist für sich nützlich und endet mit etwas Vorzeigbarem.

**Stufe 1: Vertrauen (1–2 Sessions).**
0.1 Guthaben-Wächter · 0.2 Vorprüfung · 0.6 Worker-Herzschlag · 3.1 Auto-Sperrliste
→ *Die App steht nie mehr still, ohne es zu sagen. Rechtlich sauberer.*

**Stufe 2: Der Kreis schließt sich (2–3 Sessions).**
2.1 Instrumentierung · 2.2 Winkel · 2.3 Auswertung · 1.1 A/B-Varianten
→ *Ab hier kann die App etwas sagen, das kein Wettbewerber sagen kann.*

**Stufe 3: Aus Antworten werden Termine (2 Sessions).**
3.2 Antwort-Arbeitsfläche · 3.4 Auto-Deal · 3.3 Terminbuchung
→ *Das CRM füllt sich von selbst, statt gefüllt werden zu müssen.*

**Stufe 4: Verkaufbar (2–3 Sessions).**
4.1 Onboarding · 4.2 Demo-Modus · 4.5 Kartenpflicht · 0.3 Betriebsseite
→ *Ein Fremder kann sich anmelden und kommt allein zum ersten Ergebnis.*

**Stufe 5: Schärfe (laufend).**
1.3 Icebreaker-Güte · 1.4 Vorlagen · 2.4 Empfehlungen · Säule 5 Kleinkram

**Später, wenn die Nachfrage es rechtfertigt:** 1.2 Platzierungstest,
4.4 Tarif mit Keys, Säule 6 vollständig.

---

## 12. Wie sich der Preis dadurch rechtfertigt

| Heute | Nach Stufe 2 | Nach Stufe 4 |
|---|---|---|
| „Verkettet meine Werkzeuge" | „Sagt mir, welcher Winkel funktioniert" | „Ersetzt meinen Outbound-Prozess" |
| 99 € neben 150 € Fremdkosten schwer zu begründen | Eigenständiger Wert, der nirgends sonst existiert | Höherer Preis wird verhandelbar |

Der Satz, auf den alles hinausläuft und der heute noch nicht stimmt:

> *„Frostbreaker hat mir gesagt, dass mein zweiter Schritt nichts bringt und
> welcher Aufhänger stattdessen funktioniert. Das sagt mir sonst niemand."*
