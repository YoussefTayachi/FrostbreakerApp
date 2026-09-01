"""Pipeline 6: der Website-Befund als eigener Satz.

Macht aus dem ranghoechsten Befund des Website-Checks (businesses.website_audit,
Migration 0102) einen einzelnen, sendbaren Satz und schreibt ihn nach
businesses.website_finding (Migration 0103). Beim Kampagnen-Upload geht er als
eigene Instantly-Variable mit, getrennt von {{personalization}}.

WARUM GETRENNT VOM ICEBREAKER

Bis zum 2026-08-24 wurde der Befund in den Icebreaker-Prompt hineingemischt
(personalize.audit_hint). Das ist zurueckgebaut. Die Gruende stehen im
Modul-Docstring von personalize.py und in Migration 0103; der kuerzeste davon:
workspaces.personalization_prompt ist ein Text, den der Nutzer selbst
geschrieben hat, und ihm unbemerkt eine zweite Aufgabe unterzuschieben aendert
das Verhalten eines Prompts, den er verfasst hat.

LEER IST EIN ERGEBNIS

Nicht jeder Lead hat einen Befund: keine Website hinterlegt, keine Pruefung
schlaegt an, oder die Seite war nicht abrufbar und der Fehlschlag liess sich
nicht bestaetigen (seit dem 2026-08-27 wird aus einer bestaetigten
Unerreichbarkeit dagegen der Befund site_unreachable, siehe
pipelines/confirm_unreachable.py). Dann bleibt website_finding leer, und
dieser Job macht KEINEN Modellaufruf. Es gibt bewusst keinen Rueckfallsatz: ein
erfundener Mangel waere in einer Kaltmail eine falsche Tatsachenbehauptung, und
ein allgemeiner Satz ("deine Website hat sicher Verbesserungspotenzial") ist
genau die Sorte Fuellmasse, die diese Variable ueberfluessig macht.

Dass daraus keine Mail mit einem Loch wird, wird eine Stufe spaeter geloest,
naemlich beim Anlegen der Kampagne: benutzt die Sequenz {{websiteFinding}},
werden Leads ohne Befund zurueckgehalten und gezaehlt, genau wie gesperrte und
ungueltige Adressen (apps/web/lib/instantly/create-campaign.ts), und der
Torwart sagt die Zahl VORHER an (apps/web/lib/campaign-readiness.ts).

WAS DIESE DATEI NICHT SELBST BAUT

Wortgrenze, Verbotsliste, Korrekturrunde und der Modellaufruf sind dieselben
wie beim Icebreaker und werden aus personalize.py wiederverwendet
(constraint_block, validate, sanitize_banned_punctuation, generate). Eine
zweite Fassung davon wuerde bei der naechsten Aenderung an einer Stelle
nachgezogen und an der anderen vergessen.
"""
import logging
from datetime import datetime, timedelta, timezone

from worker import website_audit
from worker.db import sb
from worker.pipelines import personalize
from worker.queue import enqueue
from worker.search_state import (
    BUSINESS_WITH_SEARCH,
    search_filters,
    search_is_deleted,
    search_source,
)

log = logging.getLogger("worker.website_finding")

# Wortgrenze dieses Satzes.
#
# Gegenstueck: FINDING_MAX_WORDS in apps/web/lib/website-finding-defaults.ts.
# Die Pruefliste rechnet damit nach, was hier erzeugt wurde; wer die Zahl nur
# hier aendert, laesst dort Verstoesse auflaufen, die keine sind.
#
# BEWUSST EINE KONSTANTE UND KEINE VIERTE WORKSPACE-EINSTELLUNG. Ein
# Befundsatz ist kuerzer als ein Icebreaker: der Icebreaker braucht einen
# Fakt UND den Anschluss "deswegen melde ich mich" (deshalb dort 35 Woerter,
# siehe personalize.DEFAULT_MAX_WORDS), dieser Satz braucht Mangel und Folge,
# sonst nichts.
#
# Die Zahl ist gesetzt, nicht gemessen: FACT_DE und CONSEQUENCE_DE zusammen
# liegen je nach Code bei 20 bis 35 Woertern, und der Satz soll sie
# zusammenziehen und nicht abschreiben. Wenn sich in der Pruefliste zeigt,
# dass hier reihenweise Verstoesse auflaufen, gehoert sie erhoeht (und der
# Grund daneben), so wie es bei DEFAULT_MAX_WORDS am 2026-08-13 passiert ist.
# Am 2026-08-30 von 20 auf 55 erhoeht. Youssefs Vorgabe: EIN Mangel, dafuer
# in zwei bis drei Saetzen erklaert, warum er ein Problem ist und was er
# fuer Besucher bedeutet. Ein Satz mit 20 Woertern kann die Tatsache
# nennen, die Begruendung passt nicht mehr hinein.
# Am 2026-09-01 verlangt der Prompt nur noch ein bis zwei BESCHREIBENDE
# Saetze (Mentor-Feedback, siehe oben); die 55 bleiben trotzdem stehen,
# weil sie eine Obergrenze sind und ein Absenken jeden schon geschriebenen
# Befund rueckwirkend in die Pruefliste schoebe.
#
# Weiterhin EIN Mangel und nicht drei: {{websiteFinding}} steht in einer
# Sequenz, die Begruessung, Personalisierung und Aufforderung schon
# mitbringt. Drei Absaetze darin erzeugen die doppelte Aufforderung, die
# am 2026-08-26 bei 19 von 20 Leads in der Produktion stand.
FINDING_MAX_WORDS = 55

# Der Standard-Prompt. Getextet vom copywriter am 2026-08-24, wie DEFAULT_PROMPT_DE
# in apps/web/lib/personalization-defaults.ts.
#
# UEBERARBEITET AM 2026-09-01 nach Feedback von Youssefs Mentor: die alte
# Fassung verlangte "Warum das ein Problem ist" und lud damit zu erfundener
# Wirkung ein ("less trustworthy", "reduces confidence" standen woertlich in
# echten Befunden). Neue Regel: nur beschreiben, was gemessen wurde; eine
# Folge nur, wenn das Material sie als sichtbares Besucher-Erlebnis nennt.
#
# WOERTLICHES GEGENSTUECK: DEFAULT_FINDING_PROMPT_DE / _EN in
# apps/web/lib/website-finding-defaults.ts. Der AI-Agent-Tab zeigt diesen Text
# an und speichert ihn als NULL, solange er unveraendert ist; weicht die
# Web-Fassung auch nur um ein Zeichen ab, gilt ein angezeigter Standardtext als
# eigener Prompt und wird gespeichert. Die Gleichheit haelt der Test
# apps/web/lib/website-finding-defaults.test.ts fest, der diese Datei liest.
#
# Zwei Vorgaben stehen absichtlich drin, obwohl sie auch im constraint_block
# stehen koennten: "keine Zahlen erfinden" und "nur diesen einen Mangel". Der
# Block darunter ist eine Formvorgabe, das hier ist der Auftrag. Wer den Prompt
# ueberschreibt, soll die inhaltlichen Grenzen mit uebernehmen koennen.
DEFAULT_FINDING_PROMPT_DE = (
    "Deine Aufgabe ist es, aus einem gemessenen Mangel der Website eines Unternehmens "
    "ein bis zwei Sätze für eine Cold-Email zu formulieren.\n"
    "Aufbau:\n"
    "1. Was auf der Website der Fall ist.\n"
    "2. Nur wenn das Material eine sichtbare Folge nennt: was ein Besucher dadurch "
    "sieht oder tun muss.\n"
    "Regeln:\n"
    "- Beschreibe ausschließlich, was gefunden wurde. Erfinde KEINE Wirkung dazu: "
    "keine Aussagen über Vertrauen, Glaubwürdigkeit, Interesse oder Eindruck, und "
    "keine Vorhersage, was Besucher denken, fühlen oder als Nächstes tun.\n"
    "- Nenne nur den einen Mangel, der dir übergeben wurde. Erfinde keinen zweiten "
    "Mangel, keine Zahlen und keine Prozentwerte.\n"
    "- Behaupte NICHT, was es kostet. Keine Aussagen über entgangenen Umsatz, "
    "verlorene Kunden, Conversion oder Ranking: das kann niemand belegen, und der "
    "Empfänger merkt es.\n"
    "- Der Mangel ist gemessen, nicht vermutet: Schreibe ihn als Tatsache, ohne "
    "Abschwächung wie „vielleicht\" oder „unter Umständen\".\n"
    "- Erwähne NICHT, woher du das weißt: kein „Ich habe gesehen\", kein „Mir ist "
    "aufgefallen\", kein Werkzeug, kein Test, keine Prüfung. Nenne einfach den Mangel.\n"
    "- Baue KEINEN Namen, keine Begrüßung und keine Verabschiedung ein.\n"
    "- Beschreibe oder verkaufe deine eigene Leistung NICHT. Der Text benennt das "
    "Problem, nicht die Lösung.\n"
    "- Tonfall: ruhig, respektvoll und sachlich. Kein Vorwurf, keine Dramatik, kein "
    "Alarm. Du schreibst jemandem, der an dieser Website gearbeitet hat.\n"
    "- Schreibe in der „Du\"-Form, nicht in der „Sie\"-Form.\n"
    "- Der Text wird an einer beliebigen Stelle in die Mail eingesetzt und muss dort "
    "für sich allein stehen: er beginnt mit einem Großbuchstaben und endet mit einem "
    "Punkt. Ein Absatz, keine Aufzählung, keine Zwischenüberschrift.\n\n"
    "Schreibe standardmäßig auf Deutsch, außer diese Vorgaben verlangen hier "
    "ausdrücklich eine andere Sprache."
)

# Inhaltsgleich zu DEFAULT_FINDING_PROMPT_DE, nur auf Englisch.
DEFAULT_FINDING_PROMPT_EN = (
    "Your task is to turn one measured flaw on a company's website into one or two "
    "sentences for a cold email.\n"
    "Structure:\n"
    "1. What is the case on the website.\n"
    "2. Only if the material names a visible effect: what a visitor sees or has to "
    "do because of it.\n"
    "Rules:\n"
    "- Describe only what was found. Do NOT invent an effect on top: no claims about "
    "trust, credibility, interest or impression, and no prediction of what visitors "
    "will think, feel or do next.\n"
    "- Name only the one flaw you were given. Do not invent a second flaw, any "
    "numbers or any percentages.\n"
    "- Do NOT claim what it costs. No lost revenue, no lost customers, no conversion "
    "or ranking claims: nobody can back those up and the reader notices.\n"
    "- The flaw was measured, not guessed: state it as a fact, without hedging like "
    "\"maybe\" or \"possibly\".\n"
    "- Do NOT mention how you know: no \"I saw\", no \"I noticed\", no tool, no test, "
    "no audit. Just state the flaw.\n"
    "- Do NOT include any name, greeting or sign-off.\n"
    "- Do NOT describe or pitch your own service. The text names the problem, not "
    "the solution.\n"
    "- Tone: calm, respectful and plain. No blame, no drama, no alarm. You are "
    "writing to someone who worked on this website.\n"
    "- Always write in the informal \"you\" form.\n"
    "- The text is dropped into the email at an arbitrary position and has to "
    "stand on its own there: it starts with a capital letter and ends with a full "
    "stop. One paragraph, no bullet points, no heading.\n\n"
    "Write in English by default, unless these instructions explicitly require "
    "another language."
)


def default_prompt(language: str) -> str:
    return DEFAULT_FINDING_PROMPT_EN if language == "en" else DEFAULT_FINDING_PROMPT_DE


# Wie lange auf einen noch laufenden Website-Check gewartet wird, gerechnet ab
# businesses.created_at.
#
# Stand bis zum 2026-08-24 in personalize.py und ist mit dem Rueckbau
# hierher gewandert: gewartet wird nur noch dort, wo der Befund tatsaechlich
# gebraucht wird. Der Text darunter ist unveraendert.
#
# GESETZTE GRENZE, KEIN MESSWERT. Sie beantwortet eine einzige Frage: was
# passiert, wenn der check_website-Job nie fertig wird (Worker abgestuerzt,
# Status haengt dauerhaft auf 'pending')? Ohne Deckel bekaeme dieser Lead nie
# einen Satz.
#
# DIE ZAHL HAENGT AM RETRY-BUDGET DER QUEUE, nicht an der Dauer des Checks.
# Ein wartender Job hat genau drei Laeufe: sofort, nach 60 Sekunden und nach
# weiteren 240 (queue.fail_job, max_attempts = 3, Backoff 60 * attempts^2).
# Danach steht er endgueltig auf 'failed'. Ein Deckel von einer halben Stunde
# waere deshalb wirkungslos gewesen: der Job waere lange vorher aufgegeben
# worden, und das Warten haette genau das erzeugt, was es verhindern soll.
# Vier Minuten sind kleiner als diese fuenf, der letzte Versuch laeuft also
# verlaesslich durch, notfalls ohne Befund.
#
# Dass dabei ein Befund verlorengehen koennte, ist unwahrscheinlich: die
# check_website-Jobs einer Liste werden VOR den Folge-Jobs eingereiht
# (get_businesses._queue_website_audits) und claim_job arbeitet nach run_at,
# holt sie also auch zuerst.
#
# Die Fehlerrichtung ist bewusst diese: lieber ein Lead ohne Befundsatz als
# eine Lead-Liste, die stehen bleibt.
AUDIT_WAIT_LIMIT = timedelta(minutes=4)


def _created_at(biz: dict) -> datetime | None:
    """businesses.created_at als datetime, oder None wenn unlesbar."""
    raw = biz.get("created_at")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        # PostgREST liefert "+00:00"; das "Z"-Format kann fromisoformat erst
        # ab Python 3.11, und dieses Paket erlaubt 3.10.
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


# Zustaende der Browser-Stufe, nach denen nichts mehr kommt. Gewartet wird
# auf einen davon und nicht auf eine Uhrzeit: eine Messung mit zwei Viewports
# dauert je nach Seite Sekunden bis zu einer halben Minute, ein festes Fenster
# waere entweder zu kurz oder verschenkte Zeit.
BROWSER_TERMINAL = ("completed", "inconclusive", "skipped", "failed")


def stages_open(biz: dict) -> bool:
    """Laeuft eine der beiden Check-Stufen noch? Ohne Ruecksicht auf den Deckel.

    Von audit_pending getrennt, seit run() den Unterschied braucht: "noch
    offen und innerhalb des Deckels" heisst warten, "noch offen und Deckel
    abgelaufen" heisst schreiben UND markieren (Migration 0109), damit
    browser_check den Satz nach seiner Messung nachziehen kann.
    """
    html_laeuft = biz.get("website_audit_status") == "pending"
    browser_laeuft = bool(biz.get("browser_audit_required")) and (
        biz.get("website_audit_browser_status") not in BROWSER_TERMINAL
    )
    return html_laeuft or browser_laeuft


def audit_pending(biz: dict) -> bool:
    """Laeuft eine der beiden Check-Stufen fuer diese Firma noch?

    'pending' setzt bei der HTML-Stufe ausschliesslich
    get_businesses._queue_website_audits, und zwar genau fuer die Firmen, fuer
    die es auch einen Job einreiht. Steht der Status auf null, obwohl eine
    Website hinterlegt ist (Zeilen aus der Zeit vor Migration 0102, von Hand
    angelegte Firmen), wird deshalb NICHT gewartet: es prueft ja niemand.

    SEIT MIGRATION 0107 GILT DASSELBE FUER DIE ZWEITE STUFE, und das ist keine
    Kosmetik. Wartete dieser Job nur auf die HTML-Stufe, schriebe er seinen
    Satz, sobald die schnellere von beiden fertig ist. Der Idempotenz-Schutz
    in run() (`if biz.get("website_finding") and not force`) sorgte dann
    dafuer, dass er nie wieder nachbessert: die Browser-Messung kaeme an,
    wuerde gespeichert, und ihr Befund stuende in keiner einzigen Mail.
    Gefunden beim Gegenlesen des Plans durch ein zweites Modell, bevor eine
    Zeile Code stand.

    Gewartet wird nur, wenn `browser_audit_required` gesetzt ist. Sonst waeren
    eine alte Zeile ohne Browser-Stufe und ein Lead ohne pruefbare Adresse von
    einer laufenden Messung nicht zu unterscheiden.
    """
    if not stages_open(biz):
        return False
    created = _created_at(biz)
    if created is None:
        return True
    # Die Notbremse bleibt: geht ein Job verloren, bekaeme dieser Lead sonst
    # nie einen Satz. Sie ist die Ausnahme, der Endzustand ist die Regel.
    return datetime.now(timezone.utc) - created < AUDIT_WAIT_LIMIT


def finding_context(biz: dict) -> str | None:
    """Das Material fuer den Prompt: EIN Befund, seine Tatsache und seine Folge.

    Warum genau einer und nicht alle: siehe website_audit.top_finding. Der
    Befund kommt beschriftet und nicht als fertiger Satz ins Modell, damit
    erkennbar bleibt, was gemessen wurde (Tatsache, Beleg) und was daraus
    folgt; der Beleg ist ein woertliches Zitat von der Seite und soll
    nachschlagbar sein, nicht formuliert.

    Liefert None, wenn es nichts zu sagen gibt. Das ist der HAEUFIGE Fall und
    kein Fehler, siehe Modul-Docstring.
    """
    # Beide Stufen zusammen. Der Browser nimmt Befunde weg, die er widerlegt,
    # und legt seine eigenen dazu; ohne ihn verhaelt sich das wie frueher.
    finding = website_audit.top_finding(
        biz.get("website_audit"), biz.get("website_audit_browser")
    )
    if not finding:
        return None
    code = finding["code"]
    fact = website_audit.FACT_DE.get(code)
    consequence = website_audit.CONSEQUENCE_DE.get(code)
    if not fact or not consequence:
        # Code ohne hinterlegten Text: lieber kein Satz als ein halber.
        log.warning("Befund %s hat keinen hinterlegten Text, uebersprungen", code)
        return None
    lines = [f"Gemessener Mangel: {fact}"]
    evidence = (finding.get("evidence") or "").strip()
    if evidence:
        lines.append(f"Wörtlich auf der Seite gefunden: {evidence}")
    # Seit dem 2026-09-01 heisst die Zeile nicht mehr "Folge für das
    # Unternehmen": das Etikett lud das Modell ein, eine Geschaeftswirkung
    # dazuzuerfinden. CONSEQUENCE_DE ist seitdem auf sichtbares
    # Besucher-Erlebnis beschnitten, und das Etikett sagt genau das.
    lines.append(f"Was ein Besucher dadurch sieht oder tun muss: {consequence}")
    return "\n".join(lines)


def load_config(workspace_id: str) -> dict:
    """Die geltenden Vorgaben fuer diesen Satz.

    Prompt: eigene Spalte (workspaces.website_finding_prompt, Migration 0103).
    Sprache und verbotene Zeichen: die des Workspaces, also dieselben wie beim
    Icebreaker. Beide Saetze stehen in derselben Mail; zwei Sprachen darin
    waeren ein Fehler, und ein Gedankenstrich ist in beiden dasselbe
    Erkennungszeichen fuer Maschinentext.
    """
    row = (
        sb()
        .table("workspaces")
        .select("website_finding_prompt, personalization_banned_words, personalization_language")
        .eq("id", workspace_id)
        .single()
        .execute()
        .data
        or {}
    )
    banned_raw = row.get("personalization_banned_words")
    banned_words = (
        [w for w in (x.strip() for x in banned_raw.split(",")) if w]
        if banned_raw
        else list(personalize.DEFAULT_BANNED_WORDS)
    )
    language = row.get("personalization_language") or personalize.DEFAULT_LANGUAGE
    if language not in personalize.VALID_LANGUAGES:
        language = personalize.DEFAULT_LANGUAGE
    return {
        "system_prompt": (row.get("website_finding_prompt") or "").strip()
        or default_prompt(language),
        "banned_words": banned_words,
        "language": language,
    }


def run(job: dict) -> None:
    from worker.keys import get_api_key  # lokaler Import, haelt Testabhaengigkeiten schlank

    ws = job["workspace_id"]
    business_id = job["payload"]["business_id"]
    # force=true kommt aus einem "neu erzeugen"-Handgriff, gleiche Bedeutung
    # wie in personalize.run.
    force = bool(job["payload"].get("force"))
    biz = sb().table("businesses").select(BUSINESS_WITH_SEARCH).eq("id", business_id).single().execute().data
    if biz.get("website_finding") and not force:
        # Schutz gegen doppeltes Bezahlen, wenn ein Job ein zweites Mal
        # ankommt (Neustart des Workers, wiederholte Zustellung).
        return
    if search_is_deleted(biz):
        return  # Suche im Papierkorb, keine OpenAI-Kosten fuer unsichtbare Leads

    offen = stages_open(biz)
    if offen and audit_pending(biz):
        # Gleiches Muster wie bei der noch laufenden company_summary in
        # personalize: der Job geht ueber fail_job mit Backoff zurueck in die
        # Queue. Der Deckel in audit_pending sorgt dafuer, dass daraus keine
        # Endlosschleife wird.
        raise personalize.NotReadyYet("Website-Check laeuft noch")
    # Ab hier gilt: entweder sind beide Stufen fertig, oder der Deckel ist
    # abgelaufen und es wird aus dem geschrieben, was da ist. Der zweite Fall
    # wird unten als pending_rewrite markiert; browser_check reiht nach der
    # Messung einen force-Nachtrag ein (Migration 0109). Am 2026-08-31 waren
    # 139 von 240 Saetzen in diesem Zustand und mussten von Hand nachgezogen
    # werden.

    context = finding_context(biz)
    if context is None:
        # Kein Befund. KEIN Modellaufruf, kein Schreibvorgang, kein Retry:
        # das Feld bleibt leer, und leer ist hier die richtige Antwort.
        #
        # AUSNAHME force mit vorhandenem Satz: der Nachtrag hat festgestellt,
        # dass der kombinierte Befund inzwischen leer ist, der alte Satz
        # stuetzte sich also auf etwas, das die Browser-Messung widerlegt
        # hat. Stehen lassen hiesse: die Mail behauptet einen Mangel, den es
        # nicht gibt. Genau dafuer wurde die zweite Stufe gebaut.
        if force and (biz.get("website_finding") or "").strip():
            sb().table("businesses").update(
                {
                    "website_finding": None,
                    "website_finding_needs_review": False,
                    "website_finding_pending_rewrite": False,
                }
            ).eq("id", business_id).execute()
        return

    cfg = load_config(ws)
    api_key = get_api_key(ws, "openai")
    search_id = biz.get("search_id")
    system_prompt = cfg["system_prompt"] + personalize.constraint_block(
        FINDING_MAX_WORDS, cfg["banned_words"], cfg["language"], subject="sentence"
    )

    def write_line(correction: str | None = None) -> str:
        # Ohne examples: personalization_examples sind handgeschriebene
        # Icebreaker und wuerden dem Modell hier das falsche Muster beibringen.
        return personalize.generate(
            biz["name"], context, api_key, system_prompt,
            correction=correction, workspace_id=ws, search_id=search_id,
            operation="website_finding",
        )

    line = write_line()
    problems = personalize.validate(line, FINDING_MAX_WORDS, cfg["banned_words"])
    needs_review = False
    if problems:
        line = write_line(correction="; ".join(problems))
        line = personalize.sanitize_banned_punctuation(line, cfg["banned_words"])
        needs_review = bool(personalize.validate(line, FINDING_MAX_WORDS, cfg["banned_words"]))

    sb().table("businesses").update(
        {
            "website_finding": line,
            "website_finding_needs_review": needs_review,
            # True genau dann, wenn der Deckel abgelaufen war und eine Stufe
            # noch lief: das Signal an browser_check, den Satz nach der
            # Messung mit force nachzuziehen. Beim Nachtrag selbst sind die
            # Stufen fertig, offen ist False, die Markierung verschwindet.
            "website_finding_pending_rewrite": offen,
        }
    ).eq("id", business_id).execute()

    if not force:
        # Nur beim ERSTEN Satz, nie beim Nachtrag: find_decisionmaker hat
        # keinen eigenen Doppel-Schutz, ein zweites Einreihen kostet einen
        # zweiten Recherche-Lauf.
        _reihe_anreicherung_ein(ws, biz)


def _reihe_anreicherung_ein(ws: str, biz: dict) -> None:
    """Recherche und Icebreaker erst NACH einem Befund einreihen.

    Nur fuer Suchen mit filters.research_after_finding (gesetzt beim Anlegen,
    siehe get_businesses._finish). Der Grund ist eine Messung vom 2026-08-31:
    die Recherche kostet je Firma 50 bis 60 Sekunden und ~0,003 USD und ist
    damit die teuerste Stufe der ganzen Pipeline, aber rund 40 Prozent der
    Firmen bekommen nie einen Befund und damit nie eine Mail. Fuer eine
    Website-Kampagne ist ihre Recherche verlorenes Geld.

    Kommt dieser Job zweimal gleichzeitig hierher (Original und Nachtrag im
    selben Augenblick), kann die Recherche doppelt eingereiht werden. Das
    kostet dann einen zweiten Modellaufruf und nichts weiter: doppelte
    Kontakte verhindert find_decisionmaker selbst.
    """
    filters = search_filters(biz)
    if not filters.get("research_after_finding"):
        return
    if biz.get("decisionmaker_status") != "pending":
        return
    # Dieselbe Zuordnung wie in get_businesses._finish: corporate holt die
    # Adresse bei Hunter, alles andere ueber die KI-Websuche.
    jobtyp = "hunt_persons" if search_source(biz) == "corporate" else "find_decisionmaker"
    enqueue(ws, jobtyp, {"business_id": biz["id"]})
    if not filters.get("skip_personalize"):
        enqueue(ws, "personalize", {"business_id": biz["id"]})
