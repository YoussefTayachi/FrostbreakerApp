# Kaltakquise-Vorlagen für Custom-Dev-Aufträge

> Grundregel: nie "ich kann programmieren" schreiben. Immer ein konkretes
> Ding benennen, das du für *diese Art* Firma bauen würdest. Personalisiere
> immer die erste Zeile: der Rest kann als Baustein bleiben.

---

## Rechtlicher Hinweis: Österreich/EU vs. USA (kein Rechtsrat)

In AT/DE ist unaufgeforderte E-Mail-Kaltakquise nach **UWG §7** auch B2B
grundsätzlich einwilligungspflichtig: echtes Abmahnrisiko für einen
Solo-Freelancer ohne Rechtsabteilung. Deshalb: **Zielland USA statt
Österreich/EU.**

In den USA regelt der **CAN-SPAM Act** kommerzielle E-Mail: dort reicht
ein Opt-out-Modell: echter Absender, funktionierender Abmelde-Link,
kein irreführender Betreff. Unaufgeforderte B2B-Kaltakquise ist dort
Alltag (genau das Modell, auf dem Instantly, Apollo, Smartlead, Clay
aufgebaut sind).

**Praktisch heißt das:** Frostbreaker-Suche mit einer US-Stadt statt Wien
starten; Pipeline (Ansprechpartner finden, E-Mail verifizieren, Versand
über Instantly) bleibt exakt gleich. Die Vorlagen unten (Englisch) sind
für dieses Zielpublikum.

**Pflichtangaben in jeder Mail (CAN-SPAM):**
- Echte Absenderadresse, kein gefälschter "From"
- Ehrlicher, nicht irreführender Betreff
- Funktionierender Abmelde-Link/Hinweis ("reply STOP to opt out")
- Physische Postanschrift im Footer (kann eine Postfach-/Home-Adresse sein)

---

## Finale Version: US-Agenturen, Custom-Dev-Angebot

Fuer die Instantly-Kampagne aus den Suchen "Marketing_App Entwicklung"
(Raleigh, Chicago, Denver, Nashville) + "Custom-Dev Outreach - Austin".

**Merge-Tags:** `{{firstName}}`, `{{companyName}}`, `{{personalization}}`.
Exakt die Feldnamen, die die App beim Anlegen der Leads mitschickt.

**Stilregeln fuer diese Copy (Nutzer-Vorgabe):**
- Nie den Gedankenstrich "—" verwenden, Punkt oder Komma statt Halbsatz-Pause.
- Der eigene Ablauf klingt einfach und fast beilaeufig, nicht wie eine
  technische Spezifikation. Also "finds the decision maker, gets their
  email, checks it's real, then sends the message" statt "Google Maps
  Suche, KI-Recherche, Hunter-Abfrage, NeverBounce-Verifizierung". Die
  Technik ist der Beweis auf der Case-Study-Seite, nicht der Verkaufstext
  in der Mail.

**Was aus dem ersten Entwurf korrigiert wurde:**
1. Kaputter Merge-Tag repariert. `{{personalization - e.g., ...}}` ist kein
   gueltiges Instantly-Feld, der tatsaechliche Feldname ist exakt
   `personalization` (siehe `lib/instantly/campaigns.ts`).
2. Ungedeckte Versprechen gestrichen ("no data leaks" etc.), das sind
   Zusagen ueber ein System, das fuer den Empfaenger noch nicht gescoped
   ist, und widersprechen der eigenen `/eigene-software`-Positionierung
   ("erst Klarheit, dann Angebot").
3. Der Talking-Point "diese Mail hat die App geschrieben" ist so nicht
   korrekt. Nur `{{personalization}}` kommt tatsaechlich aus Frostbreakers
   KI pro Lead, das darf man wahrheitsgemaess sagen. Der Rest der Mail ist
   von Hand geschrieben und sollte auch so bleiben.

**Wichtig:** `{{personalization}}` steht bewusst als eigener Absatz. 11 der
51 Leads haben keine Personalisierung, bei denen faellt dann nur ein Absatz
weg statt dass mitten im Satz eine Luecke klafft.

**Vor dem Versand ausfuellen:** die physische Adresse im Footer, CAN-SPAM-
Pflicht, ein Postfach reicht.

---

### Schritt 1, Tag 0

```
Subject: Renting vs. owning your outreach stack

Hi {{firstName}},

{{personalization}}

Most agencies I talk to are stuck paying a "SaaS tax": a lead scraper,
an email verifier, a sender, and a CRM, held together with Zapier,
billed per seat, growing with every client you land.

I got tired of renting that stack, so I built my own (frostbreaker.app).
Point it at a niche and a city, and it finds the businesses, the
decision maker, their email, checks it's real, then writes and sends
a personal message on its own. Built in three weeks, already run 800+
companies through it.

I now build the same, custom, for agencies, white-labeled too if you'd
rather pitch it as your own tech than a reseller's tool.

Worth a 10-minute call to see what it'd save {{companyName}}?

Best,
Youssef

---
Youssef Tayachi · [DEINE POSTADRESSE]
Don't want these? Reply "stop" and I'll remove you.
```

### Schritt 2, Tag 3

```
Subject: (im selben Thread lassen)

Hi {{firstName}},

One number in case it helps. Building it took three weeks, and it has
since run 800+ companies through it. The whole story is written up
here, including what it cost and what didn't work:

frostbreaker.app/case-study

If tooling isn't a priority right now, just say so and I'll stop.

Best,
Youssef

---
Youssef Tayachi · [DEINE POSTADRESSE]
Don't want these? Reply "stop" and I'll remove you.
```

### Schritt 3, Tag 7, Abschluss

```
Subject: (im selben Thread lassen)

Hi {{firstName}},

Last one from me.

If owning your outreach stack ever moves up the list, the offer stands:
frostbreaker.app/eigene-software

Either way, good luck.

Best,
Youssef

---
Youssef Tayachi · [DEINE POSTADRESSE]
Don't want these? Reply "stop" and I'll remove you.
```

**Ehrlicher Gespraechseinstieg fuers Erstgespraech:** *"Die Zeile oben in
der Mail, {{personalization}}, hat tatsaechlich eine KI aus meiner App pro
Firma einzeln generiert. Den Rest der Mail hab ich selbst geschrieben."*
Ehrlich, ueberpruefbar, passt zur selben Beweis-statt-Behauptung-Linie wie
die Case Study.

---

## Vorlage A (English): Agencies, your strongest, provable offer

**Target:** Marketing / growth / recruiting agencies in the US that run
outbound themselves or sell lead-gen as a service to clients.

```
Subject: Own tool instead of Apollo + Instantly + a spreadsheet?

Hi [Name],

Quick question: how many tools are you stitching together for
outbound right now: a contact database, an email finder, a
verification tool, a sender, and probably a spreadsheet as CRM?

I built exactly that as one system: Google Maps search → AI research
to find the right decision-maker → email finding + verification →
sending → CRM, all in one place, using your own API keys instead of
five separate subscriptions. It's live and running: [Link to case
study]

Would something like that help if it were built around your workflow,
maybe wired into your existing CRM instead of being another silo? Happy
to show you in 15 minutes what that could look like for you.

Best,
Youssef

---
[Your name] | [physical address or PO box]
Don't want future emails? Reply "unsubscribe" and I'll stop.
```

---

## Vorlage B (English): Companies with a visible manual process

**Target:** Any company where you can see (via website, job postings,
LinkedIn) a specific manual, repetitive process.

```
Subject: Noticed [specific process] at [Company]

Hi [Name],

I noticed [Company] [specific process, e.g. "handles inbound leads
through a contact form and then enters them manually into your CRM"].
That's the kind of thing a small custom tool can automate directly:
saves a few minutes per lead, which adds up fast at your volume.

I build exactly this kind of thing (recent example, fully self-built:
[Link to case study]). Happy to take a closer look and give you an
honest, no-obligation read on what it would take.

Best,
Youssef

---
[Your name] | [physical address or PO box]
Don't want future emails? Reply "unsubscribe" and I'll stop.
```

---

## Vorlage A: Agenturen (dein stärkster Beweis, zuerst versuchen)

**Zielgruppe:** Marketing-/Growth-/Recruiting-Agenturen, die selbst
Kaltakquise machen oder Leadgen für Kunden anbieten.

```
Betreff: Eigenes Tool statt Apollo + Instantly + Tabelle?

Hi [Name],

kurze Frage: Wie viele Tools kombiniert ihr aktuell für Leadgen und
Kaltakquise: Datenbank, E-Mail-Finder, Verifizierung, Versand, dazu
vermutlich eine Tabelle als CRM?

Ich hab genau das als eigenes System gebaut (Google-Maps-Suche →
KI-Recherche der Ansprechpartner → E-Mail-Finding + Verifizierung →
Versand → CRM, alles in einem, eure eigenen API-Keys, kein
Abo-Wirrwarr). Läuft bei mir live, Case Study hier: [Link]

Würde euch das was bringen, wenn es auf eure Prozesse zugeschnitten
wäre, vielleicht mit eurem bestehenden CRM verbunden statt als
Insellösung? Ich zeig dir gern in 15 Minuten, wie das für euch
aussehen könnte.

Viele Grüße
Youssef
```

**Warum das funktioniert:** Die erste Frage trifft einen Schmerzpunkt,
den jede Agentur kennt (Tool-Wirrwarr), bevor du überhaupt "ich" sagst.
Der Beweis ist ein Link, keine Behauptung. Der Ask ist klein (15 Minuten
zeigen, nicht "Projekt beauftragen").

---

## Vorlage B: Firmen mit einem konkreten manuellen Prozess

**Zielgruppe:** Firmen, bei denen du (per Website, LinkedIn, Vor-Ort-Besuch,
Bekannte) einen sichtbaren manuellen Schritt erkennst: z. B. Bestellungen
per E-Mail statt Formular, Excel-Chaos, doppelte Dateneingabe zwischen zwei
Systemen.

```
Betreff: [konkreter Prozess], hab da eine Idee

Hi [Name],

mir ist aufgefallen, dass ihr [konkreter Prozess, z. B. "Anfragen über
ein Kontaktformular bekommt und die dann manuell in [System] übertragt"].
Das lässt sich mit einem kleinen Tool automatisieren, das die Daten
direkt überträgt: spart pro Anfrage ein paar Minuten, bei eurem Volumen
vermutlich einiges an Zeit im Monat.

Ich entwickle sowas (aktuelles Beispiel, komplett selbst gebaut:
[Link zur Case Study]). Wenn du magst, schau ich mir das kurz genauer an
und sag dir unverbindlich, was der Aufwand wäre.

Viele Grüße
Youssef
```

**Wichtig:** Diese Vorlage braucht echte Vorarbeit: du musst den Prozess
tatsächlich gesehen haben (Website, Stellenanzeigen die auf manuelle
Arbeit hindeuten, ein Gespräch). Ohne diese Konkretheit wird sie zur
generischen Massen-Mail und verliert ihre Wirkung.

---

## Wie du Zielfirmen findest: nutz dein eigenes Tool dafür

Für Vorlage A ist der naheliegendste Weg: **Starte in Frostbreaker selbst
eine Suche nach "Marketing Agentur" / "Growth Agentur" / "Recruiting
Agentur" in Wien (oder mehreren Städten)**. Das liefert dir automatisch
Firmen samt Ansprechpartner und E-Mail: dieselbe Pipeline, die du gerade
als Beweis verkaufst, liefert dir gleichzeitig die Kontaktliste dafür.
Doppelter Nutzen aus einer Suche.

Für Vorlage B eignen sich eher LinkedIn (Stellenanzeigen der Zielfirma
verraten oft manuelle Prozesse, z. B. "Dateneingabe", "Exceltabellen
pflegen") oder eine gezielte Google-Suche nach lokalen Branchen mit
bekanntermaßen viel manueller Arbeit (Handwerk, kleine Dienstleister,
Vereine/Verbände).

---

## Reihenfolge zum Ausprobieren

1. Vorlage A an 15–20 Agenturen (per Frostbreaker-Suche gefunden): das
   ist deine stärkste, am schnellsten wiederholbare Kampagne
2. Antwortquote beobachten, Text bei Bedarf nachschärfen
3. Erst danach Vorlage B einzeln und mit echter Recherche pro Firma, weil
   sie mehr Vorarbeit pro Nachricht kostet
