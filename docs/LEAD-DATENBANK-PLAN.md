# Eigene Lead-Datenbank: von Apollo-Kunde zu Apollo-Ersatz

Stand 2026-08-05. **Zum Reviewen gedacht. Nichts davon ist umgesetzt.**

Alle Zahlen über den Ist-Zustand sind an der Produktionsdatenbank gemessen,
die Abfragen stehen jeweils dabei. Alles über den Zielzustand ist geschätzt
und als Schätzung gekennzeichnet — wer daran weiterarbeitet, soll den
Unterschied sehen können.

**Getroffene Entscheidungen** (2026-08-05, Youssef):

| Frage | Entscheidung |
|---|---|
| Zielbild | Apollo **vollständig** ersetzen, nicht nur ergänzen |
| Personendaten | **Auf Vorrat** speichern, nicht bei Bedarf auflösen |
| Erste Nische | **US E-Commerce / Shopify** |

Die Gegenargumente zu Punkt 1 und 2 stehen in Abschnitt 9. Sie sind hier
festgehalten, damit sie beim Weiterbauen nicht vergessen werden — nicht, um
die Entscheidung noch einmal aufzumachen.

---

## 1. Der Befund, der den Plan trägt

### Ihr seid weniger von Apollo abhängig als gedacht

```sql
select source, count(*) from contacts group by 1 order by 2 desc;
```

| Kontaktquelle | Anzahl |
|---|---|
| `ai_websearch` (eigene Recherche) | **2.016** |
| `apollo` | 1.043 |
| `hunter` | 56 |

Zwei Drittel der Kontakte entstehen bereits ohne Apollo. Der teuerste Anbieter
ist nicht der wichtigste.

### Aber ihr speichert nichts von dem, wofür ihr zahlt

`apps/worker/worker/pipelines/apollo.py:342` verschmilzt Branche,
Stichwörter und Beschreibung zu einem Fließtext (`company_summary`) und
verwirft die Struktur. Die Tabelle `businesses` hat keine Spalte für Branche,
Mitarbeiterzahl, Land oder Technologie:

```
id, workspace_id, search_id, place_id, name, website, address,
phone_national, phone_international, rating, price_level,
decisionmaker_status, hunter_status, created_at, personalization,
company_summary, personalization_needs_review, custom
```

`custom` ist bei **allen 1.710 Firmen leer**. Es gibt heute keine Datenbank,
es gibt einen Durchlauferhitzer: jede Suche kauft zurück, was schon bekannt
war.

**Das ist die gute Nachricht.** Der billigste erste Schritt ist nicht bauen,
sondern aufhören wegzuwerfen.

### Das Startkapital für die E-Mail-Auflösung ist besser als erwartet

1.401 Paare aus Vorname, Nachname und E-Mail über 1.031 Domains. Gegen neun
Regeln geprüft:

| Muster | Anzahl | Anteil |
|---|---|---|
| `vorname@` | 663 | **47,3 %** |
| kein Treffer | 235 | 16,8 % |
| `vnachname@` | 203 | 14,5 % |
| `vorname.nachname@` | 190 | 13,6 % |
| `v.nachname@` | 35 | 2,5 % |
| `nachname@` | 33 | 2,4 % |
| `vornamenachname@` | 33 | 2,4 % |
| `vorname_nachname@` | 5 | 0,4 % |
| `nachnamev@` | 4 | 0,3 % |

**83,2 % sind mit neun Regeln erklärbar.** Und die Verteilung ist
nischenspezifisch: `vorname@` liegt im allgemeinen B2B-Markt bei grob 20 %,
hier bei 47. Das ist der Fingerabdruck kleiner US-DTC-Marken — ein
Zehn-Personen-Team schreibt `sarah@brand.com`.

Ein generischer Anbieter rät in dieser Nische systematisch falsch. Das ist
kein Nebenbefund, das ist der Beleg, dass eine eigene, nischentiefe Datenbank
besser sein *kann* als eine gekaufte breite.

### Vorhandene Infrastruktur

- Job-Queue mit `claim_job` und `for update skip locked` (Migration 0046/0047)
- Python-Worker mit vier Pipelines, 2 Replicas auf Railway
- `worker/http_safety.py` — SSRF-Schutz existiert bereits
- `worker/dedupe.py`, `worker/usage.py` — Entdopplung und Kostenerfassung
- Datenbank 28 MB. Nach oben ist alles frei.

---

## 2. Die Zielmarke: was Apollo heute liefert

Aus `apollo.py` abgelesen. Alles hier muss ersetzt werden, sonst ist
„vollständig ersetzen" nicht eingelöst.

**Suchbare Felder** (die Filtermaske):

| Apollo-Parameter | Bedeutung |
|---|---|
| `person_titles` | Positionsbezeichnung |
| `organization_locations` | Land, Stadt |
| `q_organization_keyword_tags` | Stichwörter |
| `organization_num_employees_ranges` | Mitarbeiterzahl |
| `q_organization_domains_list` | Domainliste |
| `currently_using_any_of_technology_uids` | Technologie-Stack |

**Gelieferte Felder je Person:** Name, Vorname, Nachname, Position,
Seniorität, Abteilung, E-Mail, E-Mail-Status, LinkedIn, Twitter, Facebook.

**Gelieferte Felder je Firma:** Name, Hauptdomain, Website, Stadt, Bundesland,
Land, Telefon, Kurzbeschreibung, Stichwörter, Branche.

---

## 3. Architektur: die globale Schicht

**Das ist die folgenreichste Entscheidung im ganzen Plan.**

Heute ist jede Tabelle nach `workspace_id` geschnitten. Eine Datenbank, die
nur einem Workspace gehört, ist keine Datenbank — sie ist eine Suchhistorie.
Der Wert entsteht erst, wenn das, was Kunde A erhebt, für Kunde B da ist.

Also zwei Schichten:

```
  global_companies      global_people      email_patterns     do_not_collect
  (domain als Schluessel)                  (je Domain)        (Widersprueche)
        |                     |
        +---------- +---------+
                    |
              businesses / contacts        <- Arbeitskopie je Workspace,
              (workspace_id, global_id)       verweist auf die globale Zeile
```

**Warum kopieren statt nur verweisen:** ein Kunde darf einen Kontakt
korrigieren, sperren oder mit eigenen Feldern versehen, ohne dass das bei
allen anderen ankommt. Umgekehrt darf eine globale Korrektur nicht die
Notizen eines Kunden überschreiben. Die Arbeitskopie ist keine Redundanz,
sie ist die Grenze zwischen „Fakt über die Welt" und „Stand meiner Akquise".

**Zugriff:** die globalen Tabellen bekommen **keine** direkte Lese-Policy für
angemeldete Nutzer. Gelesen wird ausschließlich über eine
`security definer`-Suchfunktion, die Treffer zählt, begrenzt und protokolliert
— sonst lädt der erste Kunde mit Neugier und einem `curl` die gesamte
Datenbank herunter, und das Produkt ist weg.

**Herkunft je Zeile ist Pflicht, kein Extra.** Jede globale Zeile trägt:
Quelle (URL), Erhebungsdatum, Erhebungsmethode. Das braucht ihr für Art. 14
DSGVO (Abschnitt 7), für die Auffrischung (Abschnitt 6) und für die Frage
„woher hast du das?", die jeder ernsthafte Kunde stellt.

---

## 4. Die Beschaffungskette

Sechs Stufen. Jede kann für sich laufen und liefert für sich Wert.

### 4.1 Domain-Zulauf: woher kommt die Menge der Kandidaten

| Quelle | Kosten | Was sie liefert |
|---|---|---|
| **Certificate-Transparency-Logs** (crt.sh) | frei | Jede Domain, die je ein HTTPS-Zertifikat bekam. Der breiteste freie Zulauf, den es gibt — inklusive frisch registrierter Shops |
| **Common Crawl Host-Index** | frei | Domainliste aus dem monatlichen Crawl, ohne die Archive selbst herunterladen zu müssen |
| **OpenStreetMap** | frei | Lokale Betriebe. Ersetzt einen Teil von Google Maps |
| **Handelsregister / Companies House / SEC EDGAR** | frei bis günstig | Firmierung, Sitz, Geschäftsführung. Für DACH später der stärkste Hebel |
| **Verzeichnisse** | frei, mühsam | Shopify App Store, Bewertungswidgets (Judge.me, Yotpo), Klaviyo-Referenzen |

Wichtig: CT-Logs sagen **nicht**, dass es ein Shopify-Shop ist. Sie sind der
Zulauf, die Einordnung passiert in 4.2. `*.myshopify.com` läuft über ein
Wildcard-Zertifikat und taucht deshalb *nicht* einzeln in den Logs auf —
was auftaucht, sind die eigenen Domains der Händler.

### 4.2 Shopify-Erkennung: der billigste Filter zuerst

Die Reihenfolge ist der ganze Trick — jede Stufe wirft aus, was die nächste
teurer machen würde.

| Stufe | Verfahren | Kosten je Domain |
|---|---|---|
| 1 | **DNS-A-Record im Shopify-Bereich `23.227.38.0/24`**, bzw. CNAME auf `shops.myshopify.com` | eine DNS-Abfrage |
| 2 | HTTP-Abruf der Startseite: `cdn.shopify.com`, `Shopify.theme`, `x-shopid`-Header | ein Seitenabruf |
| 3 | `/products.json` — Produktzahl, Kategorien, Preisniveau | ein Abruf, oft offen |
| 4 | Restlicher Stack: Klaviyo, Gorgias, Recharge, Yotpo, Attentive, Postscript | aus demselben HTML |

Stufe 1 kostet praktisch nichts und entfernt >95 % der Kandidaten. Erst danach
wird gecrawlt.

**Das ist der Punkt, an dem ihr Apollo schlagt, nicht nur einholt.** Apollos
Technologie-Filter ist eine Momentaufnahme von vor Monaten. Eure Erkennung
misst heute. Wer gestern von Klaviyo zu Attentive gewechselt hat, steht bei
Apollo falsch und bei euch richtig — und für eine Kaltakquise-Mail ist genau
das der Unterschied zwischen Aufhänger und Blamage.

`/products.json` liefert nebenbei einen Größenmaßstab, den Apollo nicht hat:
Produktzahl und Preisniveau sagen bei einer DTC-Marke mehr über die
Kaufkraft aus als eine geschätzte Mitarbeiterzahl.

### 4.3 Firmographie: die Felder, die Apollo heute liefert

- **Branche und Stichwörter** — aus dem Startseitentext. **Nicht** ein
  Sprachmodellaufruf je Firma: bei einer Million Firmen sind das nach grober
  Rechnung 200 bis 1.000 $ und ein Wiedersehen mit den 128 „no credits"-Fehlern
  aus dem Produktplan. Stattdessen Einbettungen gegen eine feste Taxonomie,
  Modellaufruf nur bei Uneindeutigkeit.
- **Ort und Land** — Impressum, Kontaktseite, Fußzeile, Versandseite,
  Telefonvorwahl, Währung. WHOIS ist seit der DSGVO überwiegend geschwärzt und
  taugt nicht mehr.
- **Mitarbeiterzahl** — **die schwächste Stelle des ganzen Plans.** Es gibt
  keine freie, verlässliche Quelle. Ersatzsignale: Anzahl gefundener Personen,
  Zahl offener Stellen, Produktzahl, Tranco-Rang, Shopify-Plan-Signale. Das
  ergibt Größenklassen, keine Zahlen. Siehe Abschnitt 9.

### 4.4 Personen

Die eigene `ai_websearch`-Pipeline liefert heute schon 2.016 Kontakte — sie
ist nur teuer, weil sie je Firma das `web_search`-Werkzeug bemüht. Umbau:
erst gezielt abrufen, dann extrahieren.

| Quelle | Ertrag bei US-DTC | Anmerkung |
|---|---|---|
| `/about`, `/our-story`, `/team`, `/pages/about-us` | hoch | Gründer stehen bei DTC-Marken fast immer namentlich da |
| `/contact`, Fußzeile, `mailto:`-Links | mittel | liefert oft direkt eine echte Adresse — Gold für 4.5 |
| Stellenanzeigen | mittel | nennen häufig die einstellende Person |
| Presseseiten, Podcast- und Konferenzlisten | mittel | |
| GitHub-Organisationen | niedrig | für E-Com kaum relevant |
| Impressum | — | in den USA nicht vorgeschrieben; für DACH später der stärkste Hebel |

**LinkedIn wird nicht automatisiert abgegriffen.** Das verstößt gegen die
Nutzungsbedingungen, kostet im Zweifel den Account und ist in der EU
rechtlich deutlich heikler als in den USA. Als Infrastruktur, auf der ein
verkauftes Produkt steht, ist das keine tragfähige Grundlage. LinkedIn-URLs,
die auf der Firmenwebsite verlinkt sind, sind davon unberührt.

### 4.5 E-Mail-Auflösung: der Teil, der sich selbst verstärkt

Drei Bausteine:

1. **Mustertabelle je Domain.** Gefüttert aus bekannten Paaren. Bei zwei
   bestätigten Paaren derselben Domain ist das Muster kein Rateergebnis mehr,
   sondern eine Beobachtung.
2. **Vorrangwerte je Nische**, wenn die Domain unbekannt ist — bei euch also
   `vorname@` zuerst, nicht `vorname.nachname@`. Aus 1.401 gemessenen Paaren,
   nicht aus einer Branchenfaustregel.
3. **Rückkopplung aus dem Versand.** Instantly meldet Zustellung und Bounce.
   Das ist die einzige Wahrheit, die es gibt, und sie kostet nichts extra.

**Der Kreis:** jede versendete Kampagne verbessert die Mustertabelle, die
Mustertabelle verbessert die nächste Kampagne. Nach genügend Läufen kennt ihr
Muster für Domains, die kein Anbieter hat — weil niemand sonst in dieser
Nische so viel sendet.

Das ist derselbe Gedanke wie „der geschlossene Kreis" in
[PRODUKTPLAN.md](PRODUKTPLAN.md) Säule 2, nur eine Ebene tiefer.

**Eigene Verifizierung** (MX-Abfrage, dann SMTP-`RCPT TO`) ersetzt
NeverBounce **nicht vollständig**. Grenzen: Catch-all-Domains antworten auf
alles mit „ja", Greylisting verzögert, und die eigene IP-Reputation
verschlechtert sich durch Prüfverkehr. Realistisch sind grob zwei Drittel der
Qualität eines Fachanbieters. Empfehlung: eigene Prüfung als Vorfilter für die
Masse, gekaufte Prüfung nur noch für die Adressen, die tatsächlich in eine
Kampagne gehen. Das senkt die Kosten deutlich, ohne die Zustellbarkeit zu
riskieren — und die hängt laut Torwart-Schwellen an genau dieser Zahl.

### 4.6 Aktualität — der eigentliche Burggraben

Kontaktdaten verfallen nach gängiger Schätzung um rund 2,5 % im Monat, weil
Menschen die Stelle wechseln. **Das ist Apollos wirklicher Vorsprung, nicht
die Erstbeschaffung.** Eine Datenbank, die einmal gebaut und dann nicht
aufgefrischt wird, ist nach einem Jahr schlechter als der Anbieter, den sie
ersetzen sollte.

Gestaffelte Auffrischung nach Wert:

| Klasse | Rhythmus |
|---|---|
| Firmen mit laufender oder abgeschlossener Ansprache | monatlich |
| Firmen in einer aktiven Nische | vierteljährlich |
| Langer Schwanz | jährlich |

Bounces und „nicht mehr im Haus"-Antworten sind kostenlose Verfallssignale und
gehören sofort zurück in die globale Zeile.

---

## 5. Die Suchmaske

Am Ende muss `/searches` gegen die eigene Datenbank suchen statt gegen Apollo.
Der Schnitt ist einfach, weil `apollo.py` die Filter schon als neutrale
Struktur entgegennimmt: eine zweite Umsetzung derselben Filter gegen
`global_companies` + `global_people`, und der Suchweg „apollo" wird zu
„frostbreaker".

**Apollo bleibt vorerst als Rückfall stehen** und wird erst abgeschaltet, wenn
die eigene Datenbank bei denselben Filtern vergleichbare Trefferzahlen
liefert. Ein Vergleichslauf beider Wege auf dieselbe Suche ist das
Abnahmekriterium — nicht ein Gefühl.

---

## 6. Kosten und Infrastruktur

Größenordnungen, geschätzt:

| Posten | Annahme | Grob |
|---|---|---|
| DNS-Vorfilter | 5 Mio. Domains | Stunden, vernachlässigbar |
| Crawl der Überlebenden | 200.000 Domains × 3 Seiten | ~30 GB, 1–2 Tage bei 10 Abrufen/s |
| Einordnung per Einbettung | 200.000 Firmen | niedriger zweistelliger $-Bereich |
| Modellaufruf nur bei Uneindeutigkeit | ~10 % | ebenfalls zweistellig |
| Speicher | 1 Mio. Firmen + 5 Mio. Personen | 5–15 GB |

**Zwei Dinge klemmen sofort:**

1. **Railway läuft am 13.08. aus** ([BETRIEB.md](BETRIEB.md)). Das sind acht
   Tage. Ein Crawler-Vorhaben zu planen, während die Ausführungsumgebung
   abläuft, ist die falsche Reihenfolge — das gehört vorher geklärt.
2. **Dauerhaftes Crawlen braucht andere Rechenzeit als eine Job-Queue.**
   2 Replicas mit 5-Sekunden-Polling sind für Suchläufe gebaut, nicht für
   Millionen Abrufe. Ab Stufe 2 dieses Plans braucht es entweder mehr Worker
   oder eine getrennte Crawl-Flotte — und bei Masse Ausgangs-IPs, die nicht
   nach einer Woche überall gesperrt sind.

Supabase trägt die ersten Millionen Zeilen problemlos. Jenseits davon wird die
Personentabelle der Engpass, und dann ist das eine echte Architekturfrage —
nicht heute.

---

## 7. Der rechtliche Apparat

Weil „alles auf Vorrat" entschieden wurde, ist das kein Anhang, sondern ein
Bauteil. **Das hier ist kein Rechtsrat und ersetzt keinen Anwalt** — es ist
die Liste dessen, was gebaut werden muss, damit ein Anwalt überhaupt etwas zu
prüfen hat.

| Was | Warum |
|---|---|
| **Herkunft je Zeile** (Quell-URL, Datum, Methode) | Art. 14 Abs. 2 lit. f verlangt die Quelle. Ohne das Feld ist die Auskunft nicht erteilbar |
| **Informationspflicht Art. 14** | Bei nicht beim Betroffenen erhobenen Daten: binnen eines Monats, spätestens bei der ersten Ansprache. Praktisch: ein fester Absatz plus Link in jeder Kaltmail und eine öffentliche Datenherkunfts-Seite |
| **Interessenabwägung, dokumentiert** | Art. 6 Abs. 1 lit. f ist die Grundlage, auf die sich diese Branche stützt. Sie trägt nur, wenn die Abwägung schriftlich existiert, bevor jemand fragt |
| **Widerspruchs- und Löschweg** (Art. 17/21) | Öffentliches Formular, ohne Anmeldung erreichbar |
| **`do_not_collect`-Liste** | **Architektonisch wichtig:** ein Widerspruch muss die Neuerhebung überleben. Sonst steht die Person nach dem nächsten Crawl wieder drin, und aus einem erledigten Vorgang wird ein Verstoß |
| **Löschfristen, automatisch** | Daten ohne Ansprache verfallen nach fester Frist von selbst |
| **Verarbeitungsverzeichnis** | Ein Eintrag für die Datenbank, getrennt vom Rest |
| **robots.txt achten, Abrufrate begrenzen, Kennung setzen** | Nicht überall rechtlich zwingend. Aber es ist der Unterschied zwischen einem Forschungscrawler und etwas, das gesperrt und gemeldet wird |

Die Ausnahme in Art. 14 Abs. 5 lit. b („unverhältnismäßiger Aufwand"), auf die
sich Datenhändler üblicherweise berufen, ist **umstritten** und wurde von
Aufsichtsbehörden mehrfach eng ausgelegt. Darauf zu bauen ist eine
Geschäftsentscheidung mit Risiko, keine gesicherte Rechtslage.

**Und eine Konsequenz, die niemand gern hört:** die Website wirbt heute mit
Datensparsamkeit. Sobald ihr eine Personendatenbank auf Vorrat betreibt,
stimmt das in der bisherigen Form nicht mehr, und das gehört dort geändert.
Ein Widerspruch zwischen Werbung und Betrieb ist genau die Sorte Angriffsfläche,
gegen die dieselbe Website mit `#ehrlich` argumentiert.

---

## 8. Reihenfolge

Jede Stufe endet mit etwas Benutzbarem. Keine Stufe setzt voraus, dass die
übernächste je gebaut wird.

**Stufe 0 — Aufhören wegzuwerfen.** *(klein)*
Firmographie-Spalten anlegen, Apollos und Maps' Felder strukturiert
speichern, Herkunftsfeld einführen. Rückfüllung der 1.710 vorhandenen Firmen,
soweit die Rohdaten noch da sind.
→ *Ab hier kauft keine Suche mehr zurück, was schon bekannt war.*

**Stufe 1 — Der globale Kern.** *(mittel)*
`global_companies`, `global_people`, `email_patterns`, `do_not_collect`.
Arbeitskopie-Verknüpfung. Suchfunktion mit Begrenzung und Protokoll.
Erstbefüllung aus dem Bestand, Muster aus den 1.401 Paaren.
→ *Die erste eigene Datenbank. Klein, aber echt — und ab hier wächst sie mit
jeder Nutzung statt bei null zu bleiben.*

**Stufe 2 — Das Shopify-Universum.** *(groß)*
CT-Zulauf, DNS-Vorfilter, Crawler, Technologie-Erkennung, Firmographie.
→ *Der erste Datensatz, den Apollo so nicht hat: aktive Shopify-Shops mit
tagesaktuellem Stack. Vorzeigbar, verkaufbar, überprüfbar.*

**Stufe 3 — Personen und der rechtliche Apparat.** *(groß)*
Team- und About-Extraktion, Herkunft, Art.-14-Weg, Widerspruchsformular,
`do_not_collect`, Löschfristen.
→ *Kontakte ohne Apollo. Der rechtliche Teil gehört in dieselbe Stufe, nicht
danach — sonst geht ein Bestand live, für den der Löschweg noch fehlt.*

**Stufe 4 — E-Mail-Auflösung.** *(mittel)*
Musterableitung, eigene Verifizierung als Vorfilter, Bounce-Rückkopplung aus
Instantly.
→ *Der Kreis schließt sich: ab hier verbessert jede Kampagne die Datenbank.*

**Stufe 5 — Ablösung.** *(mittel)*
Suchmaske gegen die eigene Datenbank, Vergleichslauf gegen Apollo,
Auffrischungszyklen. Apollo abschalten, wenn der Vergleich hält.
→ *Der BYOK-Zwang für Apollo fällt weg. Das ist gleichzeitig die Antwort auf
Säule 4 des Produktplans: ein neuer Nutzer braucht ein fremdes Konto weniger,
bevor er das erste Ergebnis sieht.*

---

## 9. Die schwachen Stellen, ehrlich benannt

**Mitarbeiterzahl.** Es gibt keine freie verlässliche Quelle. Ihr werdet
Größenklassen aus Ersatzsignalen schätzen. Für den Apollo-Filter
`organization_num_employees_ranges` heißt das: nachgebaut, aber schlechter.
Das ist die einzige Stelle, an der „vollständig ersetzt" nicht ehrlich
behauptet werden kann.

**Verifizierungsqualität.** Catch-all-Domains lassen sich ohne Versand nicht
auflösen. Wer das behauptet, misst nicht nach.

**Aktualität kostet dauerhaft.** Die Erstbeschaffung ist ein Projekt, die
Auffrischung eine Betriebskosten-Position ohne Ende. Wer das nicht einplant,
hat in zwölf Monaten eine Datenbank, die schlechter ist als die gekaufte.

**Die Breite.** Apollo hat rund 275 Mio. Kontakte. Außerhalb der Nischen, die
ihr aktiv pflegt, wird eure Datenbank auf Jahre schlechter sein. „Vollständig
ersetzen" ist deshalb realistisch als *Ablauf* zu lesen: Nische für Nische,
und Apollo fällt weg, sobald die jeweilige Nische trägt — nicht an einem
Stichtag für alle.

**Der Vorrat an Personendaten** ist die Entscheidung mit dem größten Risiko in
diesem Dokument. Sie ist getroffen, und Abschnitt 7 ist der Preis dafür. Wenn
der Aufwand aus Abschnitt 7 beim Bauen unangenehm wird, ist das kein Zeichen,
ihn zu kürzen — es ist das, was die Entscheidung immer schon gekostet hat.

---

## 10. Was das für den Preis bedeutet

Aus [PRODUKTPLAN.md](PRODUKTPLAN.md) Abschnitt 12, fortgeschrieben:

| Heute | Nach Stufe 2 | Nach Stufe 5 |
|---|---|---|
| Kunde zahlt 99 € an dich und ~150 € an Apollo, Hunter, OpenAI | Kunde bekommt Shopify-Daten, die er woanders nicht kaufen kann | Kunde braucht kein Apollo-Konto mehr |
| „Verkettet meine Werkzeuge" | „Hat Daten, die es sonst nicht gibt" | „Ist die Quelle, nicht der Vermittler" |

Der Preis rechtfertigt sich nicht dadurch, dass ihr Apollo nachbaut. Er
rechtfertigt sich dadurch, dass **die Fremdkosten des Kunden sinken, während
euer Anteil steigt** — und dass in eurer Nische Daten drinstehen, die Apollo
nicht hat.
