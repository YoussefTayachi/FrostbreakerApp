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

## Offene Punkte, nach Wirkung sortiert

Reihenfolge aus derselben Bestandsaufnahme. Punkt 1 und 2 sind oben erledigt.

### 3. Varianten mit automatischem Gewinner

`buildCampaignSequence` in `lib/instantly/campaigns.ts` baut
`variants: [{ subject, body }]` -- genau eine je Schritt. Instantly kann
mehrere und misst sie selbst. Ohne Varianten gibt es keinen Lernprozess,
egal wie viele Mails versendet werden.

Zu bauen: 2-3 Fassungen je Schritt im Formular, nach N Sends anzeigen welche
gewinnt, Verlierer abschalten.

### 4. Zustellbarkeits-Waechter im Dauerbetrieb

Der Torwart prueft beim Anlegen. Danach prueft niemand mehr. Zu bauen:
taeglicher DNS-Check je Postfach, Bounce-Quote je Postfach und Domain,
automatisches Pausieren beim Schwellwert. Die Infrastruktur steht komplett
(`api/cron/instantly-sync` laeuft jede Minute, `provider_alerts` +
`sendEmail` sind der fertige Meldeweg).

### 5. Kein Oeffnungs-Tracking

`open_count` ist ueber alle Kampagnen 0. Damit laesst sich "nicht zugestellt"
nicht von "gelesen, aber uninteressant" unterscheiden -- zwei voellig
verschiedene Krankheiten mit verschiedenen Behandlungen.

Die Entscheidung ist bewusst zu treffen und nicht nur zu vergessen: ein
Tracking-Pixel schadet der Zustellbarkeit. Die saubere Loesung ist eine
eigene Tracking-Domain. Die Alternative ist, bewusst darauf zu verzichten
und Antwortquote plus Bounce als einzige Messgroessen zu fuehren.

### 6. Antwort-Assistent

Bei 8 eingegangenen Mails 0 Termine. Nach einer Antwort passiert heute
nichts. Zu bauen: drei Antwortvorschlaege (die Klassifizierung nach
interested/question/not_interested/out_of_office laeuft bereits im
Inbox-Sync), ein Klick zum Senden, Kalender-Link. Zwischen "Antwort" und
"Abschluss" liegt genau diese Stelle.

### 7. Multichannel als EINE Sequenz

Heute drei getrennte Dinge: Mail-Kampagne, LinkedIn-Liste (`/linkedin`),
Anrufliste (`/calls`). Der Gewinn liegt in einer Kette -- Tag 1 Mail, Tag 3
ohne Antwort LinkedIn-Anfrage, Tag 7 Anruf, jeweils automatisch in die
richtige Liste geschoben.

Das kann Instantly nicht, Lemlist nur halb, und kein Werkzeug mit einem CRM
darunter. Alle drei Kanaele und die Pipeline sind bereits da; es fehlt die
Verkettung.

### 8. Wirkungs-Ansicht

Welche Nische, welcher Betreff, welcher Schritt, welche Uhrzeit bringt
Antworten. Bei 312 Mails ist noch nichts zu sehen. Ab etwa 2000 wird das die
Ansicht, die Kunden haelt.

---

## Zur "Garantie"

"Garantiert Kunden" laesst sich nicht versprechen -- weder Angebot noch Markt
des Kunden sind in unserer Hand, und rechtlich ist es heikel. Einloesbar ist
dagegen:

> **Frostbreaker laesst dich keine Kampagne starten, die nicht ankommt.**

Pruefbar, ehrlich, und es adressiert genau das, was die meisten
Cold-Outreach-Nutzer falsch machen. Punkt 1, 2 und 4 sind das Produkt
dahinter.
