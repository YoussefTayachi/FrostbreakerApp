---
name: team
description: Ruft das Frostbreaker-Team — strategist, ui-designer, copywriter, senior-developer — für ein Vorhaben zusammen, das mehr als eine Disziplin berührt. Der Stratege plant und verteilt, die anderen führen aus. Verwenden, wenn der Nutzer /team tippt oder das Team beim Namen nennt.
user-invocable: true
argument-hint: "[design|copy|dev|strategie ...] <Auftrag>"
---

# Das Team

Vier Subagenten, angelegt in `.claude/agents/`. Wer sie sind und was jeder
darf, steht dort — lies die Datei des Agenten, bevor du ihm etwas aufträgst,
das über seinen Zuschnitt hinausgeht.

| Agent | Zuständig für |
|---|---|
| `strategist` | plant, recherchiert, verteilt, führt zusammen |
| `ui-designer` | Layout, Hierarchie, Zustände, Bewegung, Zugänglichkeit |
| `copywriter` | jeder sichtbare Text, deutsch **und** englisch, plus die Akquise-Prompts |
| `senior-developer` | Datenmodell, Routen, Worker, Migrationen, Tests |

Der Aufruf dieses Befehls **ist** die Erlaubnis, Subagenten zu starten. Ohne
ihn wären sie nicht anzurühren; hier hat der Nutzer ausdrücklich danach
gefragt.

## Wie du den Auftrag verteilst

Zuerst entscheiden, wie groß das Ding ist. Drei Wege, und der erste ist der
häufigste Fehler.

**Ein Satz, eine Disziplin.** „Der Knopf ist zu klein", „diese Fehlermeldung
versteht niemand", „die Query vergisst den Workspace-Filter" — das geht direkt
an den einen zuständigen Agenten. Keine Planungsrunde. Ein Stratege, der
einen Zweizeiler zerlegt, kostet nur Zeit.

**Mehrere Disziplinen, klarer Auftrag.** Du kennst die Aufteilung selbst?
Dann beauftrage die Agenten direkt und parallel — unabhängige Aufträge im
selben Zug, abhängige nacheinander. Reihenfolge, wenn sie sich berühren:
`senior-developer` legt Struktur und i18n-Schlüssel an → `copywriter`
formuliert → `ui-designer` bringt es in Form.

**Unklar, groß, oder es gibt etwas zu recherchieren.** Dann führt der
`strategist`. Er darf selbst weiterverteilen (er hat das Agent-Werkzeug), also
gib ihm den ganzen Wunsch und lass ihn zerlegen.

## Was in jedem Auftrag stehen muss

Ein Subagent sieht deinen Verlauf nicht. Was du weglässt, erfindet er.

- **Die Dateien.** Pfade, nicht „die Suchseite".
- **Das Ziel**, in einem Satz, als Verhalten formuliert — nicht als Lösung.
- **Die Grenzen.** „Nur Optik, kein Datenfluss." „Text ändern, kein Layout."
  Ohne diese Zeile fasst jeder Agent das an, was er am besten kann.
- **Was zurückkommen soll.** Geänderte Dateien, gelaufene Befehle mit
  Ergebnis, offene Annahmen.

## Auswahl per Argument

Nennt der Nutzer die Rollen (`/team design+copy <Auftrag>`), gilt seine
Auswahl, auch wenn du eine andere getroffen hättest. Kürzel: `strategie` →
`strategist`, `design` → `ui-designer`, `copy` → `copywriter`, `dev` →
`senior-developer`.

Ohne Argumente entscheidest du nach den drei Wegen oben.

## Wenn die Antworten zurückkommen

- **Nicht ungeprüft übernehmen.** Ein Agent, der „getestet" schreibt, hat
  vielleicht nur `tsc` laufen lassen. Frag den Befehl und die Ausgabe ab.
- **Gegen das Ziel prüfen, nicht gegen den Plan.** Ein Plan, der sauber
  abgearbeitet wurde und das Problem nicht löst, ist nicht fertig.
- **Widersprüche auflösen, statt beide Fassungen zu übernehmen.** Wenn der
  Designer kürzt und der Copywriter verlängert, entscheidet der Zweck der
  Fläche — im Zweifel der Nutzer.
- Am Ende meldest du dem Nutzer **ein** Ergebnis: was geändert wurde, was
  geprüft wurde, was offen blieb. Nicht vier Berichte hintereinander.

## Die Regeln des Projekts gelten weiter

`CLAUDE.md` bindet jeden Agenten: Deutsch für Kommentare, Commits, UI-Texte
und Doku, Englisch für Bezeichner. Workspace-Filter in jeder Query. Keine
bestehende Migration editieren. Vor dem Push `npm test` und `npx tsc --noEmit`
für das Frontend, `python -m pytest` und `ruff check .` für den Worker — CI
prüft das Frontend nicht.
