# Antwortquote: Befund, Massnahmen, offene Punkte

Stand 2026-08-04. Entstanden aus einer Bestandsaufnahme, die Youssef
angefordert hat: was fehlt der App, damit aus Kaltakquise verlaesslich
Antworten und daraus Kunden werden.

Dieses Dokument beschreibt den **gemessenen** Zustand, nicht den vermuteten.
Alle Zahlen stammen aus der Produktionsdatenbank vom 2026-08-04. Wer daran
weiterarbeitet, sollte sie nachmessen statt sie zu glauben -- die Abfragen
stehen jeweils dabei.

---

## Der Befund

### Die App ist stark bis zum Absenden und war danach blind

| | |
|---|---|
| Versendet | 312 |
| Echte Antworten | 1 |
| Abwesenheitsnotizen | 7 |
| Oeffnungen ueber alle 5 Kampagnen | **0** |
| Termine / Deals | 0 / 0 |

Einschraenkung, die man bei jeder Bewertung dieser Zahlen mitdenken muss:
die Kampagnen liefen zu diesem Zeitpunkt seit dem 2026-08-02. Die Sequenzen
haben 3 bis 4 Schritte mit 3 Tagen Abstand, es war also erst die ERSTE Mail
draussen. Die Antwortquote ist damit noch kein Urteil. Die fehlende Messung
ist es.

```sql
select sum(emails_sent_count), sum(reply_count_unique), sum(open_count)
  from instantly_campaign_stats;
```

### Was die Datenbank ueber die Qualitaet sagte

```sql
select personalization_needs_review, count(*),
       count(*) filter (where array_length(regexp_split_to_array(trim(personalization),'\s+'),1) > 22) zu_lang
  from businesses where personalization is not null group by 1;
```

| | Anzahl | davon zu lang |
|---|---|---|
| markiert als "zu pruefen" | 766 | 705 |
| nicht markiert | 266 | 31 |

`personalization_needs_review` kam in der **gesamten Web-App an keiner
Stelle vor**. Drei Viertel aller Aufhaenger waren als mangelhaft bekannt und
sind trotzdem rausgegangen.

Der Median liegt bei 24 Woertern, die Vorgabe bei 22 -- das Modell schiesst
systematisch leicht ueber, und niemand hat es je gesehen.

### Zustellbarkeit

- Eine Kampagne hatte 6 Bounces auf 30 Mails (**20 %**). Ab 5 % greifen die
  Schutzmechanismen der Empfaenger-Provider, und der Ruf der Absender-Domain
  traegt das dauerhaft mit.
- 1936 von 2625 Kontakten hatten nie eine Adresspruefung gesehen
  (`email_verification_status is null`).
- `lib/deliverability.ts` konnte SPF/DKIM/DMARC schon pruefen, lief aber nur
  auf Knopfdruck und hinderte niemanden am Senden.

---

## Was daraufhin gebaut wurde

### 1. Die Pruefschleife (`/icebreaker`)

Code: `lib/personalization/review.ts` (Logik, mit Tests) ·
`app/api/personalization/review/route.ts` · `app/icebreaker/`

**Die zentrale Entscheidung: es wird neu gerechnet, nicht das Flag geglaubt.**

`personalization_needs_review` haelt fest, was zum Zeitpunkt der Erzeugung
galt. Am 2026-08-02 wurde korrigiert, dass ein Bindestrich INNERHALB eines
Wortes ("NSF-certified") faelschlich als verbotenes Satzzeichen zaehlte --
Commit `18bdefc`. Alle davor markierten Zeilen tragen die Markierung bis
heute, obwohl sie in Ordnung sind.

Wichtiger noch: es gibt 31 Zeilen, die **nie** markiert wurden und trotzdem
gegen die geltenden Vorgaben verstossen. Ein Filter auf das Flag haette sie
nie gezeigt. Eine Pruefliste, die Faelle uebersieht, ist schlimmer als keine
-- sie vermittelt, man haette alles gesehen.

Daraus die drei Zustaende:

- **failing** -- verstoesst gegen die heutigen Vorgaben, muss angefasst werden
- **stale** -- traegt nur noch eine veraltete Markierung, per Sammelaktion abzuhaken
- **clean** -- unauffaellig

Aendert sich eine Vorgabe (Wortgrenze, Verbotswoerter im AI-Agent-Tab),
aendert sich diese Liste automatisch mit.

Bewusst **nicht** gebaut: automatisches Kuerzen. Ein Aufhaenger, den ein
Programm auf 22 Woerter stutzt, endet mitten im Gedanken -- und geht dann
genau so an einen Fremden raus.

Migration 0070 (`requeue_personalization`): `public.jobs` hat bewusst nur
eine Lese-Policy, Jobs entstehen sonst per Trigger oder ueber die
Service-Role des Workers. Fuer das Neuerzeugen gibt es deshalb eine eng
geschnittene security-definer-Funktion -- nur dieser Jobtyp, nur eigene
Firmen, und mit Doppelungssperre, weil jeder Job ein bezahlter
Modellaufruf ist.

### 2. Der Torwart vor dem Kampagnenstart

Code: `lib/campaign-readiness.ts` (Logik und Schwellen, mit Tests) ·
`app/api/campaigns/readiness/route.ts` (Datenbeschaffung) ·
`app/instantly/campaigns/campaign-readiness-panel.tsx` (Darstellung)

Die Dreiteilung ist Absicht: die Schwellen sind eine Produktentscheidung,
die man nachlesen und aendern koennen muss; das Zusammensuchen aus fuenf
Tabellen und dem DNS ist Mechanik; die Formulierung in zwei Sprachen gehoert
in keine Rechenfunktion.

**Blocker** (verhindern den Start):

| Pruefung | Schwelle |
|---|---|
| keine sendbaren Leads | 0 |
| SPF fehlt | je Absender-Domain |
| DKIM fehlt | je Absender-Domain |
| Bounce-Quote | ab 5 %, erst ab 50 versendeten Mails |

**Hinweise** (aendern nichts am Start):

| Pruefung | Schwelle |
|---|---|
| DMARC fehlt | je Absender-Domain |
| Bounce-Quote | ab 3 % |
| nie gepruefte Adressen | ab 25 % |
| Leads ohne Aufhaenger | ab 20 % |
| Aufhaenger mit Regelverstoss | ab 20 % |
| Sequenz | unter 2 Schritten |
| Erste Mail zu lang | ueber 90 Woerter |
| Link in der ersten Mail | vorhanden |

**Die Trennlinie ist die ganze Glaubwuerdigkeit der Sache.** Ein Blocker ist
etwas, das mit Sicherheit schiefgeht und dessen Schaden bleibt. Ein Hinweis
ist etwas, das schlechter macht, aber weder sicher noch dauerhaft ist. Wenn
ein Blocker auch mal nur eine Meinung ist, klickt man ihn beim dritten Mal
weg und beim vierten Mal auch den echten. Im Zweifel also Hinweis.

Einzelheiten, die beim Weiterbauen leicht kaputtgehen:

- Die **Bounce-Quote gilt workspace-weit**, nicht je Kampagne. Den Ruf der
  Absender-Domain traegt der Workspace als Ganzes; eine frische Liste heilt
  nicht, was die vorherige angerichtet hat.
- Unter 50 versendeten Mails **schweigt** die Bounce-Pruefung. Bei 20 Mails
  ist ein einziger Bounce schon 5 %.
- Die Laengenpruefung rechnet `{{personalization}}` mit der **erlaubten
  Wortzahl** ein, nicht als ein Wort -- sonst waere jede Mail kuerzer
  gerechnet, als sie ankommt.
- Der Link wird nur im **ersten** Schritt geprueft. Im kalten Erstkontakt ist
  er einer der staerksten Spam-Faktoren, ab der zweiten Mail unproblematisch.
- Schlaegt eine **DNS-Abfrage fehl**, gilt der Eintrag als vorhanden. Einen
  Blocker aufgrund des eigenen Netzfehlers zu setzen waere die schlimmere
  Fehlentscheidung.
- Der **Trotzdem-Knopf** existiert, weil er sonst umgangen wuerde: ein
  Torwart, den man nicht passieren kann, fuehrt dazu, dass die Kampagne
  direkt bei Instantly angelegt wird -- und dann sieht die App gar nichts
  mehr. Er faellt zurueck, sobald sich die Bewertung aendert.

---

## Punkt 3 bis 8: gebaut am 2026-08-04

Reihenfolge aus derselben Bestandsaufnahme. Alles unten ist umgesetzt; was
dabei entschieden wurde, steht jeweils dabei.

### 0. Die Wortgrenze stand nie im Prompt

Kein eigener Punkt, sondern der Auslöser: `personalization_max_words` wurde
ausschliesslich HINTERHER von `validate()` geprueft. Im Prompt kam keine Zahl
vor -- das Modell erfuhr die Grenze erst im Korrekturversuch, und der lief
nur, wenn der erste Versuch schon danebenlag. Median 24 Woerter bei Vorgabe
22, die auffaelligen bei 33.

`constraint_block()` in `apps/worker/worker/pipelines/personalize.py` haengt
die Vorgaben an JEDEN Prompt, auch an einen selbst geschriebenen. Dieser
Workspace hat einen eigenen Prompt -- eine Aenderung nur an DEFAULT_PROMPT
haette hier nichts bewirkt.

Zweiter Fund: praktisch alle Aufhaenger endeten mit derselben Wendung, dem
ersten Beispiel, das der Prompt fuer den Schluss nennt. Ein Beispiel liest
das Modell als Vorlage, wenn man es nicht ausdruecklich daran hindert.

### 3. Varianten je Schritt (Migration 0071)

`SequenceStep` heisst jetzt `{variants[], delayDays}` statt
`{subject, body, delayDays}`. Sauberer Schnitt statt "Variante A ist
subject/body und die anderen stehen woanders" -- bei der asymmetrischen
Fassung waere jede Aktion auf A ein Sonderfall gewesen.

**Die schwierige Stelle ist nicht das Rechnen, sondern das Schweigen.**
`lib/instantly/variant-winner.ts` kennt drei Zustaende: *sammelt noch* (unter
50 Sendungen je Fassung, gar keine Empfehlung), *fuehrt* (Abstand im
Zufallsbereich), *gewinnt* (haelt einem Zweistichprobentest auf 95 Prozent
stand). Der Gewinner muss gegen JEDE andere Fassung bestehen, nicht nur gegen
die zweitbeste -- sonst schaltet man bei drei Varianten B ab, obwohl A nur
gegen C gewonnen hat.

Gemessen an eindeutigen Antworten je Sendung, nicht an Oeffnungen: die haengen
an einem Zaehlpixel, der bei einem Teil der Empfaenger nicht laedt und bei
einem anderen vom Sicherheitsscanner automatisch geladen wird.

Abschalten statt loeschen (`v_disabled`): eine geloeschte Verliererin nimmt
ihre Zahlen mit ins Grab.

### 4. Zustellbarkeits-Waechter (Migration 0072)

Taeglicher DNS-Check je Absender-Domain, laufende Bounce-Ueberwachung je
Kampagne. Beides in `api/cron/instantly-sync`, Logik in
`lib/deliverability-watch.ts`.

Gemeldet wird der **Uebergang**, nicht der Zustand. Eine seit drei Wochen
kaputte Domain jeden Tag erneut zu melden ist die zuverlaessigste Art, dafuer
zu sorgen, dass die Meldung weggeklickt wird. Wird der Eintrag repariert,
loest sich der Alarm von allein auf.

Ab 5 Prozent Bounce wird die Kampagne **angehalten**. Voreinstellung an
(`workspaces.auto_pause_on_bounce`), weil ein Waechter, der nur zuschaut, die
Sorte Warnung ist, die man im Nachhinein im Log findet. Umkehrbar, per Mail
angekuendigt, abschaltbar. Je Kampagne, nicht je Workspace -- alles
anzuhalten waere eine Kollektivstrafe fuer ein Problem mit bekanntem
Verursacher. Schlaegt das Anhalten bei Instantly fehl, wird lokal NICHT auf
"pausiert" gesetzt.

Schwelle und Mindestmenge kommen aus denselben Konstanten wie der Torwart.

### 5. Oeffnungs-Tracking (Migration 0071)

Instantlys Vorgabe ist "an", wir haben das Feld nie gesetzt -- und trotzdem
stand ueberall `open_count = 0`. Ab jetzt wird `open_tracking`/`link_tracking`
ausdruecklich mitgeschickt und gespiegelt, **Voreinstellung aus**: Zaehlpixel
und umgeschriebene Links sind zwei der Merkmale, an denen Spamfilter kalte
Massenmails erkennen. Wer messen will, entscheidet das bewusst.

In der Variantentabelle steht bei abgeschaltetem Tracking ein Strich statt
einer Null -- "0 Oeffnungen" waere dort keine Beobachtung, sondern eine
fehlende Messung.

### 6. Antwort-Assistent (Migration 0073)

Drei Entwuerfe auf Klick im Posteingang, die sich in der ABSICHT
unterscheiden. Ueber dem Textfeld, nicht darunter: ein Startpunkt, kein
Nachschlag.

**Der Terminlink ist der Grund fuer die Migration.** Ein Sprachmodell, dem
einer fehlt, erfindet einen plausiblen. Der Fehler faellt erst dem Empfaenger
auf, wenn er klickt -- und dann ist die Antwort verbrannt. Ist
`workspaces.calendar_link` leer, verbietet der Prompt ausdruecklich, einen zu
erfinden. Aus demselben Grund fliegen Entwuerfe mit uebrig gebliebenen
Platzhaltern raus.

### 7. Multichannel als eine Kette (Migration 0074)

  Tag 0 Mail · Tag 3 ohne Antwort LinkedIn · Tag 7 Anruf

Zwei neue Regelarten im vorhandenen Tageslauf. Die Reihenfolge stimmt ohne
eigenen Zustand: `automation_create_touch` legt nichts an, solange eine
offene Aufgabe existiert -- der Anruf entsteht erst, wenn die
LinkedIn-Anfrage abgehakt ist.

Nur fuer `contacted`. Wer geantwortet hat, braucht keine LinkedIn-Anfrage,
sondern eine Antwort -- das ist der Unterschied zwischen einer Kette und
einem Verfolgungsapparat.

### 8. Wirkungs-Ansicht (`/wirkung`)

Antwortquote nach Lead-Liste, Wochentag und Tageszeit. Konnte es vorher nicht
geben: die App kannte 184 von 312 Mails.

**Unter 30 angeschriebenen Kontakten je Zeile wird keine Quote ausgewiesen.**
Bei 12 Mails und einer Antwort stuende da sonst "8,3 Prozent" -- praezise
aussehend und bedeutungslos. Auch der Balken bleibt leer, statt einen
zufaelligen Ausschlag zu zeichnen.

Gemessen an Kontakten, nicht an Mails: eine Sequenz schickt drei bis vier
Mails an dieselbe Person, und die eine Antwort gehoert nicht durch vier
geteilt.

---

## Was als Naechstes lohnt

Nichts davon stand in der urspruenglichen Liste -- es sind die Fragen, die
sich aus dem Gebauten ergeben.

1. **Die Varianten tatsaechlich benutzen.** Der Apparat steht, aber jede
   bestehende Kampagne hat weiterhin genau eine Fassung je Schritt. Ohne eine
   zweite misst er nichts.
2. **Eine eigene Tracking-Domain**, falls Oeffnungen gemessen werden sollen --
   sonst bleibt die Entscheidung "messen oder zustellen".
3. **Die Wirkungs-Ansicht braucht Datenmenge.** Bei 286 Kontakten traegt nur
   die Aufschluesselung nach Lead-Liste; Wochentag und Tageszeit werden
   grossteils "zu wenig" melden, und das ist richtig so.
4. ~~**Termine als eigener Status.**~~ **Erledigt am 2026-08-05**, siehe
   unten. Der Status existierte laengst (Migration 0018), war aber aus dem
   Posteingang nicht erreichbar -- dort, wo die Antwort ankommt.

---

## Zuordnung: welcher Text hat das ausgeloest (2026-08-05)

Migration 0076 · `lib/instantly/step-ref.ts` · `lib/report/copy-outcomes.ts`

### Der Befund

0 von 753 Nachrichten trugen einen `step_order`, und `messages.campaign_id`
war ebenfalls durchgaengig leer. Die App konnte zu keiner Antwort sagen,
worauf sie eine Antwort ist. Die Wirkungs-Ansicht schluesselte nach
Lead-Liste, Wochentag und Tageszeit auf -- also nach allem AUSSER dem, was
geschrieben wurde. Das ist PRODUKTPLAN Saeule 2.1, die Voraussetzung fuer den
gesamten "geschlossenen Kreis".

### Die Ursache war kein fehlendes Feld, sondern ein nie gelesenes

`GET /api/v2/emails` liefert je Mail neunzehn Felder. Der Typ `InstantlyEmail`
im Sync deklarierte fuenf davon. Am 2026-08-05 an 763 echten Mails
nachgesehen:

| Feld | Inhalt |
|---|---|
| `step` | `"sequenz_schritt_variante"`, je 0-basiert |
| `campaign_id` | Instantlys Kampagne |
| `thread_id` | verbindet Antwort und ausloesende Mail |
| `ue_type` | 1 ausgehend, 2 eingehend |

Die Belege fuer die Deutung von `step` stehen in `step-ref.ts`: die einzige
Kampagne mit zwei Fassungen war die einzige mit `0_0_1`, und die Kampagnen mit
versendetem Follow-up die einzigen mit `0_1_0`.

**Der Glueckfall:** eine eingehende Antwort traegt denselben `step`-Wert wie
die Mail, auf die sie antwortet. Instantly ordnet also bereits zu -- die
Zuordnung ist exakt, nicht ueber Betreffzeilen oder Zeitfenster
rekonstruiert.

`campaign_steps.step_order` ist ebenfalls 0-basiert und `variants[0]` ist laut
Migration 0071 Variante A. Beide Zaehlungen sind deckungsgleich, es wird
nirgends umgerechnet.

### Nachlauf

753 von 753 Zeilen nachgetragen, 0 nicht zuordenbar. Als einmaliges Skript
und nicht als Produktcode: fuer jeden kuenftigen Workspace fuellt
`processEmail` die Felder beim Anlegen, und `runBackfill` holt beim ersten
Verbinden ohnehin alles. Zusaetzlich repariert der Sync eine bereits bekannte
Zeile, wenn sie erneut vorbeikommt und noch keine Zuordnung hat.

### Die Auswertung, und warum sie fuenf Zahlen zeigt statt einer

**Eine Antwortquote allein ist die falsche Zielgroesse.** Das stand sofort in
den Daten: Variante A brachte 0 Antworten auf 144 Kontakte, Variante B zwei
auf 149. Auf die Quote geschaut gewinnt B -- **beide Antworten waren
Absagen**. Wer nur die Quote optimiert, sucht den Text, der am
zuverlaessigsten ein Nein erzeugt.

Deshalb je Zeile: Kontakte, Antworten, interessiert, Absagen, Abwesenheit,
Termine. Die Termin-Spalte steht rechts aussen und traegt als einzige Farbe.

Zwei Entscheidungen, die beim Weiterbauen leicht kaputtgehen:

- **Ein Termin haengt an der Antwort, nicht am Kontakt.** Sonst erbt der
  vierte Bump den Erfolg des ersten Satzes, weil derselbe Kontakt alle vier
  Mails bekommen hat.
- **Sortiert wird in Sequenzreihenfolge, nicht nach Erfolg** -- anders als in
  `effectiveness.ts`. Die Frage lautet "wo bricht es ab", und die beantwortet
  ein nach Quote umsortierter Ablauf nicht.

Dieselbe Mindestmenge wie in der uebrigen Wirkungs-Ansicht (`MIN_SAMPLE`,
30 Kontakte). Darunter stehen die Rohzahlen, aber keine Prozentzahl.

### Termin festhalten, wo die Antwort ankommt

Der Posteingang zeigte den Status als Plakette an, ohne ihn aendern zu
koennen. Wer auf eine Antwort einen Termin ausmachte, musste dafuer nach
`/leads` oder aufs Board wechseln. Jetzt steht dort dasselbe
`StatusSelect` wie ueberall sonst.

Das ist PRODUKTPLAN Saeule 3 woertlich: es muss auf dem Weg liegen, statt ein
Ort zu sein, den man extra aufsucht.

### Offen

- Die Termin-Spalte bleibt leer, bis der erste Termin gesetzt wird. Am
  2026-08-05 war erst eine von vier Mails der Sequenz draussen.
- `thread_id` wird gespeichert, aber noch nicht genutzt. Sie traegt spaeter
  die Frage, auf welchen Schritt hin ein Gespraech tatsaechlich weiterging.

## Zur "Garantie"

"Garantiert Kunden" laesst sich nicht versprechen -- weder Angebot noch Markt
des Kunden sind in unserer Hand, und rechtlich ist es heikel. Einloesbar ist
dagegen:

> **Frostbreaker laesst dich keine Kampagne starten, die nicht ankommt.**

Pruefbar, ehrlich, und es adressiert genau das, was die meisten
Cold-Outreach-Nutzer falsch machen. Punkt 1, 2 und 4 sind das Produkt
dahinter.
