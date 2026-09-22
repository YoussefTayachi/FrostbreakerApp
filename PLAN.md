# Plan: Person-Finding (Absatz ueber den Entscheidungstraeger)
_Locked via claudex-loop, by Claude + Youssef, 2026-09-22. Revision 2 nach Codex-Runde 1._

## Goal

Frostbreaker bekommt einen dritten personalisierten Text neben `{{personalization}}`
(Firma, ein Satz) und `{{websiteFinding}}` (Website-Mangel, ein Satz): den Absatz
`{{personFinding}}` ueber den Menschen, der angeschrieben wird. Er entsteht je
Kontakt aus dem, was die Person selbst veroeffentlicht hat: Beitraege,
Interviews, Podcasts, und das von ihr gepflegte LinkedIn-Profil (Werdegang), das
Apollo im schon bezahlten `bulk_match` mitliefert und der Code heute verwirft.
Der Absatz nennt seine Quelle, sagt die Sache klar und ohne Abschwaecher,
leitet in einem Sachsatz auf das Angebotsproblem ueber (was der Fund fuer
genau dieses Problem heisst, KEINE Formel wie "deswegen melde ich mich") und
endet vor der Bitte, die die Sequenz selbst traegt. Wer nichts
Selbstveroeffentlichtes hat, bekommt keinen Absatz und wird beim
Kampagnen-Upload zurueckgehalten, genau wie bei `websiteFinding`.

Gemessene Ausgangslage (2026-09-22, retaiyn-Konto): 158 von 160 Aufhaengern
endeten mit einer von elf Bruecken; 997 Leads, 13 menschliche Antworten (1,3 %).
Apollo-Kontakte haben zu 100 % ein LinkedIn-Personenprofil, Hunter 90 %, Maps 7 %.

## Approach

1. **Apollo-Felder behalten** (`apollo.py`, `parse_apollo_person`): `headline`,
   `employment_history`, `city`, `state`, `country`, `functions`,
   `subdepartments` roh unter `contact["custom"]["apollo"]`, mit Laengenkappung
   (`employment_history` hoechstens 10 Eintraege, Strings hoechstens 300
   Zeichen). `_store_people_pairs` uebernimmt `c.items()` unveraendert.

2. **Migration 0119: Provenienz.** `contacts.person_finding_source jsonb`
   (angle, claim, source_kind, source_url, source_label, age_months, verbatim,
   identity_anchor, identity_evidence, researched_at, model, attempts). Ohne
   sie kann spaeter niemand eine Mail nachpruefen oder einen Absatz begruendet
   verwerfen. Ausserdem: Statuswert `skipped_limit` im CHECK, und die
   Funktion `claim_person_finding_contacts(p_workspace uuid, p_business
   uuid, p_contact_ids uuid[], p_limit int) returns uuid[]`. Aufbau wie die
   uebrigen Funktionen des Repos (0002, 0081): `security definer`, `set
   search_path = public`, `revoke execute from public, anon, authenticated`,
   `grant execute to service_role`. Am Anfang
   `pg_advisory_xact_lock(hashtext(search_id))` auf die Suche der Firma,
   damit zwei gleichzeitige Firmen-Jobs derselben Suche den Deckel nicht
   gemeinsam reissen; ein einzelnes Statement allein serialisiert nicht.
   Zugehoerigkeit wird in der Funktion geprueft: Business muss zu
   `p_workspace` gehoeren, Kontakte muessen zu Business UND Workspace
   gehoeren; fremde ids werden ignoriert, nicht gesetzt. Datenschutz im Migrationskommentar
   festgehalten: gespeichert werden nur oeffentlich veroeffentlichte
   Aussagen mit ihrer URL, kein Privates; die Zeile haengt am Kontakt und
   verschwindet mit ihm (Kaskade contacts -> businesses -> searches seit
   0001). Aufbewahrung: so lange, wie der Nutzer die Suche behaelt, auch im
   Papierkorb; endgueltiges Loeschen der Suche loescht die Provenienz mit.
   Dieselbe Regel gilt heute schon fuer `company_summary`, `website_audit`
   und `website_finding`. Dokumentiert in `docs/BETRIEB.md`.

3. **Worker-Pipeline `write_person_finding`** (`pipelines/person_finding.py`,
   Entwurf wird umgebaut):
   - **Zwei Nutzlasten.** `business_id`: Auffaechern. `contact_id`: Recherche.
   - **LinkedIn-URL kanonisch.** `canonical_linkedin(url)` in Python: parsen,
     Host muss `linkedin.com` oder eine Subdomain davon sein, Pfad muss mit
     `/in/` beginnen, Ergebnis ist der kleingeschriebene Slug ohne Query und
     ohne Schlussstrich; sonst None. Diese Funktion ist der einzige
     Identitaetsanker.
   - **Auffaechern atomar.** Kandidaten: SQL-Vorfilter (Firma, E-Mail nicht
     null, Status null, `linkedin ilike '%linkedin.com/in/%'`), dann
     Python-Kanonisierung. Kontakte ohne gueltigen Anker bekommen sofort
     Status `none` ohne Kosten. Der Claim inklusive Deckel laeuft in EINER
     Datenbankfunktion (Migration 0119, `claim_person_finding_contacts(
     p_workspace, p_business, p_contact_ids, p_limit)`): sie zaehlt je
     `search_id` die Kontakte mit Status ungleich null, setzt so viele der
     uebergebenen ids auf `pending`, wie unter `PERSON_FINDING_MAX_PER_SEARCH
     = 300` noch Platz ist, setzt den Rest auf `skipped_limit`, und gibt die
     geclaimten ids zurueck. Zaehlen und Setzen in einem Statement, damit
     zwei gleichzeitige Firmen-Jobs den Deckel nicht gemeinsam reissen.
     Nur die zurueckgegebenen ids werden eingereiht. Schlaegt `enqueue_many`
     fehl, werden genau diese ids auf null zurueckgesetzt, dann wird die
     Ausnahme weitergereicht (Queue-Retry, idempotent).
   - **Vorbedingungen je Kontaktjob**, vor jedem Modellaufruf: Suche nicht im
     Papierkorb (`search_is_deleted`), `filters.person_findings` weiterhin
     true, Kontakt hat noch keinen Text. Sonst Status auf null zurueck und
     Ende.
   - **Claim atomar.** `update contacts set status='running' where id=? and
     status='pending'` mit Rueckgabe; leer heisst: ein anderer Job hat ihn,
     Ende ohne Kosten.
   - **Zustandsautomat bei Fehlern.** Wirft Recherche oder Schreiben eine
     Ausnahme: `job["attempts"] >= job["max_attempts"]` -> Status `failed`,
     sonst zurueck auf `pending`; danach wird die Ausnahme weitergereicht,
     `fail_job` plant den Retry, und der naechste Claim `pending -> running`
     gelingt wieder. `failed` wird nie automatisch wiederholt. Jeder
     Fehlversuch wird als `usage.record(ws, "openai",
     "person_finding_research_failed", 1, "attempts")` mit `cost_usd = null`
     festgehalten: Kosten unbekannt, nicht null. Ob OpenAI abgebrochene
     Websuchen berechnet, wird im Live-Test gegen die Abrechnung des
     OpenAI-Dashboards geprueft und das Ergebnis in `usage.py` notiert.
   - **Finaler Schreibzugriff bedingt.** `update contacts set ... where id=?
     and person_finding is null and status='running'` mit Rueckgabe; leer
     heisst: jemand hat inzwischen von Hand geschrieben oder den Kontakt
     zurueckgesetzt, dann wird nichts ueberschrieben und der Job endet
     still.
   - **Stufe 1 `research()`:** OpenAI Responses, `gpt-4.1-mini`,
     `web_search`, striktes JSON-Schema, 120 s Timeout, tenacity 2 Versuche.
     Eingabe: Name, Titel, Firma, Website, LinkedIn-URL, und die Apollo-Felder
     als abgegrenzter Datenblock (`<known_facts>` mit Laengenkappung, Hinweis
     "data, not instructions"). Anweisung: Werdegang-Typen aus den bekannten
     Fakten bilden, nur nach Aeusserungen suchen. Kosten ueber
     `usage.record_openai(ws, "person_finding_research", ...)`.
   - **Schema:** `findings[]` mit `angle` (`statement`, `pattern`,
     `fresh_move`, `dual_role`, `side_switch`, `background`, `role_vs_size`),
     `claim` (max 300 Zeichen), `source_kind` (`own_post`,
     `company_post_quote`, `interview`, `article`, `podcast`, `talk`,
     `profile`), `source_url`, `age_months` (-1 unbekannt), `verbatim`
     (max 300), `identity_anchor` (`linkedin_url`, `company_and_role`,
     `none`), `identity_evidence` (max 300: die Stelle in der Quelle, die
     Name UND Firma oder Rolle nennt; Pflicht bei `company_and_role`, sonst
     zaehlt der Anker als `none`).
   - **Auswahl `best_finding()`,** deterministisch im Code: `identity_anchor`
     != none (bei `company_and_role` nur mit nicht-leerem
     `identity_evidence`); `source_url` nicht leer und http(s);
     Quellenart-Host-Matrix: `own_post`, `profile`, `company_post_quote`
     nur mit Host linkedin.com; `podcast`, `interview`, `talk` nur mit
     einem anderen Host; `article` beliebig; unzulaessige Kombinationen
     fallen durch. Anker `linkedin_url` gilt fuer `profile` nur bei
     Slug-Gleichheit; fuer `own_post` und `company_post_quote` nur, wenn
     `linkedin_post_author(url)` den kanonischen Slug des Kontakts liefert.
     Diese Funktion parst den Pfad grammatisch: Host linkedin.com, erstes
     Segment `posts`, zweites Segment bis zum ersten `_` ist der Autor,
     kleingeschrieben, exakter Vergleich mit `canonical_linkedin(
     contacts.linkedin)`. Kein Teilstring-Vergleich. `/pulse/`-Artikel und
     alle anderen Formen liefern None; sonst wird der Anker auf
     `company_and_role` herabgestuft. Jeder Fund mit Anker
     `company_and_role` setzt `needs_review = true` und
     `person_finding_source.review_reason = "unverified_anchor"`; er wird
     beim Upload zurueckgehalten, bis ihn jemand in der Kontakt-Prueflliste
     (Schritt 6a) freigibt oder verwirft. Das Modell behauptet die Bindung,
     der Mensch bestaetigt sie. Altersgrenze
     je Typ (`statement`/`pattern` <= 12 Monate, `fresh_move` <= 6,
     Werdegang-Typen zeitlos, undatierte Aussagen fallen durch); Rang
     `statement` > `pattern` > `fresh_move` > `dual_role` > `side_switch` >
     `background` > `role_vs_size`; bei Gleichstand der juengere. Fuer
     `profile`-Quellen muss `canonical_linkedin(source_url)` gleich
     `canonical_linkedin(contacts.linkedin)` sein.
   - **Frische der Apollo-Kopie.** `profile`-Funde beruhen auf Apollos
     Momentaufnahme, nicht auf der Live-Seite. Zeitlose Werdegang-Typen
     (`background`, `side_switch`, `dual_role`, `role_vs_size`) sind davon
     unberuehrt: eine vergangene Station bleibt vergangen. `fresh_move` ist
     die Ausnahme und wird aus Apollo-Daten nur akzeptiert, wenn
     `contacts.created_at` (Zeitpunkt der Anreicherung) hoechstens 3 Monate
     zurueckliegt; sonst faellt der Fund durch. Das Quellenlabel fuer
     `profile` lautet immer "on your LinkedIn profile", nie "recently".
     Eine Live-Pruefung gegen LinkedIn findet nicht statt (kein Abruf von
     LinkedIn-Seiten).
   - **Quellenlabel serverseitig.** Aus Host der URL und `source_kind`: "on
     LinkedIn", "in the interview with <host>", "on the <host> podcast",
     "in your piece on <host>". Das Label geht als fester Text in den
     Schreib-Prompt; das Modell darf keine andere Herkunft nennen.
   - **Stufe 2 `write()`:** `personalize.generate` mit zusammengesetztem
     Prompt (gemeinsamer Teil + typspezifischer Block) +
     `constraint_block(45, Verbotsliste, Sprache, subject="paragraph")`.
     Fundmaterial und Angebot als abgegrenzte Datenbloecke. Angebot
     (`offers.is_default`: offering, problem, mechanism, icp) nur fuer den
     letzten Satz. Korrekturrunde, `sanitize_banned_punctuation`,
     `needs_review`.
   - **Verbotsliste dieses Textes:** aus der Workspace-Liste nur die
     satzzeichen-only Eintraege (Striche), plus eigene Liste je Sprache.
     EN: `I think`, `I believe`, `I feel`, `probably`, `perhaps`, `maybe`,
     `would`, `could`, `might`, `it seems`, `I suspect`, `a bit`, `kind of`,
     `sort of`, `just wanted to`, `love`, `impressive`, `passionate`,
     `congrats`, `congratulations`, `huge fan`. DE: `ich denke`, `ich glaube`,
     `vielleicht`, `eventuell`, `koennte`, `koennten`, `wuerde`, `wuerden`,
     `wahrscheinlich`, `ein bisschen`, `wollte nur`, `beeindruckend`,
     `Glueckwunsch`, `grosser Fan`. Normalisiert (Kleinschreibung, Umlaute
     beide Formen). Herkunftsnennung ist ausdruecklich erlaubt.
   - **Die Reaktion (Teil 3) ist keine freie Meinung.** Sie leitet sich aus
     dem `problem`-Feld des Angebots ab: was der Fund fuer genau dieses
     Problem heisst. Ohne Angebot entfaellt Teil 3 und 4, der Absatz besteht
     dann nur aus Herkunft und Aussage.
   - **Regeln im Prompt:** eine Beobachtung, eine kurze Reaktion, eine Zahl
     nur aus dem Material; jeder Satz sagt die Sache, keiner deutet sie an;
     keine Komplimente, kein Glueckwunsch, keine erfundene Wirkung; hoechstens
     einmal der Firmenname; keine Frage, keine Bitte; Du-Form.
   - **Leer ist ein Ergebnis:** Status `none`, kein zweiter Aufruf.
   - **Persistenz:** `person_finding`, `person_finding_needs_review`,
     `person_finding_status` = found, `person_finding_source`.
   - `PERSON_FINDING_MAX_WORDS = 45`, einzige Konstante, gespiegelt im Web.

4. **Einreihen, an einer Stelle.** `person_finding.reihe_ein(ws, business)`
   prueft `filters.person_findings` und reiht den Firmen-Job ein. Aufgerufen
   aus `get_businesses._finish` (apollo/prospeo, Kontakte sind da), aus
   `find_decisionmaker.run` und aus `hunt_persons.run` jeweils nach dem
   Kontakt-Insert. `main.py`: HANDLERS + `PROVIDER_BY_JOB_TYPE`
   (`write_person_finding: openai`).

5. **Web, Merge-Tag:** `PERSON_FINDING_FIELD = "personFinding"`;
   `EMAIL_MERGE_TAGS`, `mergeTagOptions`, `mergeTagValues`,
   `buildInstantlyLead` (`custom_variables` als Objekt aus beiden Feldern,
   leere fallen weg); `MergeTagSource` bekommt `person_finding` und
   `person_finding_needs_review` auf Kontaktebene; `CONTACT_COLUMNS`
   selektiert beide; `usesPersonFinding`.
   - **`splitByPersonFinding` haelt zurueck:** ohne Text ODER mit
     `needs_review = true`. Rueckgabe getrennt (`withoutFinding`,
     `needsReview`), damit die Zahl ehrlich bleibt.
   - **Reihenfolge korrigiert:** wenn die Sequenz `personFinding` benutzt,
     laeuft der Split VOR `pickPrimaryContactPerBusiness`, damit die zweite
     Person derselben Firma mit Absatz nicht verworfen wird. Gilt in
     `create-campaign.ts` und in der Readiness-Route gleichermassen (eine
     gemeinsame Funktion `prepareLeads`).
   - **Torwart `personFindingMissing`** (Warnung) mit `values`
     `{count, total, needsReview, pending, none, failed, skippedLimit}`; die Route zaehlt
     die Status aus den Zeilen. `estimateWords` kennt den Platzhalter mit 45.
     `lib/person-finding-defaults.ts` spiegelt die Konstante mit Drift-Test
     gegen den Python-Quelltext. Texte de/en in `dict.ts`.

6. **Suchformular:** Haken `person_findings` (Standard aus) neben
   Website-Befund, Text mit Kostenhinweis. Flag in `searches.filters`.

6a. **Kontakt-Prueflliste `/person-finding`** (Codex R4): ohne sie waere die
   Rueckhaltung eine Sackgasse. Route `app/api/person-finding/review`
   (GET: Kontakte des Workspaces mit `person_finding_needs_review = true`,
   Spalten Name, Titel, Firma, Absatz, `person_finding_source`, Suche nicht
   im Papierkorb, hoechstens 500; PATCH: `approve` setzt `needs_review =
   false`, `discard` setzt `person_finding = null`, Status `none`,
   `review_reason = "discarded"` in der Provenienz bleibt; optional
   `text` zum Ueberschreiben mit Validierung gegen 45 Woerter und die
   Person-Finding-Verbotsliste). Seite: Liste mit Absatz, darunter die
   Provenienz (Quellenlabel, URL als Link, Fund, Grund der Pruefung), zwei
   Knoepfe. Workspace-Scoping ueber `getCurrentWorkspace` plus expliziten
   `eq("workspace_id")`. Navigation unter AI Agent neben "Aufhaenger".
   Texte de/en.

7. **Tests:** `tests/test_person_finding.py` (Beitrags-URL mit und ohne
   Autoren-Slug; `review_reason` in der Provenienz; Quellenart-Host-Matrix;
   `needs_review` bei `company_and_role`; Auffaechern reiht nur die ids ein,
   die die DB-Funktion zurueckgibt, und setzt sie bei Enqueue-Fehler zurueck;
   `canonical_linkedin` mit
   fremdem Host, Query, Grossschreibung und Firmenseite; Zustandsautomat
   `pending`/`failed` nach `attempts`; bedingter Schreibzugriff bei fremdem
   Text; Deckel je Suche; `identity_evidence`-Pflicht bei
   `company_and_role`; `fresh_move`-Frische ueber `created_at`; Auswahl mit Anker und
   Altersgrenzen je Typ, Quellenlabel, Verbotsliste je Sprache,
   Auffaechern nur `/in/`-Kontakte, Rollback bei Enqueue-Fehler, Claim
   verloren = kein Aufruf, Papierkorb = kein Aufruf, Flag aus = kein Aufruf,
   `none` ohne Schreibaufruf, Prompt-Zusammenbau je Typ, Datenbloecke
   gekappt), `tests/test_apollo.py` (custom-Felder, Kappung), vitest fuer
   `campaigns.ts`, `prepareLeads`-Reihenfolge, `campaign-readiness.ts`,
   `lib/person-finding/review.ts` (Validierung des Text-Overrides,
   Zustandsuebergaenge approve/discard, Workspace-Isolation der Abfrage als
   reine Funktion),
   Drift-Test. `ruff`, `pytest`, `npm test`, `tsc --noEmit`, `next build`.

8. **Live-Test:** a) Angebot "retaiyn WhatsApp" in `82aa389f`. b) Suche "Test
   person-finding" (apollo, completed, `filters.person_findings = true`), 6
   bis 8 Firmen plus Kontakte aus `63968b89` kopieren (dort nur lesen),
   bevorzugt englischsprachig mit `/in/`; Dean Smith und Kate Prince von
   Hand dazu. c) Push. Firmen-Jobs einreihen. d) Status, Absaetze,
   Provenienz, `api_usage`, Laufzeit je Job lesen; Qualitaet an den Regeln
   pruefen. e) Suche in den Papierkorb.

## Key decisions & tradeoffs

- **Opt-in per Haken, Standard aus** (Q1). Dazu ein harter Deckel von 300
  Kontakten je Suche im Code (Codex R2): eine versehentlich grosse Suche
  kostet damit hoechstens 300 Websuchen, nicht 5000.
- **Zustandsautomat statt "running fuer immer" (Codex R2).** Fehler ->
  `pending` bis `max_attempts`, dann `failed`; nie automatisch wiederholt.
- **Bedingter finaler Schreibzugriff (Codex R2).** Ein von Hand
  eingetragener Absatz wird nie ueberschrieben.
- **LinkedIn-URL wird geparst, nicht gemustert (Codex R2).** Host und Pfad
  geprueft, Slug kanonisch.
- **Keine Live-Pruefung gegen LinkedIn und kein Abruf externer Quellen
  (Codex R2, abgelehnt).** Beides hiesse, fremde Seiten zu laden; das ist
  genau der Scraping-Weg, den diese Pipeline nicht geht. Stattdessen:
  Anker-Pflicht, `identity_evidence` als gespeicherter Beleg, und der
  Nutzer sieht die Provenienz. Fuer `fresh_move` gilt zusaetzlich die
  Frische-Regel ueber `contacts.created_at`.
- **Keine dedizierte Parallelitaet je Jobtyp im Code (Codex R2,
  abgelehnt).** `find_decisionmaker` hat dasselbe Laufzeitprofil und laeuft
  seit Monaten ueber dieselbe Queue ohne eigene Schranke; eine Semaphore je
  Typ ist ein eigenes Vorhaben. Der Deckel je Suche und das Opt-in sind die
  Bremsen in v1.
- **Fehlversuche werden gezaehlt, nicht bepreist (Codex R2).** Eine
  `api_usage`-Zeile je Fehlversuch mit Menge 1 und Einheit `attempts`, ohne
  Betrag: ehrliche Luecke statt geratener Zahl, dieselbe Haltung wie bei
  Hunter-Credits.
- **Datenschutz dokumentiert, nicht automatisiert (Codex R2).** Zweck,
  Umfang und Loeschung mit dem Kontakt stehen in Migration 0119 und in
  `docs/BETRIEB.md`; eine Verfallszeit gibt es in v1 nicht.
- **Deckel atomar per DB-Funktion (Codex R3).** Zaehlen und Claimen je
  Suche in einem Statement; der Rest bekommt `skipped_limit` und ist damit
  im Torwart sichtbar statt still null.
- **Quellenart-Host-Matrix und Pruefpflicht (Codex R3).** Ein Fund, dessen
  Bindung an die Person nicht der Slug-Vergleich ist, wird mit
  `needs_review` markiert und beim Upload zurueckgehalten, bis ein Mensch
  die Provenienz sieht. Das Modell behauptet, der Mensch bestaetigt. Das ist
  die Antwort auf Fehladressierung ohne fremde Seiten zu laden.
- **Kein Purge-Job fuer den Papierkorb (Codex R3, abgelehnt).** Der
  Papierkorb ist zum Zurueckholen da; ein Purge waere ein zweiter, stiller
  Loeschweg. Aufbewahrung = so lange die Suche existiert, wie bei
  `company_summary` und `website_audit` heute. Endgueltiges Loeschen raeumt
  per Kaskade auf.
- **Keine Semaphore je Jobtyp (Codex R3, erneut abgelehnt), aber ein
  messbares Abbruchkriterium im Live-Test.** Der Test laeuft mit 8 bis 10
  Kontakten. Gemessen werden Laufzeit je Job (`jobs.locked_at` bis
  `completed`) und das Alter des aeltesten offenen Jobs anderer Typen
  waehrend des Laufs. Kriterium: Median ueber 120 s oder fremde Jobs aelter
  als 10 Minuten -> Deckel je Suche wird gesenkt, bevor eine grosse Liste
  freigegeben wird. Der Wert von `WORKER_CONCURRENCY` auf Railway wird im
  Testprotokoll festgehalten.
- **Advisory Lock je Suche in der Claim-Funktion (Codex R4).** Ein
  einzelnes Statement serialisiert nicht; der Lock tut es.
- **Security-Definer-Hygiene (Codex R4).** `search_path` fest, Execute nur
  fuer `service_role`, Zugehoerigkeit von Business und Kontakten zum
  Workspace in der Funktion geprueft. Dasselbe Muster wie 0002 und 0081.
- **Beitrags-URLs werden am Autoren-Slug geprueft (Codex R4).** Ein
  LinkedIn-Beitrag zaehlt nur dann als slug-gebunden, wenn sein Pfad den
  Slug des Kontakts traegt; sonst gilt er als `company_and_role` und geht in
  die Pruefung.
- **Die Kontakt-Prueflliste kommt in v1 (Codex R4).** Eine Rueckhaltung
  ohne Freigabe-Tuer waere eine Sackgasse; die Liste ist klein (eine Route,
  eine Seite) und schliesst den Kreis fuer beide Pruefgruende:
  Regelverstoss beim Schreiben und unbestaetigte Bindung.
- **Testleads in den Papierkorb, nicht loeschen** (Q2).
- **Kontaktebene statt Firma.** 15,5 % der Firmen haben mehr als einen Kontakt.
- **LinkedIn-URL als Pflichtanker (Codex R1).** Ohne `/in/`-URL keine Suche.
  Das beantwortet Namensverwechslung und Maps-Kosten mit einer Regel; der
  Preis ist, dass Hunter-Kontakte ohne URL (10 %) leer ausgehen.
- **Werdegang zaehlt als Selbstveroeffentlichung (Codex R1, abgelehnt).**
  Das LinkedIn-Profil pflegt die Person selbst; es steht damit auf derselben
  Stufe wie ein Beitrag, nur mit niedrigerem Rang. Der Nutzer hat die
  Werdegang-Typen ausdruecklich verlangt.
- **Eine Recherche mit Suche, keine tool-lose Vorstufe (Codex R1,
  abgelehnt).** Die Rangfolge verlangt zu wissen, ob eine Aussage existiert;
  das erfordert die Suche in jedem Fall. Eine Vorstufe spart nichts und
  kostet einen Aufruf.
- **Quelle wird genannt, anders als bei den zwei anderen Texten.** Bei einem
  Menschen ist die Herkunft der Unterschied zwischen hoeflich und beobachtet.
  Das Label kommt aus dem Code, nicht vom Modell.
- **Eigene, sprachspezifische Verbotsliste**, weil die Workspace-Liste die
  Herkunftsnennung verbietet.
- **Reaktion nur aus dem Angebotsproblem**, keine erfundene Meinung.
- **`needs_review` haelt zurueck (Codex R1).** Bewusst strenger als bei
  `websiteFinding`; die Angleichung dort ist eigene Arbeit.
- **CTA gehoert in die Sequenz, nicht in die Variable.**
- **Zwei Kampagnen statt einer degradierenden Sequenz.**
- **Kein Prompt-Override, kein Requeue-RPC, kein Tagesbudget in v1.**
  Opt-in und Deckel je Suche sind die Kostenbremse; Parallelitaet ist eine
  Railway-Einstellung. Nachruestbar ohne Umbau. (Die Kontakt-Prueflliste
  IST in v1, siehe Schritt 6a und die R4-Entscheidung unten.)

## Assumptions

Bestaetigte Liste vom 2026-09-22 (15 Punkte). Zusaetzlich: Codex laeuft
read-only, liest aber nichts (Windows-Policy), Material wird inliniert.

## Risks / open questions

- Findet `gpt-4.1-mini` mit `web_search` LinkedIn-Beitraege? Live-Test.
  Rueckfall `gpt-4.1` als Konstante.
- Laufzeit 50 bis 60 s je Kontakt; opt-in begrenzt die Menge.
- OpenAI berechnet fehlgeschlagene Anfragen nicht; Retries kosten Zeit, kein
  Geld. Queue-Retry bleibt die einzige Wiederholung ueber tenacity hinaus.
- LinkedIn-Nutzungsbedingungen: keine LinkedIn-Seite wird abgerufen, es wird
  eine Suchmaschine gefragt.

## Out of scope

Requeue-RPC, Prompt-Override je Workspace,
Tagesbudget je Workspace, Angleichung von `websiteFinding` an die
`needs_review`-Rueckhaltung, Chrome-Skill `person-finding`, Aenderungen an
ramys Workspace (nur lesend), Sequenz und Kampagne anlegen (nach dem Test).
