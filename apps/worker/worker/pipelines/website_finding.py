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
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted

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
FINDING_MAX_WORDS = 20

# Der Standard-Prompt. Getextet vom copywriter am 2026-08-24, wie DEFAULT_PROMPT_DE
# in apps/web/lib/personalization-defaults.ts.
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
    "Deine Aufgabe ist es, aus einem geprüften Mangel der Website eines Unternehmens "
    "einen einzelnen Satz für eine Cold-Email zu formulieren.\n"
    "Regeln für den Satz:\n"
    "- Nenne ausschließlich den einen Mangel, der dir übergeben wurde, und die "
    "dazugehörige Folge. Erfinde keinen zweiten Mangel, keine Zahlen und keine "
    "Prozentwerte.\n"
    "- Der Mangel ist gemessen, nicht vermutet: Schreibe ihn als Tatsache, ohne "
    "Abschwächung wie „vielleicht\" oder „unter Umständen\".\n"
    "- Erwähne NICHT, woher du das weißt: kein „Ich habe gesehen\", kein „Mir ist "
    "aufgefallen\", kein Werkzeug, kein Test, keine Prüfung. Nenne einfach den Mangel.\n"
    "- Baue KEINEN Namen, keine Begrüßung und keine Verabschiedung ein.\n"
    "- Beschreibe oder verkaufe deine eigene Leistung NICHT. Der Satz benennt das "
    "Problem, nicht die Lösung.\n"
    "- Tonfall: sachlich, direkt und ohne Fachjargon, aber ohne Dramatik, Vorwurf "
    "oder Alarm.\n"
    "- Schreibe in der „Du\"-Form, nicht in der „Sie\"-Form.\n"
    "- Der Satz wird an einer beliebigen Stelle in die Mail eingesetzt und muss dort "
    "für sich allein stehen: er beginnt mit einem Großbuchstaben und endet mit einem "
    "Punkt.\n\n"
    "Schreibe standardmäßig auf Deutsch, außer diese Vorgaben verlangen hier "
    "ausdrücklich eine andere Sprache."
)

# Inhaltsgleich zu DEFAULT_FINDING_PROMPT_DE, nur auf Englisch.
DEFAULT_FINDING_PROMPT_EN = (
    "Your task is to turn one verified flaw on a company's website into a single "
    "sentence for a cold email.\n"
    "Rules for the sentence:\n"
    "- Name only the one flaw you were given and its stated consequence. Do not "
    "invent a second flaw, any numbers or any percentages.\n"
    "- The flaw was measured, not guessed: state it as a fact, without hedging like "
    "\"maybe\" or \"possibly\".\n"
    "- Do NOT mention how you know: no \"I saw\", no \"I noticed\", no tool, no test, "
    "no audit. Just state the flaw.\n"
    "- Do NOT include any name, greeting or sign-off.\n"
    "- Do NOT describe or pitch your own service. The sentence names the problem, not "
    "the solution.\n"
    "- Tone: plain, direct and free of jargon, but without drama, blame or alarm.\n"
    "- Always write in the informal \"you\" form.\n"
    "- The sentence is dropped into the email at an arbitrary position and has to "
    "stand on its own there: it starts with a capital letter and ends with a full "
    "stop.\n\n"
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


def audit_pending(biz: dict) -> bool:
    """Laeuft der Website-Check fuer diese Firma noch?

    'pending' setzt ausschliesslich get_businesses._queue_website_audits, und
    zwar genau fuer die Firmen, fuer die es auch einen Job einreiht. Steht der
    Status auf null, obwohl eine Website hinterlegt ist (Zeilen aus der Zeit
    vor Migration 0102, von Hand angelegte Firmen), wird deshalb NICHT
    gewartet: es prueft ja niemand.
    """
    if biz.get("website_audit_status") != "pending":
        return False
    created = _created_at(biz)
    if created is None:
        return True
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
    finding = website_audit.top_finding(biz.get("website_audit"))
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
    lines.append(f"Folge für das Unternehmen: {consequence}")
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

    if audit_pending(biz):
        # Gleiches Muster wie bei der noch laufenden company_summary in
        # personalize: der Job geht ueber fail_job mit Backoff zurueck in die
        # Queue. Der Deckel in audit_pending sorgt dafuer, dass daraus keine
        # Endlosschleife wird.
        raise personalize.NotReadyYet("Website-Check laeuft noch")

    context = finding_context(biz)
    if context is None:
        # Kein Befund. KEIN Modellaufruf, kein Schreibvorgang, kein Retry:
        # das Feld bleibt leer, und leer ist hier die richtige Antwort.
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
        {"website_finding": line, "website_finding_needs_review": needs_review}
    ).eq("id", business_id).execute()
