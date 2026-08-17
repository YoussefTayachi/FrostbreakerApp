# Das Repo als Schaufenster

*2026-08-17. Plan dafür, wie `System3_App` aussehen soll, damit jemand daraus
einen Auftrag oder eine Stelle macht.*

---

## 1 · Drei Leute landen hier, und nur einer wird bedient

Das Repo ist seit jeher öffentlich. Wer darauf klickt, sieht heute zuerst die
README, und die ist für genau eine Sorte Mensch geschrieben.

**Wen die Seite überzeugen soll, ist entschieden:** jemanden, der einen
**Marketing Manager** einstellt oder beauftragt. Nicht in erster Linie einen
CTO.

Das verschiebt den Schwerpunkt. Interessant ist nicht, *wie* etwas gebaut ist,
sondern **warum es so gebaut ist**: jede Funktion ist eine Entscheidung über
Kaltakquise, und die Begründung dahinter ist die eigentliche Arbeitsprobe. Die
App ist der Beleg, nicht das Thema.

| Wer | Was er in 30 Sekunden wissen will | Wird heute bedient? |
|---|---|---|
| **Arbeitgeber / Auftraggeber im Marketing** | Versteht der Kaltakquise? Weiß der, warum etwas funktioniert? | **nein** |
| **Entwickler** (soll später daran arbeiten) | Wie starte ich das? Wo liegt was? | ja |

Der erste Satz der README lautet heute:

> SaaS: Firmen per Nische finden (Google Maps oder Apollo) → Entscheider
> identifizieren (OpenAI Web Search) → E-Mail-Adressen finden (Hunter/Apollo)
> → Adressen verifizieren (NeverBounce) → personalisierte Eröffnungszeile pro
> Lead (OpenAI) → Kampagne über Instantly versenden.

Für einen Entwickler ist das ein guter Satz: dicht, richtig, prüfbar. Für
einen Auftraggeber sind darin **sechs Firmennamen, die er nicht kennt**, ein
Pfeildiagramm in Fließtext und kein einziges Wort darüber, was er davon hat.
Er ist nach zwei Zeilen weg.

**Das Ziel dieses Plans:** dieselbe Wahrheit so aufschreiben, dass alle drei
weiterlesen, und dabei nichts weglassen, was den Entwickler überzeugt.

---

## 2 · Die Regel für jeden Satz auf der Startseite

Vier Regeln, an denen sich jeder Satz messen lassen muss:

**Kein Name ohne Erklärung.** „Apollo" sagt niemandem etwas. „Apollo, eine
Firmendatenbank" schon. Beim ersten Vorkommen ein halber Nebensatz, danach
nie wieder.

**Sag, was es für einen Menschen tut, nicht, was es aufruft.** Nicht „ruft
die NeverBounce-API auf", sondern „prüft vorher, ob die Adresse überhaupt
existiert, damit die Mail nicht zurückkommt".

**Zahlen statt Adjektive.** Nicht „umfangreich" und nicht „robust", sondern
*3.081 Firmen*, *96 Migrationen*, *167 Tests*, *364 Stunden Recherche
gespart*. Zahlen kann man nachrechnen, Adjektive schreibt jeder hin.

**Ein Bild, bevor der zweite Absatz anfängt.** Wer nach drei Zeilen noch nicht
gesehen hat, wie es aussieht, hört auf zu lesen. Das ist der ganze Grund,
warum dieser Plan existiert.

---

## 3 · Aufbau der neuen Startseite

Reihenfolge ist Absicht: erst was, dann wie es aussieht, dann was schwierig
war, dann die Technik. Wer nur die ersten zwei Abschnitte liest, hat trotzdem
verstanden, worum es geht.

| # | Abschnitt | Für wen | Inhalt |
|---|---|---|---|
| 1 | **Ein Satz** | alle | Was das Ding ist, ohne Fachwort. |
| 2 | **Das Hauptbild** | alle | Dashboard, in voller Breite, direkt unter dem Satz. |
| 3 | **Was es macht** | Auftraggeber | Fünf Schritte, je ein Satz und ein Bild. |
| 4 | **Was daran schwierig war** | Recruiter / CTO | Drei bis vier echte Probleme und ihre Lösung. **Der wichtigste Abschnitt.** |
| 5 | **Wie es gebaut ist** | Entwickler | Die heutige Architektur-Tabelle, gekürzt. |
| 6 | **In Zahlen** | alle | Umfang: Migrationen, Tests, Zeilen, laufende Dienste. |
| 7 | **Selbst starten** | Entwickler | Die heutigen Befehle. Ganz unten. |

### Der erste Satz, konkret

Statt der Pfeilkette:

> **Frostbreaker findet Entscheider in Firmen, die zu deinem Angebot passen,
> schreibt jedem eine eigene E-Mail und verfolgt, wer geantwortet hat.**
> Recherchieren, texten, versenden, nachfassen, auswerten: was sonst eine
> Handvoll Leute erledigt, läuft hier in einem Werkzeug.

Kein Produktname, kein Pfeil, und trotzdem steht da genau, was passiert.

### Der Kern: jede Funktion mit ihrer Begründung

Eine Feature-Liste überzeugt niemanden: jedes Werkzeug hat Features. Was
überzeugt, ist die **Entscheidung dahinter**. Deshalb steht neben jeder
Funktion ein Satz, warum sie so ist:

| Funktion | Die Begründung, die zählt |
|---|---|
| Entscheider statt `info@` | An eine Adresse, für die niemand zuständig ist, schreibt man nicht kalt an. |
| Filter nach Technik und offenen Stellen | Wer gerade dafür jemanden sucht, hat das Problem *jetzt*, nicht irgendwann. |
| Eigener Aufhänger je Firma | Ein eingesetzter Firmenname ist keine Personalisierung, sondern ein Serienbrief. |
| Zwölf Felder zum Angebot | Die meisten Kaltmails scheitern am unklaren Angebot, nicht am Text. |
| Sequenz statt Einzelmail | Eine Mail ist ein Los. Und am Ende steht eine kleine Frage, kein Termin: ein Termin ist die größte Bitte, die es gibt. |
| Elf Prüfungen vor dem Start | Eine verbrannte Absender-Domain kostet mehr als eine verschobene Kampagne. |
| E-Mail → LinkedIn → Telefon | Aus einem gekauften Lead das Meiste holen, statt einen neuen zu kaufen. |
| Termine statt Antwortquote | Eine Fassung kann bei den Antworten führen und nur Absagen sammeln. |
| Kosten je Abruf | Erst wenn der Preis pro Lead dasteht, ist Kaltakquise eine Rechnung statt eines Bauchgefühls. |

**Nicht zu tief.** Je Punkt ein bis zwei Sätze. Die Begründung ist das
Argument, nicht die Umsetzung: wie die Warteschlange hängende Jobs
zurückholt, gehört hier nicht hin.

---

## 4 · Die Galerie

Zehn Bilder, in der Reihenfolge des Ablaufs. Jedes bekommt eine
**Bildunterschrift in einem Satz, ohne Fachwort**: die Unterschrift ist der
eigentliche Text, das Bild ist der Beleg.

| Datei | Bildschirm | Bildunterschrift (Entwurf) | Stand |
|---|---|---|---|
| `01-dashboard` | Übersicht | „3.081 Firmen, 1.650 mit Adresse, und was die Recherche von Hand gekostet hätte." | ⚠️ Namen im Kasten „Letzte Leads" |
| `02-suche` | Neue Suche | „Nische und Ort eingeben. Vier Quellen, je nachdem was man sucht." | ✅ |
| `03-leads` | Alle Leads | „Aus der Suche wird eine Liste mit Namen und geprüften Adressen." | ✅ |
| `04-angebot` | Angebot | „Zwölf Fragen zum eigenen Angebot: sieben davon liest die App aus der eigenen Website." | ✅ |
| `05-agent` | KI-Agent | „Woraus die Eröffnungszeile entsteht, und welche Wörter nie vorkommen dürfen." | ✅ |
| `06-kampagne` | Kampagne | „Aus dem Angebot werden fertige Mailstufen, je zwei Fassungen zum Vergleich." | prüfen |
| `07-startprüfung` | Zustellbarkeit | „Elf Prüfungen, bevor etwas rausgeht. Vier davon halten den Start auf." | ✅ |
| `08-postfächer` | Postfächer | „Aufwärmphase und Tagesmenge je Postfach." | ✅ |
| `09-wirkung` | Wirkung | „Welche Textfassung Termine gebracht hat, nicht nur, welche mehr Antworten bekam." | ✅ |
| `10-kosten` | Kosten | „Jeder bezahlte Abruf mit Menge und Betrag." | ✅ |

**Bewusst nicht in der Galerie:**

- **Posteingang**: echte Antworten echter Menschen, dazu Vorschautexte mit
  Geschäftsdetails. Freier Text lässt sich nicht zuverlässig ersetzen.
- **Pipeline und Anrufliste**: dieselbe Sorte Daten, ohne eigenes Argument.

Das kostet ein Bild, das die App gut aussehen ließe. Es ist trotzdem richtig:
ein Auftraggeber, der auf dem Bild einen fremden Namen entdeckt, denkt genau
einen Gedanken: *„so geht der also mit Daten um"*.

---

## 5 · Was jedes Bild erfüllen muss

Auf keinem veröffentlichten Bild darf stehen: **ein echter Personenname, eine
echte Firma, eine echte Domain, eine E-Mail-Adresse, eine Telefonnummer, ein
LinkedIn-Profil.**

Das ist keine Förmlichkeit. Auf diesen Bildschirmen stehen Leute, die
angeschrieben wurden und nie zugestimmt haben, in einer Arbeitsprobe
aufzutauchen, und die Liste selbst ist Geschäftsinteresse: sie verrät, wen
der Betreiber anschreibt.

**Zwei Prüfungen, nacheinander:**

1. **Maschinell.** Nach dem Ersetzen wird der sichtbare Text erneut nach
   Adressen, Nummern und Profilen durchsucht. Bleibt ein Treffer, wird das
   Bild nicht abgelegt. Läuft heute schon und meldet aktuell null Treffer.
2. **Mit dem Auge.** Namen erkennt keine Regel. Jedes Bild wird einzeln
   angesehen, bevor es ins Repo geht.

**Warum ersetzt und nicht geschwärzt:** ein erster Versuch mit schwarzen
Balken hat die Lead-Liste in ein Bild aus Balken verwandelt: unbrauchbar als
Arbeitsprobe, und bei jedem Balken fragt sich der Betrachter, was darunter
steht. Ersetzt bleibt der Bildschirm ein echter Bildschirm: dieselbe App,
dieselben Spalten, dieselben Mengen, nur andere Namen.

**Was noch fehlt:** die Ersetzung greift bisher nur auf *Alle Leads*. Auf dem
Dashboard, im Posteingang und in der Pipeline sitzt der Name an einer anderen
Stelle im Markup. Für das Dashboard wird diese Regel nachgezogen: die beiden
anderen fallen aus der Galerie und brauchen sie nicht.

Nachtrag zur Sorgfalt: die erfundenen Firmennamen werden vor Gebrauch per DNS
geprüft. Zwei von zwölf Domains aus dem ersten Entwurf gehörten echten Firmen.

---

## 6 · Die Sprache: Deutsch, entschieden

**README auf Deutsch.** Begründung des Betreibers: die Seite ist für Stellen
und Aufträge im DACH-Raum. Damit bleibt das Projekt auch in diesem Punkt
einheitlich: Kommentare, Doku, Commits und README in derselben Sprache.

**Und daraus folgt etwas, das leicht übersehen wird: die Bildschirme müssen
mitziehen.** Die App kann beides; die Aufnahmen vom 17.08. stehen aber alle
auf Englisch ("Dashboard", "All Leads", "Pick a conversation on the left").
Eine deutsche Seite mit englischen Bildern liest sich wie eine Übersetzung,
die auf halbem Weg aufgehört hat, und genau bei einer Bewerbung schaut
jemand darauf.

Vor dem Aufnehmen also einmal auf **DE** stellen (Knopf unten in der
Seitenleiste) und alle zehn Bilder in einem Zug machen. Halb und halb ist
schlechter als beides einzeln.

---

## 7 · Reihenfolge der Arbeit

1. **Die Ersetzungsregel fürs Dashboard.** Ein Bildschirm, eine Stelle im
   Markup. Danach ist das Hauptbild verwendbar.
2. **Die zehn Bilder aufnehmen und einzeln ansehen.** Ablage unter
   `docs/screenshots/`.
3. **README neu schreiben** nach dem Aufbau aus Abschnitt 3.
4. **Die Entwickler-Abschnitte nach unten**, nicht löschen.

Schritt 3 ist der längste. Schritt 1 blockiert alles andere.

---

## 8 · Prüfen, bevor gepusht wird

- Jedes Bild einmal maschinell und einmal mit dem Auge geprüft.
- Die README auf dem **Telefon** ansehen. GitHub wird oft mobil gelesen, und
  eine Tabelle mit sieben Spalten ist dort unlesbar.
- Gesamtgröße der Bilder im Blick behalten: zehn Bilder à rund 400 KB sind
  etwa 4 MB. Vertretbar; darüber lohnt Verkleinern.
- **Die Gegenprobe:** jemand, der nicht programmiert, liest den ersten Absatz
  und sagt danach in eigenen Worten, was die App macht. Klappt das nicht, ist
  der Absatz falsch, nicht der Leser.
- Erst dann pushen. Was einmal im öffentlichen Verlauf steht, ist auch nach
  dem Löschen noch da.
