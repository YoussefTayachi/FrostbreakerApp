# Korrekturplan: Signup, Bestätigungsmail, Trial-Missbrauch

**Status (aktualisiert 2026-08-03):**

- **Punkt 1 ist umgesetzt** — allerdings anders als unten vorgeschlagen: die
  Weiterleitung sitzt zentral in `apps/web/middleware.ts`
  (`loggedInMustLeavePaths`), nicht in beiden Seiten einzeln. Damit wird die
  App-Hülle gar nicht erst gerendert. `/unsubscribe` ist dort ausdrücklich
  ausgenommen, siehe Kommentar in der Datei.
- **Punkt 2 (Verifizierung des Mailversands) ist weiterhin offen.** Es hat
  sich bis heute niemand außer dem Betreiber registriert, der Fall ist also
  nie eingetreten. Siehe `docs/BETRIEB.md`, Abschnitt Resend.
- **Punkt 3 (Kartenpflicht) ist offen.** Der Vektor besteht unverändert:
  `handle_new_user()` legt in Migration 0048, Zeile 18, weiterhin
  `insert into public.subscriptions (owner_id)` an — Default-Status
  `trialing`, ohne jeden Stripe-Kontakt. Neue Adresse, neuer 14-Tage-Zugang,
  beliebig oft wiederholbar.

Grundlage der ursprünglichen Analyse: Code-Lektüre von
`apps/web/app/signup/page.tsx`, `apps/web/app/layout.tsx`,
`supabase/migrations/0024_billing.sql`, `lib/billing.ts`,
`api/billing/checkout/route.ts` und `api/billing/webhook/route.ts`.

---

## 1. Warum keine Bestätigungsmail kam — die eigentliche Ursache

**Das ist kein Zustellungsproblem.** Der Screenshot zeigt `youtaybusiness@gmail.com` —
genau der Account, mit dem in dieser Sitzung bereits eingeloggt in der App
gearbeitet wurde. Das erklärt beide beobachteten Effekte auf einmal:

- **Sidebar sichtbar hinter der Karte:** `apps/web/app/layout.tsx` prüft
  serverseitig `supabase.auth.getUser()`. War die Session in diesem Browser
  noch gültig, rendert das Layout die volle App-Hülle (Sidebar, Nav) und
  darin erst die Seite `/signup` mit ihrer eigenen "Fast geschafft"-Karte.
  Beides zusammen ergibt exakt das Bild aus dem Screenshot.
- **Keine Mail:** `supabase.auth.signUp()` für eine **bereits registrierte**
  E-Mail-Adresse gibt aus Sicherheitsgründen (Schutz vor
  E-Mail-Enumeration) standardmäßig ein Erfolgs-Objekt ohne Session zurück,
  verschickt dabei aber **keine neue Bestätigungsmail** für einen bereits
  bestätigten Account. Der Code in `signup/page.tsx` kann diesen Fall nicht
  von einem echten Neuanmelde-Fall unterscheiden und zeigt in beiden Fällen
  dieselbe "Postfach prüfen"-Karte.

**Der eigentliche Fehler:** `/signup` (und vermutlich `/login`) prüfen beim
Laden nicht, ob bereits eine gültige Session existiert. Ein eingeloggter
Nutzer, der auf `/signup` landet, sollte sofort auf `/` umgeleitet werden,
statt ein Formular zu sehen, das für ihn gar keinen Sinn ergibt.

### Korrektur (klein, unabhängig von Punkt 2 und 3)

- In `signup/page.tsx` und `login/page.tsx` beim Mount serverseitig oder per
  `useEffect` prüfen: vorhandene Session → `router.replace("/")`.
- Danach **echten** Test wiederholen: komplett ausgeloggt oder in einem
  privaten Fenster, mit einer tatsächlich neuen Adresse.

### Offene Frage, die ich nicht aus dem Code beantworten kann

Ob für einen **wirklich neuen** Nutzer die Mail überhaupt zuverlässig
ankommt, hängt von den Supabase-Auth-Einstellungen ab (eigener SMTP-Anbieter
vs. Supabase-Standardversand, der auf Free/Pro-Tiers stark ratenbegrenzt ist
und für Produktivbetrieb offiziell nicht empfohlen wird). Das steht nicht im
Repo, sondern im Supabase-Dashboard unter Auth → Emails. **Sollte vor jeder
weiteren Änderung einmal mit einer echten neuen Adresse verifiziert werden**,
unabhängig vom Umleitungs-Fix oben.

---

## 2. Ist die Bestätigung überhaupt nötig?

Aktuell rein rhetorisch beantwortbar erst zusammen mit Punkt 3, weil beide
Maßnahmen denselben Zweck verfolgen: verhindern, dass ein Account ohne echte
Identität entsteht.

- **E-Mail-Bestätigung** ist eine schwache, aber kostenlose Hürde. Sie
  verhindert Tippfehler-Adressen und die dümmsten Bot-Anmeldungen, aber
  nicht Mehrfachkonten über `name+1@`, `name+2@` (landet im selben Postfach,
  zählt für Supabase aber als andere Adresse) oder Wegwerf-Mail-Dienste.
- **Zahlungsmittel** (Punkt 3) ist eine deutlich härtere Hürde, aber auch
  reibungsvoller und ein Eingriff in die Architektur.

**Vorschlag:** Bestätigungspflicht vorerst behalten (nachdem der
Weiterleitungs-Fehler aus Punkt 1 behoben ist), nicht als eigenständige
Maßnahme gegen Mehrfachkonten verkaufen, sondern als Basishygiene. Die
eigentliche Antwort auf "mehrere Testaccounts verhindern" ist Punkt 3.

---

## 3. Kreditkarte beim Trial verlangen

### Bewertung: richtiger Instinkt, aber kein kleiner Umbau

Aktuell entsteht der 14-Tage-Trial **rein aus einer Zeile in
`auth.users`** — der Datenbank-Trigger `handle_new_user()`
(`supabase/migrations/0024_billing.sql:62`) legt bei jeder neuen
Registrierung automatisch einen Workspace **und** einen auf `trialing`
gesetzten Subscription-Eintrag an, komplett ohne Stripe-Kontakt. Das Billing
-System (`lib/billing.ts`, `api/billing/checkout/route.ts`) kommt aktuell
nur ins Spiel, wenn ein Nutzer aktiv upgraden will.

**Das heißt konkret: mit einer neuen E-Mail-Adresse lässt sich aktuell ein
unbegrenzt oft wiederholbarer, komplett kostenloser 14-Tage-Zugang
erzeugen.** Der Instinkt ist also richtig und trifft einen echten,
bestehenden Vektor, keine Vermutung.

### Gute Nachricht: die Hälfte der Infrastruktur existiert schon

`api/billing/webhook/route.ts` verarbeitet bereits `checkout.session.completed`
und mappt einen Stripe-Status `trialing` korrekt in die lokale
`subscriptions`-Tabelle. Ein Stripe-verwalteter Trial (Checkout-Session mit
`subscription_data.trial_period_days: 14`, Zahlungsmittel wird erfasst, aber
erst nach Trial-Ende belastet) lässt sich auf dieser Grundlage aufbauen.

### Was sich tatsächlich ändern müsste

1. **Signup-Fluss:** Nach der Kontoerstellung nicht mehr direkt ins
   Dashboard, sondern in eine Stripe-Checkout-Session mit
   `trial_period_days: 14`, ähnlich der bestehenden Logik in
   `api/billing/checkout/route.ts`, nur eben direkt nach Registrierung statt
   erst beim Upgrade.
2. **DB-Trigger anpassen:** `handle_new_user()` darf keinen automatischen
   `trialing`-Subscription-Eintrag mehr anlegen — dieser Status soll erst
   entstehen, wenn der Stripe-Webhook ihn bestätigt, sonst kollidieren zwei
   Quellen der Wahrheit für denselben Zustand.
3. **Zugriff bis zum bestätigten Zahlungsmittel:** Was passiert mit einem
   Account, der die Registrierung abgeschlossen, aber den Checkout
   abgebrochen hat? Braucht einen klar definierten Zwischenzustand
   (`has_active_subscription()` in derselben Migration entscheidet aktuell
   über Suchberechtigung).
4. **Signup-UI:** Formular für Zahlungsmitteldaten (Stripe Elements/Payment
   Element) statt nur E-Mail/Passwort, oder Weiterleitung zu Stripe Checkout
   nach der Kontoerstellung.

### Der Kompromiss, den nur du entscheiden kannst

Kartenpflicht beim Trial ist Branchenstandard bei Produkten mit echten
Grenzkosten und senkt Mehrfachkonten-Missbrauch spürbar — verringert aber
auch nachweislich die Zahl der Leute, die überhaupt einen Trial starten.
Bei BYOK ist der Trial selbst für euch kostenlos (die Nutzer zahlen ihre
eigenen API-Kosten), das Risiko ist also nicht API-Kosten, sondern
entgangener Umsatz durch endlose kostenlose Nutzung. Ob dieser Tausch sich
lohnt, ist eine Geschäftsentscheidung, keine technische.

**Eine mildere Zwischenstufe**, falls volle Kartenpflicht zu viel Reibung
wäre: Stripe Radar/Kartenerkennung kann wiederholte Trials auf derselben
Karte erkennen, ohne dass beim ersten Trial sofort etwas abgebucht wird —
das würde die Architekturänderung aus Punkt 3 trotzdem brauchen, aber ohne
harte Zahlungspflicht am Anfang.

---

## Reihenfolge, falls du zustimmst

1. **Sofort, klein, risikofrei:** Weiterleitungs-Fix für bereits eingeloggte
   Nutzer auf `/signup` und `/login` (Punkt 1).
2. **Vor allem Weiteren:** einmal mit einer echten neuen Adresse testen, ob
   die Bestätigungsmail überhaupt ankommt — das entscheidet, ob zusätzlich
   noch ein SMTP-Problem im Supabase-Dashboard existiert.
3. **Separates Vorhaben, größerer Schnitt:** Kartenpflicht beim Trial
   (Punkt 3), nur nach deiner Entscheidung zum Kompromiss oben.

---

## Nicht umgesetzt

Dieser Plan enthält ausschließlich Analyse und Vorschläge. Es wurde keine
Zeile Code in diesem Repository geändert.
