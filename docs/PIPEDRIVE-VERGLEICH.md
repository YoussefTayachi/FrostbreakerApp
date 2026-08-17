# Was wir von Pipedrive übernehmen sollten

Stand 2026-08-03. Grundlage: Durchsicht des eigenen Pipedrive-Kontos
(`frostbreaker.pipedrive.com`, Premium-Testzugang, 14 Tage) über den Browser.

**Einschränkung, die man beim Lesen mitdenken muss:** Das Konto ist frisch und
enthält ausschließlich Beispieldaten. Ich habe die Oberfläche und den
Funktionsumfang gesehen, aber kein Konto im echten Betrieb: wie sich das mit
2.000 Kontakten anfühlt, weiß ich nicht.

---

## 1. Die strategische Erkenntnis

Beim Durchklicken fällt eines sofort auf, und es ist wichtiger als jede
einzelne Funktion:

> **Pipedrive verkauft das CRM und lässt sich die Lead-Gewinnung extra
> bezahlen. Bei Frostbreaker ist es genau umgekehrt.**

Unter *Leads* stehen bei Pipedrive:

| Was | Was es ist |
|---|---|
| **Prospektor** | Firmen- und Kontaktsuche: kostenpflichtiges Add-on (LeadBooster) |
| **LinkedIn / Surfe** | LinkedIn-Anreicherung: Fremdanbieter aus dem Marktplatz |
| **Webbesucher** | Wer war auf der Website: Add-on |
| Livechat, Chatbot, Webformulare | Eingehende Leads: Add-on |

Prospektor ist Frostbreakers Kerngeschäft, verkauft als Zusatzpaket. Die
LinkedIn-Anreicherung, die wir seit heute nativ haben, ist bei Pipedrive eine
Fremd-App mit eigener Rechnung.

**Daraus folgt die Positionierung:**

> *„Alles, wofür Pipedrive Zusatzpakete verkauft, ist bei uns eingebaut,
> plus das CRM, das du für Kaltakquise wirklich brauchst. Ein Preis."*

Damit dieser Satz trägt, muss ein Pipedrive-Nutzer bei uns aber seine
**Gewohnheiten** wiederfinden. Darum geht es im Rest des Dokuments.

---

## 2. Was Pipedrive im Kern anders macht

Die sechs Automatisierungs-Vorlagen, die Pipedrive selbst vorschlägt, sagen
alles über ihre Philosophie:

1. Aktivität hinzufügen, wenn ein Deal weiterrückt
2. **Stagnierende Deals vermeiden** (zu lange in derselben Phase)
3. Reagieren, wenn ein Deal in eine neue Phase eintritt
4. Nachfassen, wenn niemand reagiert
5. Neue Deals direkt begrüßen
6. **Inaktive Deals wieder aufgreifen**

Alle sechs sagen dasselbe:

> **Kein Vorgang darf ohne nächsten Schritt dastehen, und keiner darf
> unbemerkt liegenbleiben.**

Das ist der Kern, und er kostet uns fast nichts: die Bausteine liegen schon
da. `activities.due_at` gibt es seit Migration 0033, `contact_status_history`
seit 0032. Was fehlt, ist die Disziplin darüber.

---

## 3. Übernehmen: nach Wirkung sortiert

### Stufe A: Der Pipedrive-Reflex (klein, sofort spürbar)

| # | Was | Warum | Aufwand |
|---|---|---|---|
| A1 | **„Ohne nächsten Schritt" sichtbar machen.** Jeder Kontakt ohne offene Aktivität wird markiert, mit eigenem Filter. | Der Reflex, den ein Pipedrive-Nutzer mitbringt. Die Pipeline zeigt seit heute `next_due_at`; es fehlt nur die Umkehrung: wer hat *keinen*. | S |
| A2 | **Stagnation anzeigen.** „Seit 18 Tagen in dieser Stufe", ab einer Schwelle rot. | Pipedrives „rotting deals". `contact_status_history` weiß das längst, es hat nur nie jemand gefragt. | S |
| A3 | **Aktivitätstypen mit Symbol und Farbe** (Anruf, Meeting, Aufgabe, Frist, E-Mail) statt reinem Text. | Macht die Anrufliste auf einen Blick lesbar. Wir haben die Typen bereits, nur ungestaltet. | S |
| A4 | **Zeitfilter als Reiter** in der Anrufliste: To-Do, Überfällig, Heute, Morgen, Diese Woche. | Genau Pipedrives Leiste. Unsere Abschnitte Überfällig/Heute/Später sind das halbe Ding ohne die Umschaltbarkeit. | S |
| A5 | **Gewonnen/Verloren als große Knöpfe** mit Verlustgrund. | `deals.lost_reason` existiert, ist aber versteckt. Der Verlustgrund ist die einzige Auswertung, die Vertriebler wirklich lesen. | S |
| A6 | **Labels** an Kontakt und Deal, frei vergebbar, farbig. | Billigste Form von Struktur, die jeder CRM-Nutzer erwartet. | M |

### Stufe B: Was ein CRM ausmacht

| # | Was | Warum | Aufwand |
|---|---|---|---|
| B1 | **Eigene Felder.** Pipedrives Deal-Detail sagt wörtlich „Ihr Detailbereich ist leer. Fügen Sie benutzerdefinierte Felder hinzu", plus Sortierung per Drag & Drop. | Die erste Frage jedes umsteigenden Nutzers. Ohne das ist es kein CRM, sondern ein Werkzeug. | L |
| B2 | **Filterbaukasten mit gespeicherten Ansichten** („Bedingung hinzufügen" → „Speichern"). | Wir haben feste Filter. Pipedrive-Nutzer bauen sich ihre eigenen und teilen sie. | M |
| B3 | **Spaltenauswahl** je Liste (Zahnrad rechts in jeder Tabelle). | Erwartung, kein Wunsch. | M |
| B4 | **Dubletten zusammenführen**: bei Pipedrive ein eigener Menüpunkt. | Steht schon in `PRODUKTPLAN.md`. Bei 21 Lead-Listen mit Überschneidung ein echtes Ärgernis und doppelte Kosten. | M |
| B5 | **Import / Export / Wiederherstellen.** Letzteres ist ein Vertrauensmerkmal: „Daten wiederherstellen" heißt, man kann nichts endgültig kaputtmachen. | Ohne Import kommt niemand von Pipedrive zu uns: das ist die Migrationsbrücke. | M |
| B6 | **Phasenfortschritt im Detail**: Balken mit Verweildauer je Phase („0 Tage"). | Beantwortet „wo hängt es" ohne Bericht. | S |

### Stufe C: Automatisierung

| # | Was | Warum | Aufwand |
|---|---|---|---|
| C1 | **Regeln nach Vorlage**, nicht als leerer Baukasten. Pipedrive zeigt sechs fertige Karten mit Vorschau: niemand baut sich eine Automatisierung aus dem Nichts. | Der größte Hebel für „fühlt sich wie ein CRM an". Vier Regeln decken den Großteil ab. | L |
| C2 | **Automatische Zuweisung** von Leads an Nutzer. | Erst ab Team relevant, für dich noch nicht. | offen |

Konkret die vier Regeln, die bei uns Sinn ergeben:

- Antwortet ein Lead → Aufgabe „innerhalb von 24 h antworten" anlegen
- Kein nächster Schritt seit *n* Tagen → Erinnerung
- Stufe wechselt auf „Meeting gebucht" → Aufgabe „Termin vorbereiten"
- Kontakt seit 60 Tagen unberührt → auf Wiedervorlage

### Stufe D: Auswertung

| # | Was | Warum | Aufwand |
|---|---|---|---|
| D1 | **Ziele** (Pipedrive: „Ziele" neben Dashboards). Z.B. 50 Erstkontakte/Woche, 5 Termine/Monat, mit Fortschritt. | Kaltakquise ist ein Zahlenspiel. Ein Ziel mit Fortschrittsbalken ist mehr wert als jedes Diagramm. | M |
| D2 | **Eigene Berichte / Dashboards.** | Groß. Wir haben ein festes Dashboard, und mit Säule 2 aus dem `PRODUKTPLAN.md` etwas, das Pipedrive gar nicht kann. Ich würde hier bewusst **nicht** hinterherbauen. | XL |

### Stufe E: Kommunikation im CRM

| # | Was | Warum | Aufwand |
|---|---|---|---|
| E1 | **Terminplaner mit Buchungslink**, gebuchter Termin wird zur Aktivität. | Steht als 3.3 im `PRODUKTPLAN.md`. Der eigentliche Umwandlungsmoment, heute komplett außerhalb der App. | M |
| E2 | **Kalender-Synchronisierung** (Google/Outlook). Pipedrive bewirbt es mit „in weniger als 2 Minuten". | Ohne das lebt die Anrufliste neben dem echten Kalender statt darin. | L |
| E3 | **Reiter am Kontakt**: Aktivität · Notiz · Anruf · E-Mail. Ein Klick, keine Seitenwechsel. | Unser Drawer kann Notiz und Aktivität, aber nicht mailen oder anrufen. | M |
| E4 | **Kommentare an Verlaufseinträgen**, anpinnbar. | Kleinigkeit mit viel Wirkung im Team. Für Einzelnutzer verzichtbar. | S |

---

## 4. Bewusst NICHT übernehmen

- **Projects, Produkte, Rechnungen**: anderes Geschäft. Wer Angebote und
  Rechnungen im CRM will, ist bei uns falsch, und das ist in Ordnung.
- **Livechat, Chatbot, Webformulare, Webbesucher**: das ist *eingehendes*
  Marketing. Frostbreaker ist ausgehend. Nicht verwässern.
- **Marktplatz mit Fremd-Apps**: setzt eine Plattformstrategie voraus, die
  wir nicht haben und nicht brauchen.
- **Eigene Berichts-Engine** (D2): dort gewinnen wir nicht durch Nachbauen.
  Unser Vorteil ist die Auswertung, die Pipedrive strukturell nicht kann:
  welcher *Aufhänger* Antworten bringt. Siehe `PRODUKTPLAN.md`, Säule 2.

---

## 5. Was der Umstieg tatsächlich blockiert

Drei Dinge, ohne die niemand von Pipedrive wechselt, egal wie gut der Rest ist:

1. **Import** (B5). Wer drei Jahre Historie in Pipedrive hat, wechselt nicht
   ohne sie. Pipedrive exportiert CSV: ein Import, der Personen,
   Organisationen, Deals und Aktivitäten versteht, ist die Brücke.
2. **Eigene Felder** (B1). Jeder gewachsene Pipedrive-Bestand hat sie. Ohne
   Ziel für diese Daten ist der Import wertlos.
3. **Der „nächste Schritt"-Reflex** (A1/A2). Er sitzt tiefer als jede
   Funktion. Fehlt er, fühlt sich unsere App wie eine Liste an, nicht wie ein
   CRM, auch wenn sie mehr kann.

---

## 6. Vorschlag

**Zuerst Stufe A komplett.** Sechs kleine Punkte, zusammen etwa eine Session,
und sie verändern das Gefühl der App am stärksten. A1 und A2 sind fast
geschenkt: die Daten liegen bereits in `activities` und
`contact_status_history`.

**Danach B5 (Import) und B1 (eigene Felder)**: die beiden Punkte, die den
Wechsel überhaupt erst möglich machen.

**Erst dann C1 (Regeln nach Vorlage).**

Nicht vergessen: Der eigentliche Burggraben bleibt Säule 2 aus dem
`PRODUKTPLAN.md`. Pipedrive einzuholen macht uns vergleichbar. Zu wissen,
welcher Aufhänger Antworten bringt, macht uns unersetzlich. Dieses Dokument
beschreibt die Eintrittskarte, nicht den Sieg.
