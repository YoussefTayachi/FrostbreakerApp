# Plan Review Log: Person-Finding
Phases 0-1 (recon + interrogation) complete — plan locked with the user. MAX_ROUNDS=5. inspect=on.

## Mechanik-Hinweis (Runde 1)
Codex' Read-only-Sandbox auf Windows blockt PowerShell ("blocked by policy"), damit kann der Reviewer keine Datei lesen. Plan, Migration, Entwurf und die relevanten Code-Ausschnitte wurden deshalb in den Prompt inliniert (REVIEW_PROMPT_R1). Sandbox bleibt read-only. Reviewer-Modell laut Codex-Ausgabe: gpt-5.6-terra (CLI-Standard, nichts gepinnt).

## Round 1 — Codex (thread 01a0c9f9-45b9-7e12-866e-9ee9957ad00b)
- **Race/Doppelkosten:** Fan-out und `run()` setzen Status unconditionally; zwei Jobs können denselben Kontakt gleichzeitig recherchieren. **Fix:** Status atomar per `UPDATE … WHERE status IS NULL/PENDING RETURNING id` claimen und nur der Gewinner darf enqueuen bzw. suchen.

- **Verlorene Jobs:** Status wird vor `enqueue_many` auf `pending` gesetzt; schlägt das Enqueue fehl, bleiben Kontakte dauerhaft hängen. **Fix:** Statuswechsel und Outbox/Job-Erzeugung in einer DB-Transaktion bzw. RPC kapseln.

- **Papierkorb wird ignoriert:** Anders als `website_finding` prüft die neue Pipeline nicht `search_is_deleted`; Jobs nach Schritt 7d können weiter Web-Suchen bezahlen. **Fix:** Vor jedem Statuswechsel und Modellaufruf Suche auf `deleted_at` prüfen und abbrechen.

- **Filter ist nur beim Enqueue wirksam:** Wird `person_findings` nach dem Start deaktiviert, bereits eingereihte Jobs laufen trotzdem weiter. **Fix:** Im Kontaktjob den aktuellen Search-Filter prüfen und bei deaktiviertem Flag ohne Recherche beenden.

- **Corporate-Leads werden übersehen:** `_finish()` fannt für Corporate aus, bevor `hunt_persons` Kontakte einfügt; der Plan hängt nur `find_decisionmaker` nach Insert ein. **Fix:** Person-Finding zentral nach jedem Kontakt-Insert auslösen, insbesondere auch in `hunt_persons`.

- **Kontakt-Level wird beim Versand gebrochen:** Readiness wählt erst einen Primärkontakt je Firma und filtert danach nach Finding; ein zweiter Kontakt mit Finding wird dadurch verworfen. **Fix:** Zuerst nach benötigtem `person_finding` filtern und danach den besten verbleibenden Kontakt pro Firma wählen.

- **Apollo-Kontext fehlt in der tatsächlichen Abfrage:** Der Draft lädt keinen `custom`-Wert, obwohl der Plan Apollo-Daten dort speichern und verwenden will. **Fix:** `contacts.custom` gezielt selektieren, validieren und als klar abgegrenzten Apollo-Kontext übergeben.

- **“Nur suchen, was Apollo nicht weiß” ist nicht implementiert:** `research()` aktiviert immer `web_search`; auch vollständige Apollo-Werdegänge lösen eine bezahlte Suche aus. **Fix:** Eine tool-lose Apollo-First-Stufe oder einen harten Search-Gate einführen.

- **Maps-Kostenfalle:** Die Fan-out-Abfrage recherchiert jeden Kontakt mit E-Mail, obwohl laut Plan nur 7 % der Maps-Kontakte ein LinkedIn-Profil haben. **Fix:** Für v1 nur Kontakte mit verifizierter LinkedIn-URL bzw. ausreichendem Identitätsanker zulassen.

- **Retry-Multiplikator:** Tenacity, OpenAI-Client-Retries und Queue-Retries können denselben fehlgeschlagenen Web-Call vielfach abrechnen; Fehlschläge erscheinen womöglich nicht in `api_usage`. **Fix:** Einen globalen Versuchszähler nutzen, fehlgeschlagene Aufrufe erfassen und pro Kontakt ein Kostenlimit setzen.

- **Keine Budget- oder Fairness-Grenze:** Tausende 120-Sekunden-Websuchen können zwei Worker-Repliken stundenlang blockieren und andere Workspaces verdrängen. **Fix:** Workspace-Quota, niedrige dedizierte Parallelität und Batch-/Tageslimit für Person-Finding einführen.

- **Namensverwechslung bleibt technisch unkontrolliert:** Ein Modell darf `source_kind` und Firmenbindung behaupten; eine URL allein beweist nicht, dass Dean Smith bei genau dieser Firma gemeint ist. **Fix:** Identität deterministisch gegen LinkedIn-URL oder Quelle mit Firmen-/Rollenbeleg validieren, sonst `none`.

- **Career-Findings widersprechen dem Sicherheitsprinzip:** `background`, `side_switch` usw. aus Apollo-Profilen sind keine öffentliche Äußerung und kollidieren mit „wer nichts Öffentliches hat, bekommt keinen Absatz“. **Fix:** Karriere-only-Findings aus v1 entfernen oder ausdrücklich als separaten, strengeren und sichtbaren Modus definieren.

- **Ungeprüfte Provenienz:** DDL speichert nur Text, Status und Review-Flag, nicht Claim, URL, Datum oder Fundtyp; später kann niemand eine Mail prüfen oder korrigieren. **Fix:** Strukturierte Provenienz je Finding persistent speichern, inklusive URL, Abrufzeit, Identitätsanker und ausgewähltem Typ.

- **Prompt-Injection-Grenze fehlt:** Web-Funde, `verbatim` und rohe Apollo-Felder werden dem Schreibmodell als Instruktions-naher Text übergeben. **Fix:** Untrusted-Daten klar delimitieren, als Daten statt Anweisungen behandeln und vor Übergabe Längen-/Zeichenlimits anwenden.

- **„Eigene Verbotsliste“ ist unklar umgesetzt:** Der Draft übergibt `cfg["banned_words"]`, nicht die im Plan definierte Person-Finding-Liste; außerdem decken englische Wörter deutsche Texte kaum ab. **Fix:** Eine eigene, sprachspezifische, normalisierte Liste explizit bauen und in beiden Validierungsdurchläufen verwenden.

- **Prompt verlangt erfundene Haltung:** „Where you stand“ fordert eine persönliche Position, liefert aber keine belastbare Senderposition außer dem Angebot. **Fix:** Nur explizit hinterlegte POV-Sätze erlauben oder diesen Teil streichen.

- **Quellenbenennung kann halluzinieren:** Das Modell kann „auf LinkedIn“ schreiben, obwohl `source_url` eine andere oder tote Quelle ist. **Fix:** Quellenlabel serverseitig aus validiertem URL-Host und `source_kind` ableiten.

- **`needs_review` blockiert keinen Upload:** Ein fehlerhafter Person-Absatz kann trotz gesetztem Flag als Merge-Variable versendet werden. **Fix:** Kontakte mit `person_finding_needs_review=true` bei verwendeter Variable genauso zurückhalten und separat ausweisen.

- **Status-Observability ist zu schwach:** `none`, `failed`, `pending` und laufende Suchen werden im Kampagnen-Torwart alle nur als „missing“ sichtbar. **Fix:** Readiness und UI um Statuszählungen, Fehlerraten, Alter laufender Jobs und Kosten pro Ergebnis erweitern.

- **Wortgrenzen sind widersprüchlich:** Der Plan fordert 45 Wörter, der bereitgestellte Draft dokumentiert und erzwingt 70; das gefährdet auch die 90-Wörter-Mailgrenze. **Fix:** 45 als einzige Konstante durchsetzen und alle Prompt-, Kommentar-, Drift- und Readiness-Stellen synchronisieren.

VERDICT: REVISE

### Claude's response (Runde 1)
Uebernommen: atomarer Claim und atomares Auffaechern mit Rueckgabe der geaenderten Zeilen; Rollback auf null bei Enqueue-Fehler; Papierkorb- und Flag-Pruefung im Kontaktjob; Einreihen zentral nach jedem Kontakt-Insert (auch hunt_persons); Split VOR pickPrimaryContactPerBusiness, gemeinsame prepareLeads fuer Upload und Readiness; Apollo-custom wird selektiert und als gekappter Datenblock uebergeben; LinkedIn-/in/-URL als Pflichtanker (loest Maps-Kosten und Namensverwechslung); identity_anchor im Schema, Auswahl deterministisch im Code; Provenienz in contacts.person_finding_source (Migration 0119); Datenbloecke abgegrenzt und gekappt (Injection); eigene sprachspezifische Verbotsliste, normalisiert; Quellenlabel serverseitig aus Host und source_kind; needs_review haelt beim Upload zurueck; Readiness zaehlt Status (pending/none/failed/needsReview); 45 als einzige Wortgrenze.
Abgelehnt mit Grund: (a) Werdegang-Typen streichen: das LinkedIn-Profil pflegt die Person selbst, es ist Selbstveroeffentlichung mit niedrigerem Rang, und der Nutzer hat die Typen ausdruecklich verlangt. (b) Tool-lose Apollo-Vorstufe: die Rangfolge verlangt zu wissen, ob eine Aussage existiert, also laeuft die Suche in jedem Fall; die Vorstufe kostet einen Aufruf und spart keinen. (c) Tagesbudget/Workspace-Quota: opt-in ist die Bremse, Parallelitaet ist eine Railway-Einstellung; v1 ohne. (d) Retry-Multiplikator als Kostenfalle: OpenAI berechnet fehlgeschlagene Anfragen nicht, usage wird nur bei Erfolg geschrieben; tenacity auf 2 reduziert, mehr nicht. (e) "Where you stand" streichen: die Reaktion bleibt, wird aber aus dem problem-Feld des Angebots abgeleitet statt frei erfunden.
Transaktion Status+Enqueue per RPC: nicht gebaut, Rollback im Fehlerfall reicht fuer v1 (Queue-Retry des Firmen-Jobs ist idempotent, weil nur Status-null-Zeilen geclaimt werden).

## Round 2 — Codex
Der Großteil meiner ersten Runde ist jetzt entweder sauber adressiert oder ausdrücklich entschieden: atomarer Fan-out/Claim, Enqueue-Rollback, Papierkorb- und Flag-Prüfung, Hunter-Hook, Auswahlreihenfolge, Apollo-Kontext, Maps-Gate, Provenienz, Datenabgrenzung, sprachspezifische Verbote, begründete Reaktion, serverseitiges Quellenlabel, `needs_review`-Rückhaltung, Status-Reporting und 45-Wörter-Drift sind abgedeckt. Tool-lose Vorstufe, Werdegang als Quelle und Tagesbudget werden explizit verworfen; die Begründungen sind nachvollziehbar, aber die Kostenentscheidung bleibt bewusst riskant.

- **Fehlerzustand ist mit dem neuen Claim-Protokoll unvollständig:** Nach zwei fehlgeschlagenen Research-Versuchen ist nicht definiert, wie ein auf `running` geclaimter Kontakt in einen Queue-retryfähigen Zustand kommt; bei `failed` wird ein erneut zugestellter Job wegen `status != pending` sofort verworfen. **Fix:** Zustandsautomat explizit definieren: bei retryfähigem Fehler zurück auf `pending`, bei finalem Fehler auf `failed`, jeweils mit begrenztem Versuchszähler.

- **Finaler Write kann menschliche Änderungen überschreiben:** Text wird nur vor der Recherche geprüft; ein Nutzer kann während Research/Write einen Absatz eintragen, den das finale unbedingte Update überschreibt. **Fix:** Finales Update mit `WHERE id=? AND person_finding IS NULL AND person_finding_status='running'` ausführen und bei keiner zurückgegebenen Zeile abbrechen.

- **Der LinkedIn-Anker ist nur ein String-Muster:** `ILIKE '%/in/%'` akzeptiert beliebige Hosts, Redirect-URLs und manipulierte Pfade; auch der Pfadvergleich für Profile ist ohne Normalisierung fragil. **Fix:** LinkedIn-URLs serverseitig parsen, nur erlaubte LinkedIn-Hosts akzeptieren und kanonische `/in/<slug>`-IDs vergleichen.

- **Identität bleibt für Nicht-Profilquellen modellbasiert:** `identity_anchor=company_and_role` ist keine verifizierte Bindung zwischen einer externen Quelle, der konkreten Person und ihrem LinkedIn-Profil. **Fix:** Für jede Nicht-Profilquelle einen prüfbaren Beleg verlangen, etwa kanonische Profil-URL oder Quelleninhalt mit Name plus Firma/Rolle, und diesen in Provenienz speichern.

- **Apollo-Werdegang wird als aktuelle LinkedIn-Tatsache ausgegeben:** Die Pipeline darf eine alte Apollo-Kopie als `profile`-Finding verwenden, obwohl die verlinkte Profilseite die konkrete Karriereinformation nicht mehr enthalten muss. **Fix:** Karriere-Findings nur akzeptieren, wenn die aktuelle kanonische Profilquelle den verwendeten Fakt belegt, oder Apollo-Fakten als eigene, nicht-versendbare Vorqualifizierung behandeln.

- **Kosten- und Queue-Risiko bleibt materiell:** „Opt-in“ begrenzt weder eine versehentlich große Suche noch OpenAI-/Railway-Konkurrenz; jeder `/in/`-Kontakt startet weiterhin eine Websuche, auch wenn das Profilmaterial bereits ausreichend wäre. **Fix:** Mindestens ein Workspace-Maximum pro Suche und eine dedizierte, niedrige Job-Parallelität in Code/Queue erzwingen, nicht nur als Railway-Konfiguration annehmen.

- **Fehlversuche sind nicht zuverlässig beobachtbar:** Die Annahme, fehlgeschlagene Anfragen kosteten nie Geld, ist nicht belastbar; zudem wird `usage.record_openai` nur bei erfolgreicher Response beschrieben. **Fix:** Versuchszahl, Fehlerklasse, Laufzeit und soweit verfügbar Request-/Usage-Metadaten pro Research-Versuch persistieren.

- **Datenschutz/Retention ist weiterhin offen:** Es werden zusätzlich Werdegang, öffentliche Aussagen, Zitate, Identitätsanker und Recherchezeit dauerhaft pro Kontakt gespeichert, ohne Lösch-, Zugriffs- oder Aufbewahrungsregel. **Fix:** Zweck, Zugriffskontrolle und automatische Löschung der Provenienz bei Kontakt-/Search-Löschung sowie einen dokumentierten Retention-Zeitraum festlegen.

- **„Ohne Brücke“ widerspricht dem Schreibauftrag:** Der Goal-Text verbietet eine Brücke, während Teil 4 den Fund explizit mit Angebot/Mechanismus verbinden soll. **Fix:** Eine eindeutige Definition wählen: entweder maximal Herkunft+Aussage oder eine erlaubte, sachliche Angebotsüberleitung als Teil des Absatzes.

VERDICT: REVISE

### Claude's response (Runde 2)
Uebernommen: Zustandsautomat (Fehler -> pending bis max_attempts, dann failed; nie automatisch wiederholt); bedingter finaler Schreibzugriff (id + person_finding is null + status running, sonst still beenden); canonical_linkedin() als einziger Anker (Host linkedin.com oder Subdomain, Pfad /in/, Slug kleingeschrieben ohne Query); identity_evidence im Schema, Pflicht bei company_and_role; fresh_move nur bei Anreicherung <= 3 Monate, profile-Label immer "on your LinkedIn profile"; Deckel 300 Kontakte je Suche im Code; Fehlversuche als api_usage-Zeile (Menge 1, Einheit attempts, ohne Betrag); Datenschutz in Migration 0119 und docs/BETRIEB.md dokumentiert (Loeschung per bestehender Kaskade); Goal-Text zur "Bruecke" praezisiert (Sachsatz zum Angebotsproblem ja, Formel nein).
Abgelehnt mit Grund: Live-Pruefung gegen LinkedIn und Abruf externer Quellen (waere Scraping, genau der Weg, den die Pipeline nicht geht; Ersatz: Anker-Pflicht, gespeicherter Beleg, sichtbare Provenienz); dedizierte Parallelitaet je Jobtyp (find_decisionmaker hat dasselbe Profil ohne eigene Schranke; eigenes Vorhaben); Retention-Automatik (v1 dokumentiert statt automatisiert).

## Round 3 — Codex
Meine R2-Punkte sind überwiegend adressiert: Zustandsautomat, bedingter finaler Write, kanonische LinkedIn-URL, begrenzte Suche pro Search, Fehlversuchs-Tracking, explizite Überleitung und Tests sind ergänzt. Live-Quellenprüfung, Jobtyp-Parallelität und automatische Retention werden ausdrücklich mit Begründung verworfen. Dennoch bleiben materielle Probleme:

- **Der 300er-Deckel ist nicht atomar:** Mehrere Firmen-Fan-out-Jobs können gleichzeitig unter 300 zählen und gemeinsam weit mehr als 300 Kontakte auf `pending` setzen. **Fix:** Globales Zählen, Kapazitätsprüfung und Claiming je `search_id` in einem einzigen SQL-RPC/Transaktionsschritt ausführen.

- **Der Deckel erzeugt unsichtbar dauerhafte Null-Status-Leads:** Nicht geclaimte Kontakte bleiben `NULL`; Readiness meldet nur `pending`, `none` und `failed`, nicht „wegen Limit nicht recherchiert“. **Fix:** Einen expliziten Status wie `skipped_limit` hinzufügen oder die nicht eingeplanten Kontakte konsistent als solchen Grund ausweisen.

- **Quellen- und Identitätsbelege bleiben vom Modell behauptet:** `identity_evidence` ist nur modellgenerierter Text; ohne serverseitige Prüfung kann es Name, Rolle oder Zitat halluzinieren. Die Entscheidung gegen externes Abrufen erklärt den Verzicht, beseitigt aber das Fehladressierungsrisiko nicht. **Fix:** Nur Quellen zulassen, deren kanonische Person-URL direkt dem LinkedIn-Slug entspricht, oder vor Versand eine menschliche Provenienzprüfung verpflichtend machen.

- **`source_kind` und URL-Host werden nicht gegenseitig validiert:** Ein Modell kann etwa `podcast` zu einer beliebigen URL oder `own_post` zu einem fremden Profil liefern; das serverseitige Label macht die Behauptung nur glaubwürdiger. **Fix:** Eine harte Source-kind/Host-Matrix implementieren und unzulässige Kombinationen in `best_finding()` verwerfen.

- **Die Kostenannahme zu Fehlversuchen ist unbelegt:** „Fehlgeschlagene Anfragen kosten kein Geld“ ist kein sicherer Abrechnungsvertrag und kann zu einer falschen Kostenanzeige führen. **Fix:** Fehlversuche als Kosten „unbekannt“ führen und im Live-Test gegen die tatsächliche Provider-Abrechnung validieren.

- **Datenschutz ist nur dokumentiert, nicht operationalisiert:** Papierkorb-Suchen bleiben ausdrücklich erhalten; damit bleiben auch Zitate, Karriereprofil und Provenienz ohne Ablaufzeit dauerhaft gespeichert. **Fix:** Eine Aufbewahrungsfrist oder zumindest einen gezielten Purge-Job für gelöschte Suchen/Kontakte vorsehen.

- **Die abgelehnte Jobtyp-Parallelität bleibt ein Betriebsrisiko:** Bis zu 300 Web-Recherchen plus Schreibjobs einer Suche können dieselbe Queue wie bestehende Pipelines dominieren; die Gleichheit mit `find_decisionmaker` ist keine Kapazitätsgarantie. **Fix:** Mindestens einen getesteten Queue-/Railway-Concurrency-Wert und ein Abbruch-/Alarmkriterium im Live-Test verbindlich festlegen.

VERDICT: REVISE

### Claude's response (Runde 3)
Uebernommen: Deckel atomar per DB-Funktion claim_person_finding_contacts (Zaehlen je search_id und Setzen in einem Statement, Migration 0119); Statuswert skipped_limit statt stiller Null, im Torwart als skippedLimit sichtbar; Quellenart-Host-Matrix in best_finding (own_post/profile/company_post_quote nur linkedin.com, podcast/interview/talk nur fremder Host, article beliebig); needs_review = true fuer jeden Fund, dessen Anker nicht der Slug-Vergleich ist, damit beim Upload zurueckgehalten bis ein Mensch die Provenienz freigibt; Fehlversuche mit cost_usd null als "unbekannt", Abrechnung im Live-Test gegen das OpenAI-Dashboard geprueft; messbares Abbruchkriterium im Live-Test (Median Laufzeit > 120 s oder fremde Jobs > 10 min alt -> Deckel senken), WORKER_CONCURRENCY im Protokoll.
Abgelehnt mit Grund: Purge-Job fuer den Papierkorb (zweiter stiller Loeschweg; Aufbewahrung = Lebensdauer der Suche, wie bei company_summary und website_audit heute; endgueltiges Loeschen kaskadiert); Semaphore je Jobtyp im Code (eigenes Vorhaben, find_decisionmaker laeuft seit Monaten ohne; Ersatz: Deckel je Suche + Opt-in + gemessenes Kriterium); "nur slug-gebundene Quellen zulassen" als Alternative (wuerde Interviews und Podcasts komplett ausschliessen; stattdessen Pruefpflicht per needs_review).

## Round 4 — Codex
Die R3-Punkte zu Limit-Sichtbarkeit, Quellenart-Host-Matrix, Fehlkosten, Retention und Live-Test-Kriterium sind ergänzt oder ausdrücklich entschieden. Es bleiben drei neue materielle Lücken:

- **Die DB-Funktion ist trotz „einem Statement“ nicht zwingend limit-sicher:** Zwei Transaktionen können denselben bisherigen Search-Zähler sehen und unterschiedliche Kontaktzeilen claimen; ein einzelnes Statement ersetzt keine Serialisierung über die Search. **Fix:** In der Funktion die zugehörige `searches`-Zeile mit `FOR UPDATE` oder einem Advisory Lock pro `search_id` sperren, dann zählen und claimen.

- **`SECURITY DEFINER` ist ein Sicherheitsloch, solange Rechte und Eingaben nicht hart begrenzt sind:** PostgreSQL-Funktionen sind ohne expliziten `REVOKE` typischerweise für `PUBLIC` ausführbar; zudem beschreibt der Plan weder festen `search_path` noch die Prüfung, dass Business und Kontakt-IDs tatsächlich zum übergebenen Workspace gehören. **Fix:** `REVOKE EXECUTE FROM PUBLIC`, nur `service_role` gewähren, `SET search_path` festsetzen und Workspace/Business/Kontaktzugehörigkeit innerhalb der Funktion validieren.

- **`linkedin_url` ist für Posts nicht wirklich validiert:** Nur `profile`-URLs werden gegen den kanonischen Kontakt-Slug verglichen; ein beliebiger LinkedIn-Post kann `identity_anchor=linkedin_url` behaupten, ohne Review freigegeben werden und so an die falsche Person gehen. **Fix:** Für `own_post` und `company_post_quote` ebenfalls einen serverseitig prüfbaren Autoren-Slug verlangen oder sie immer mit `needs_review=true` zurückhalten.

- **Die angekündigte menschliche Freigabe ist nicht implementierbar:** Nicht-Slug-Funde werden blockiert „bis ein Mensch die Provenienz freigibt“, aber `person_finding_source` wird für keine Web-Ansicht selektiert und eine kontaktbezogene Prüfliste/Freigabe bleibt out of scope. **Fix:** Eine minimale kontaktbezogene Review-/Freigabeaktion samt Provenienz-Anzeige in den Umfang aufnehmen, oder diese Quellen in v1 generell als `none` behandeln.

VERDICT: REVISE

### Claude's response (Runde 4)
Uebernommen, alle vier: Advisory Lock je search_id in claim_person_finding_contacts (ein Statement serialisiert nicht); Security-Definer-Hygiene nach Muster 0002/0081 (search_path fest, Execute nur service_role, Zugehoerigkeit von Business und Kontakten zum Workspace in der Funktion geprueft, fremde ids ignoriert); LinkedIn-Beitraege gelten nur als slug-gebunden, wenn der Pfad den Slug des Kontakts traegt, sonst Herabstufung auf company_and_role und Pruefung; Kontakt-Prueflliste /person-finding in den Umfang aufgenommen (Route GET/PATCH approve|discard|text, Seite mit Absatz und Provenienz, Navigation unter AI Agent), review_reason in der Provenienz.

## Round 5 — Codex
Die R4-Funde sind grundsätzlich adressiert: Search-weit serialisierter Claim, abgesicherte `SECURITY DEFINER`-Funktion, Post-Slug-Prüfung und eine kontaktbezogene Freigabeoberfläche sind jetzt eingeplant.

- **Die Autorenprüfung per „Pfad enthält Slug“ ist zu schwach:** Ein fremder Beitrags-Pfad kann den Ziel-Slug als Teilstring enthalten und dadurch ohne Review als personen-gebunden gelten; das kann eine falsche Mail freigeben. **Fix:** Den LinkedIn-Pfad grammatisch parsen und nur einen exakten Autorenbestandteil akzeptieren, z. B. `/posts/<canonical-slug>_…`, nicht `slug in path`.

- **Die Prüfungsliste ist widersprüchlich im Scope:** Schritt 6a baut sie als zwingende Freigabetür, aber die letzte Key-Decision sagt weiterhin „keine Prüflisten-Ansicht … in v1“. Folgt die Implementierung letzterer Aussage, bleiben alle `company_and_role`-Funde dauerhaft blockiert. **Fix:** Den veralteten Ausschluss aus den Key Decisions entfernen und API/Page einschließlich Workspace-Isolation, Approve, Discard und Text-Override testen.

VERDICT: REVISE

### Claude's response (Runde 5)
Uebernommen, beide: linkedin_post_author() parst den Pfad grammatisch (Host linkedin.com, Segment "posts", Autor bis zum ersten "_", exakter Vergleich mit dem kanonischen Slug; /pulse/ und alles andere liefern None); der veraltete Ausschluss "keine Prueflisten-Ansicht in v1" aus den Key Decisions entfernt, Tests fuer Review-Logik (Text-Override, approve/discard, Workspace-Isolation) ergaenzt.

## Resolution
MAX_ROUNDS=5 erreicht. Letzter Stand: VERDICT: REVISE, aber beide Punkte der fuenften Runde sind uebernommen und im Plan eingearbeitet. Es gibt keinen offenen Dissens: alles, was Codex in fuenf Runden angemerkt hat, ist entweder uebernommen oder mit protokolliertem Grund abgelehnt (Werdegang-Typen, tool-lose Vorstufe, Live-Pruefung gegen LinkedIn, Semaphore je Jobtyp, Purge-Job, Tagesbudget). Der Deckel der Runden ist erreicht, nicht ein APPROVED; das wird hier ehrlich so festgehalten.

## Post-build inspection (frische Codex-Sitzung 01a0ca22-f62b-7163-a777-256b0c3be6eb, read-only, Diff inliniert)
- `apps/worker/worker/pipelines/person_finding.py: run()` — A contact manually populated after its job is queued causes an immediate `return`, leaving its existing `pending` status intact. Likewise, if the final conditional write loses to a manual edit/reset, the contact remains `running`. Both states permanently consume the per-search cap and misreport readiness. Fix: conditionally reset `person_finding_status` to `null` when exiting for an existing/manual finding or a lost final write.

- `apps/web/app/api/person-finding/review/route.ts: PATCH` — The endpoint only scopes by workspace, not by `person_finding_needs_review`, finding presence, or a non-deleted search. A crafted request can `discard` any approved contact’s finding, or `save` arbitrary text onto any contact in the workspace; concurrent reviewer actions can overwrite each other too. Fix: fetch and update only rows with `needs_review = true`, non-null finding, and an active search, with the same predicates on the final `update` and a returned-row check.

- `apps/web/app/api/person-finding/review/route.ts: GET` — Deleted-search rows are filtered in JavaScript after `.limit(500)`. If the first 500 rows are largely in the trash, active review items beyond that limit never appear, despite the requirement to return up to 500 active contacts. Fix: make `searches.deleted_at is null` part of the joined SQL/Supabase query before ordering and limiting.

- `apps/worker/worker/pipelines/person_finding.py: source_label()` — An `article` hosted on LinkedIn is relabelled as `own_post` (“On LinkedIn you wrote”), even though the permitted `article` type may be any URL and can be only `company_and_role`-anchored. This can falsely claim authorship in the outbound email. Fix: remove the LinkedIn special case and always label `article` as “In your piece on <host>”, per the plan.

- `apps/worker/worker/pipelines/person_finding.py: WRITE_BASE_EN/DE` — With no default offer, `person_context()` omits `<offer>`, but the fixed writing prompt still mandates “what it means,” a number, and the mechanism. This conflicts with the plan’s explicit rule that, without an offer, parts 3 and 4 are omitted and the paragraph contains only source and statement. Fix: select a no-offer prompt variant that requests only the source-backed observation.

- `supabase/migrations/0119_person_finding_provenienz.sql: claim_person_finding_contacts()` — The supposedly hard 300-search cap is entirely caller-controlled through `p_limit`; any service-role caller or future regression can pass an unlimited value and trigger unbounded paid web searches. `SECURITY DEFINER` does not make this safer, because the function itself is the authoritative enforcement point. Fix: clamp inside SQL, e.g. compute room from `least(greatest(p_limit, 0), 300)` (or remove the parameter and use the fixed ceiling).

- `apps/worker/worker/pipelines/person_finding.py: SCHEMA` — `claim`, `verbatim`, and `identity_evidence` lack the plan-required 300-character JSON-schema limits. The worker truncates selected values later, but the model can still produce oversized structured outputs, increasing cost and allowing unnecessary context before filtering. Fix: add `maxLength: 300` to all three schema properties.

- `apps/worker/worker/pipelines/person_finding.py: _faechere_auf()` — The “no valid LinkedIn anchor” update is not conditional on `person_finding_status is null`. A concurrent business job or manual workflow can set one of those selected contacts to `pending`/another state between the read and update, and this code overwrites it to `none`. Fix: add `.is_("person_finding_status", "null")` to that update.
### Claude's dispositions
Uebernommen (7): run() setzt bei vorhandenem Text bzw. verlorenem finalen Schreibzugriff den Status auf 'found' statt ihn auf pending/running zu lassen; PATCH der Prueflliste scopet zusaetzlich auf needs_review = true und person_finding not null und prueft die Rueckgabe; GET filtert den Papierkorb in der Abfrage statt nach dem Limit; source_label relabelt einen LinkedIn-'article' nicht mehr als own_post; Schreib-Prompt bekommt eine Variante ohne Angebot (nur Teil 1); Deckel wird in der DB-Funktion selbst auf 300 geklemmt (Migration 0120); der 'none'-Update im Auffaechern ist auf Status null bedingt.
Abgelehnt mit Grund (1): maxLength im JSON-Schema. OpenAIs strict-Modus akzeptiert fuer Strings kein minLength/maxLength (unbekannte Schluesselwoerter fuehren zu einem 400); die Kappung auf 300 Zeichen sitzt deshalb im Code (_cap) und greift vor jedem weiteren Prompt.

## Live-Test, Lauf 1 (2026-09-22, gpt-4.1-mini fuer die Recherche)
Workspace 82aa389f, Suche b828d5b5 "Test person-finding", 8 Firmen, 9 Kontakte mit LinkedIn-Personenprofil. 17 Jobs (8 Firmen, 9 Kontakte) in unter einer Minute abgearbeitet, keine Fehler. Kosten: 9 Recherchen 3,2 Cent gesamt (8330 Tokens je Aufruf), 1 Schreibaufruf 0,05 Cent.
Ergebnis: 1 found (Jack Stroeken, Ekomenu: statement aus einer Pressemitteilung auf ekomenu.nl, Anker company_and_role, in der Pruefung), 4 none mit genau einem unbrauchbaren Fund, 4 none ohne Fund. Der Absatz zu Stroeken enthielt eine erfundene Folgerung ("This shows many customers order again"), also genau die Sorte Satz, die der Prompt verbietet; er stand korrekt in der Pruefung.
Befund: die Suche ist das Problem, nicht das Schreiben. Stroeken hat ein Dutzend eigene LinkedIn-Beitraege der letzten zwei Monate; mini fand keinen. Deshalb Lauf 2 mit gpt-4.1 fuer die Recherche, Suchstrategie im Prompt, Ablehnungsgrund je Fund in der Provenienz (Commits 61e77ba, e601e41).

## Live-Test, Lauf 2 (2026-09-22, gpt-4.1 fuer die Recherche, Suchstrategie im Prompt)
Dieselben 9 Kontakte, zurueckgesetzt. Ergebnis: 9 von 9 found, 1 in der Pruefung (Mischa Kremer: Beitrag ueber Bitcoin, Anker company_and_role, vermutlich falsche Person oder irrelevant, korrekt zurueckgehalten). Aber: 8 der 9 Absaetze waren role_vs_size oder background aus dem blossen Titel, weil die Testkontakte keine Apollo-Daten trugen; mehrere in der dritten Person ("Dean Smith manages ..."), fuenf endeten mit "Retaiyn sends ...". Die Websuche fand auch mit gpt-4.1 keinen einzigen LinkedIn-Beitrag (Stroeken hat ein Dutzend).
Folgerungen (Commit 2712417): Profil-Typen setzen Headline oder Werdegang in custom.apollo voraus, sonst no_known_facts; Name der Person und eigener Markenname sind Verbote je Lauf und loesen die Korrekturrunde aus; Prompt verlangt Du in jedem Satz und Teil 2 nur aus dem Angebotsproblem. Fuer Lauf 3 bekommen Dean Smith und Jack Stroeken die Profil-Daten, die Apollo bei echten Leads liefert (aus ihren oeffentlichen Profilen abgeschrieben); die anderen sieben bleiben ohne und muessen ehrlich auf none enden.

## Live-Test, Lauf 3 (2026-09-22, Profil-Typen brauchen Profil-Daten; Dean Smith und Jack Stroeken mit Profil-Daten)
Ergebnis: 4 found, alle in der Pruefung; 5 none, alle mit Grund no_known_facts (ehrlich: keine Profildaten, kein Beitrag). Jack Stroeken bekam genau den Beitrag, der von Hand als bester Aufhaenger galt ("Gezond eten is geen motivatieprobleem. Het is een ritmeprobleem"). Kein Absatz in der dritten Person, kein eigener Markenname mehr.
Zwei Befunde aus den Quellen: (1) Das Modell liest Beitraege von der Aktivitaetsseite und nennt das Profil als URL; die Slug-Pruefung sah deshalb keinen Beitrags-Pfad und stufte herab. Ein Beitrag auf dem eigenen Profil ist an die Person gebunden, das gilt jetzt als linkedin_url. (2) Pedro Principe war der falsche Pedro Principe (PUBIN, Portugal), Beleg "Pedro Principe's own LinkedIn post" ohne Firma. company_and_role braucht jetzt ein Wort der Firma im Beleg (Commit c97172d). Lauf 4 prueft beides an den vier Kontakten.

## Live-Test, Lauf 4 (2026-09-22, Anker-Regel aus c97172d)
Vier Kontakte zurueckgesetzt. Dean Smith: found, pattern, Anker linkedin_url ueber das eigene Profil, keine Pruefung noetig. Jack Stroeken: found, statement, Anker linkedin_url, in der Pruefung wegen Regelverstoss (zu lang). Pedro Principe: none, beide Funde mit "anchor" abgelehnt, der Beleg nannte die Firma nicht; der falsche Pedro geht damit nicht mehr in die Pruefung, sondern faellt durch. Willem Van Velzen: none, die Websuche fand den Beitrag aus Lauf 3 diesmal nicht (Varianz der Suche), Profil-Typ ohne Daten abgelehnt.
Die Texte nannten noch WhatsApp: das Angebot wurde waehrend des Laufs auf Klaviyo umgestellt (Gespraech Youssef mit retaiyn), die Schreibaufrufe lagen davor. Lauf 5 fuer Dean Smith und Jack Stroeken mit dem Klaviyo-Angebot.

## Live-Test, Lauf 5 (2026-09-22, Klaviyo-Angebot)
Dean Smith: found, role_vs_size aus der Headline, Anker linkedin_url, keine Pruefung. Jack Stroeken: found, statement (der Rhythmus-Beitrag), Anker linkedin_url, keine Pruefung. Beide Absaetze in Du-Form, ohne Markenname, Teil 2 bis 4 aus dem Klaviyo-Angebot. Beobachtung: die Websuche liefert je Lauf verschiedene Funde (Dean: Lauf 4 pattern aus Beitraegen, Lauf 5 nur das Profil). Statement-Typen sind damit keine Garantie, sondern ein Treffer, wenn die Suche den Beitrag sieht.

## Live-Test, Lauf 6 (2026-09-22, zehn echte US-Leads aus Apollo, Klaviyo-Angebot)
Apollo-Key ist Free-Plan: API 403, Technologiefilter in der Oberflaeche gesperrt. Suche ueber die Oberflaeche ohne Filter, 13 Shops im Quelltext auf Klaviyo geprueft (13 von 13), 10 Adressen freigeschaltet (10 Credits), LinkedIn-Profile per Websuche, Werdegang aus oeffentlichen Angaben. Zwei Listen (yoyo Klaviyo Ramy, yoyo Klaviyo Berat), 30 Jobs ohne Fehler: 10 Icebreaker, 10 Personen-Befunde, 10 Website-Checks. 6 Absaetze frei, 4 in der Pruefung (2 unverified_anchor, 2 rules).
Vier Befunde von Youssef und die Folgen: (1) Vorschau zeigte fuer Sally Mueller ein Loch, obwohl der Absatz da war: toPreviewLead gab person_finding nicht weiter (d641366). Neue Regel: nie leer, der Shop selbst schreibt den Absatz, wenn die Person nichts hergibt (Typ company). (2) "would lift revenue" in der Sequenz: Konjunktive und Abschwaecher stehen jetzt in BANNED_PHRASES des Playbooks und in der Personen-Verbotsliste, inklusive "may be" nach Austins zweitem Absatz. (3) Audit ist ein 5-Minuten-Video: Angebot, CTAs und alle Stufen umformuliert. (4) Der Icebreaker in Stufe 2 stand zusammenhanglos: die Sequenz rahmt ihn jetzt ("One thing about your shop stuck with me: ...") und leitet in einem Satz zu Klaviyo ueber. Ausserdem: erfundene Zahl "30% revenue" bei Austin Woodward, seither prueft der Code jede Ziffernfolge gegen das Material (a79025d).
