-- Der Befund ueber den MENSCHEN, nicht ueber die Firma.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WAS HIER FEHLTE
-- ═══════════════════════════════════════════════════════════════════════
--
-- Frostbreaker kennt zwei personalisierte Texte, und beide beschreiben ein
-- Unternehmen: {{personalization}} (businesses.personalization, aus der
-- Firmenbeschreibung) und {{websiteFinding}} (businesses.website_finding, aus
-- dem Website-Check). Angeschrieben wird aber nie ein Unternehmen, sondern
-- ein Entscheidungstraeger.
--
-- Gemessen am 2026-09-22 an 160 erzeugten Aufhaengern eines echten
-- Workspaces: 158 davon endeten mit einer von elf Bruecken, 52 allein mit
-- "that's why I wanted to connect". Der Grund ist nicht der Prompt, sondern
-- das Material: aus einer Firmenbeschreibung entsteht ueber tausend Leads
-- hinweg zwangslaeufig derselbe Satz, weil About-Seiten einander gleichen.
--
-- Ein Mensch hat dagegen etwas, was eine About-Seite nicht hat: er sagt
-- oeffentlich Dinge, und zwar freiwillig und datiert.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM AUF contacts UND NICHT AUF businesses
-- ═══════════════════════════════════════════════════════════════════════
--
-- Weil der Text sonst fuer die zweite Person derselben Firma falsch waere.
-- Gemessen: 689 von 4433 Firmen mit Kontakt (15,5 Prozent) haben mehr als
-- einen, eine davon 25. Eine firmenweite Zeile kann per Konstruktion nicht
-- personenbezogen sein, egal wie gut sie geschrieben ist.
--
-- contacts.personalization (aus Migration 0001) wird bewusst NICHT dafuer
-- benutzt. Die Spalte ist seit dem ersten Tag da und wird von niemandem
-- gelesen oder geschrieben; sie waere der naheliegende Platz, aber sie meint
-- etwas anderes (einen Aufhaenger) als dieser Text (einen ganzen Absatz mit
-- Herkunft, Meinung und Ueberleitung). Zwei Bedeutungen in einer Spalte sind
-- der Anfang jeder spaeteren Verwechslung.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WARUM DIESER TEXT SEINE QUELLE NENNT UND DIE ANDEREN BEIDEN NICHT
-- ═══════════════════════════════════════════════════════════════════════
--
-- Der Icebreaker-Prompt verbietet ausdruecklich "I saw", "I noticed" und
-- jeden Hinweis auf die Recherche. Das ist dort richtig: eine Tatsache ueber
-- eine Firma steht auf ihrer Website, und zu sagen, dass man sie dort gelesen
-- hat, ist Fuellmasse.
--
-- Bei einem Menschen kehrt sich das um. "Du hast letzten Monat geschrieben,
-- dass X" ist nachpruefbar und hoeflich. Derselbe Satz ohne Herkunft, also
-- blosses "X beschaeftigt dich gerade", ist die unangenehmere Variante: der
-- Empfaenger weiss dann nicht, woher es kommt, und das ist genau der Moment,
-- in dem Personalisierung von geschmeichelt nach beobachtet kippt.
--
-- ═══════════════════════════════════════════════════════════════════════
-- LEER IST EIN ERGEBNIS
-- ═══════════════════════════════════════════════════════════════════════
--
-- Dieselbe Regel wie bei website_finding (0103): wer nichts oeffentlich
-- gesagt hat, bekommt keinen erfundenen Absatz. Der Status haelt fest,
-- WARUM leer ist, damit "nicht recherchiert" und "recherchiert, nichts
-- gefunden" unterscheidbar bleiben. Ohne diesen Unterschied wuerde jeder
-- Nachlauf alle leeren Zeilen erneut durch eine bezahlte Websuche schicken.
alter table public.contacts
  add column person_finding text,
  add column person_finding_needs_review boolean not null default false,
  add column person_finding_status text
    check (person_finding_status in ('pending', 'running', 'found', 'none', 'failed'));

comment on column public.contacts.person_finding is
  'Absatz ueber die Person selbst, aus oeffentlichen Aeusserungen. Geht als {{personFinding}} an Instantly.';
comment on column public.contacts.person_finding_status is
  'null = nie angefragt, none = recherchiert und nichts Brauchbares gefunden.';

-- Der Zugriffsweg des Nachlaufs: "welche Kontakte dieses Workspaces haben
-- noch keinen Befund". Ohne Index liest er die ganze Tabelle.
create index contacts_person_finding_todo_idx
  on public.contacts (workspace_id, person_finding_status)
  where person_finding is null;

-- Der neue Jobtyp. Zwei Nutzlasten, siehe worker/pipelines/person_finding.py:
-- mit business_id faechert er auf, mit contact_id recherchiert er.
alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs
  add constraint jobs_type_check check (type in (
    'get_businesses',
    'find_decisionmaker',
    'hunt_persons',
    'personalize',
    'check_website',
    'browser_check',
    'write_website_finding',
    'confirm_website_unreachable',
    'write_person_finding',
    'sync_sent',
    'send_batch',
    'poll_inbox',
    'poll_instantly'
  ));
