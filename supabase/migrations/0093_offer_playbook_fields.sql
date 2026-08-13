-- Das Angebot bekommt die Felder, die das Playbook verlangt.
--
-- WOHER DIESE FELDER KOMMEN
--
-- Aus dem Verkaufs-Wissen des Betreibers (zwei Kurse: "Offer Blueprint" und
-- "Outreach Engine"). Deren Kern ist die Trennung von "Email X" -- dem festen
-- Skelett einer Nachricht, gleich fuer alle Empfaenger -- und "Variable Y" --
-- den Feldern, die sich unterscheiden.
--
-- Die entscheidende Anpassung an diese App: Im Kurs ist Variable Y PRO LEAD
-- (ein Rechercheur sieht sich jede Website an und findet dort den einen
-- Stolperstein). Frostbreaker-Nutzer verkaufen aber Beliebiges an Beliebige,
-- und eine Recherche je Lead kostet einen zusaetzlichen Modellaufruf pro
-- Kontakt. Deshalb wandert Variable Y dorthin, wo sie sich NICHT je Lead
-- aendert: ins Angebot. Der Nutzer traegt den Stolperstein SEINER NISCHE
-- einmal ein, THAW schreibt daraus die ganze Nachricht.
--
-- Was pro Lead verschieden bleibt, ist unveraendert der Aufhaenger
-- ({{personalization}}, personalize.py) plus die Merge-Tags von Instantly.
-- Damit ist die erste Mail sogar staerker personalisiert als im Kurs: dort
-- traegt die Beobachtung allein, hier steht ein recherchierter Satz zur
-- konkreten Firma davor.
--
-- WARUM GENAU DIESE FUENF UND NICHT MEHR
--
-- Das Playbook kennt weitere Bausteine (Scope-Grenzen, Preis-Hebel). Die
-- gehoeren ins Verkaufsgespraech, nicht in eine Kaltmail -- sie stehen in
-- keiner der vier Mailstufen. Sie hier aufzunehmen hiesse, das Formular um
-- Felder zu verlaengern, die der Generator nie liest.
--
-- WAS SICH AN cta AENDERT (ohne Schemaaenderung)
--
-- cta war "Was soll der Empfaenger tun?". Das Playbook ist an dieser Stelle
-- deutlich strenger: es muss ein MICRO-YES sein -- eine einzige binaere
-- Ja/Nein-Frage. Kein Termin, kein Kalenderlink, kein "hast du Zeit", keine
-- zweite Option. Begruendung aus dem Kurs: ein Terminwunsch ist die groesste
-- Bitte, die man in einer Erstmail stellen kann, und sie wird deshalb am
-- haeufigsten ignoriert. Die Spalte bleibt, ihre Bedeutung wird geschaerft --
-- Beschriftung, Prompt und Pruefung ziehen nach.

alter table public.offers
  -- [WEBSITE_PROBLEM] im Kurs. Der EINE Punkt, an dem der Kaeufer haengen
  -- bleibt, kurz bevor er Geld ausgeben wuerde. Nicht "die Website ist alt",
  -- sondern der Stolperstein, den der Inhaber selbst nachpruefen kann.
  add column friction text not null default '',

  -- [RECOGNIZABLE_REASON]. Warum dieser Stolperstein Kaeufer zoegern laesst --
  -- als BEOBACHTETES VERHALTEN, nicht als Theorie und nicht als Vorwurf. Der
  -- Kurs nennt das den Unterschied zwischen "jemand, der Ablaeufe repariert"
  -- und "jemand, der Marken kritisiert".
  add column friction_reason text not null default '',

  -- Wie das Ergebnis entsteht -- ohne Tool-Sprache. Der Kurs verbietet an
  -- dieser Stelle ausdruecklich "KI", "Agent", "LLM", "API" und Produktnamen:
  -- der Kaeufer kauft kein Werkzeug, sondern ein Ergebnis. Steht NICHT in der
  -- ersten Mail (dort hat der Mechanismus nichts verloren), sondern traegt die
  -- Antwort nach einem Ja.
  add column mechanism text not null default '',

  -- [PREVIEW_ASSET_EXISTS]. Das kleine, konkrete Etwas, das der Empfaenger
  -- bekommt, wenn er Ja sagt -- und das erst DANACH gebaut wird. Sichtbar und
  -- greifbar; klingt es wie ein Foliensatz, taugt es nicht.
  add column preview_asset text not null default '',

  -- [REVIEW_TIME]. Wie lange das Ansehen dauert, als exakte Angabe. Der Kurs
  -- nennt es die Drei-Minuten-Glaubwuerdigkeitsregel: je kleiner der
  -- angebotene Umfang, desto glaubhafter die Zeitangabe.
  add column review_time text not null default '';

comment on column public.offers.friction is
  'Der EINE Stolperstein der Nische, kurz vor dem Geld. Traegt die Beobachtung in Mail 1 und bleibt ueber alle vier Stufen derselbe -- eine neue Friction je Follow-up ist der haeufigste Fehler des ganzen Playbooks.';

comment on column public.offers.friction_reason is
  'Warum dieser Stolperstein Kaeufer zoegern laesst. Beobachtetes Verhalten, keine Theorie, kein Vorwurf.';

comment on column public.offers.mechanism is
  'Wie das Ergebnis entsteht, ohne Tool-Sprache (kein "KI", "Agent", "API", keine Produktnamen). Gehoert NICHT in die erste Mail, sondern in die Antwort nach einem Ja.';

comment on column public.offers.preview_asset is
  'Was der Empfaenger bekommt, wenn er Ja sagt. Wird erst nach dem Ja gebaut. Leer = der Generator verspricht nichts und bittet nur um eine Antwort.';

comment on column public.offers.review_time is
  'Exakte Pruefzeit fuer preview_asset ("90 Sekunden", "3 Minuten"). Leer = keine Zeitzusage, statt einer erfundenen.';

comment on column public.offers.cta is
  'Der MICRO-YES: eine einzige binaere Ja/Nein-Frage. Kein Termin, kein Kalenderlink, keine zweite Option -- und ueber alle vier Stufen wortgleich wiederholt. Leer = der Generator bittet um eine schlichte Antwort.';
