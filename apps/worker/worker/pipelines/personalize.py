"""Pipeline 4: KI-Personalisierung / Icebreaker.

Generiert die personalisierte Eroeffnungszeile ({{personalization}}-Variable)
fuer die Akquise-Mail. Nutzt je nach Workspace-Einstellung (personalization_source)
entweder die vom find_decisionmaker-Job recherchierte Firmenbeschreibung
(businesses.company_summary), den gecrawlten Website-Text, oder beides.

Unabhaengig von dieser Wahl haengt build_context ein Zusatzsignal an: entweder
den ranghoechsten Befund des Website-Checks (audit_hint, Migration 0102) oder,
wenn es keinen gibt, den bisherigen pain_point_hint. Bewusst als Ergaenzung und
nicht als vierte personalization_source: so wirkt der Befund fuer alle Quellen,
ohne Migration am Quellen-Enum und ohne Aenderung an der Oberflaeche.

Der System-Prompt ist vollstaendig ueberschreibbar (workspaces.personalization_prompt);
ohne eigene Vorgabe gilt DEFAULT_PROMPT. Wortzahl und verbotene Woerter werden nach
der Generierung geprueft; bei Verstoss gibt es genau einen Korrektur-Versuch mit
Hinweis auf das Problem. Schlaegt auch der zweite Versuch fehl, wird das Ergebnis
trotzdem gespeichert, aber als personalization_needs_review markiert.

EIN MODELL, EIN WEG

Am 2026-08-22 gab es hier kurzzeitig einen zweiten Anbieter (Claude), noch am
selben Tag wieder entfallen: wer Claude will, verbindet sein eigenes Abo ueber
den MCP-Server, statt zusaetzlich einen API-Schluessel zu bezahlen. Die
hinterlegten Beispiel-Paare (personalization_examples) sind geblieben und
wirken jetzt auf den OpenAI-Pfad, siehe generate().

Die Spalte workspaces.personalization_model (Migration 0097) bleibt absichtlich
in der Datenbank stehen und wird ab dem 2026-08-22 von niemandem mehr gelesen.
Sie zu entfernen waere eine Migration, die eine Spalte ohne Daten (0 Zeilen auf
'claude', gemessen am 2026-08-22) gegen ein Rueckbau-Risiko eintauscht.
Dasselbe gilt fuer den Wert 'anthropic' in den CHECK-Constraints von api_keys
und api_usage.
"""
import re
from datetime import datetime, timedelta, timezone

import httpx
import trafilatura
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from worker import usage, website_audit, website_fetch
from worker.db import sb
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted

MODEL = "gpt-4.1-mini"

MAX_SITE_CHARS = 6000

# Wie viele Beispiel-Paare hoechstens in den Prompt gehen.
#
# Die Zahl ist eine Kostengrenze, keine Qualitaetsgrenze: der Beispielblock
# steht in JEDER Anfrage fuer JEDEN Lead. Ein Beispiel traegt den Kontexttext
# einer Firma, in der Praxis ein paar tausend Zeichen; zehn davon landen grob
# im Bereich 5.000 bis 10.000 Tokens Vorspann. Gecacht kostet ein Eingangstoken
# ein Viertel (0,10 statt 0,40 USD je Million, siehe usage.py), ungecacht das
# Vierfache davon, und beides multipliziert sich mit der Anzahl Leads einer
# Suche. Zum Anlernen eines Schreibstils saettigt Few-Shot ohnehin lange
# vorher.
#
# Muss mit MAX_PERSONALIZATION_EXAMPLES in
# apps/web/lib/personalization-defaults.ts uebereinstimmen: die Oberflaeche
# laesst nur so viele anlegen, hier wird dieselbe Grenze noch einmal
# durchgesetzt, damit ein anderer Schreibweg sie nicht umgehen kann.
MAX_EXAMPLES = 10

DEFAULT_PROMPT_DE = (
    "Deine Aufgabe ist es, einen einzelnen, vertrieblich messerscharfen Aufhänger "
    "(Icebreaker) für eine Cold-Email zu generieren, der beweist, dass du die Welt "
    "des potenziellen Kunden tatsächlich verstehst.\n"
    "Regeln für den Icebreaker:\n"
    "- Nutze ausschließlich spezifische, überprüfbare Fakten aus der Recherche und "
    "anderen Datenfeldern (Rolle, Unternehmen, Nische, Standort, Historie, Angebote, "
    "Projekte etc.).\n"
    "- Tonalität: direkt, selbstbewusst, geschäftsmäßig. Eine gewisse Schärfe ist "
    "völlig in Ordnung. Kein Slang, kein Hype.\n"
    "- Erwähne NICHT LinkedIn, Google, „Ich habe gesehen\", „Mir ist aufgefallen\", "
    "„Ich habe gefunden\" oder andere Verweise auf deinen Rechercheprozess. Nenne "
    "einfach direkt den Fakt.\n"
    "- Baue KEINEN Namen des potenziellen Kunden, deinen eigenen Namen, Begrüßungen "
    "oder Verabschiedungen in den Icebreaker ein.\n"
    "- Schreibe NIEMALS \"—, --,-\", also etwa \"— dachte ich melde mich mal\".\n"
    "- Du darfst kommerzielle Interessen, Dynamiken oder Hebelwirkung andeuten (z. B. "
    "Mitbewerber überdauern, maßgeschneiderte Lösungen statt Masse wählen, eine Nische "
    "verdoppeln, Kapazitäten schützen), aber du darfst deine eigene Dienstleistung oder "
    "Lösung NICHT beschreiben oder pitchen.\n"
    "- Der Satz sollte sich wie eine scharfe Beobachtung anfühlen, die du direkt vor "
    "einer ernsthaften Vertriebsfrage äußern würdest.\n"
    "- Werde konkret. Vermeide vages Lob. Verankere die Aussage in etwas "
    "Zeitgebundenem, Ortsgebundenem oder Modellgebundenem (z. B. was sich verändert "
    "hat, worauf sie doppelt gesetzt haben, was sie weitergeführt haben, während "
    "andere damit aufhörten).\n"
    "Folge dem Ausgabeformat immer ganz genau.\n"
    "-Schreibe immer in der \"Du\" Form und nicht \"Sie\" Form und lass den Icebreaker "
    "persönlich klingen.\n"
    "-Beende den Icebreaker damit, dass du dich deswegen meldest und nutze "
    "verschiedene Varianten zb:\"Dachte ich melde mich mal\", \"Deswegen wollte ich uns "
    "connecten\", \"Deshalb wollte ich dir mal schreiben\" etc..\n\n"
    "Schreibe standardmäßig auf Deutsch, außer diese Vorgaben verlangen hier "
    "ausdrücklich eine andere Sprache."
)

# Inhaltsgleich zu DEFAULT_PROMPT_DE, nur auf Englisch. Muss mit
# DEFAULT_PROMPT_EN in apps/web/lib/personalization-defaults.ts
# uebereinstimmen: die Web-Oberflaeche zeigt denselben Text als
# Ausgangspunkt an, und ein Unterschied waere fuer den Nutzer unsichtbar.
DEFAULT_PROMPT_EN = (
    "Your task is to generate a single, commercially razor-sharp opening line "
    "(icebreaker) for a cold email that proves you genuinely understand the "
    "prospect's world.\n"
    "Rules for the icebreaker:\n"
    "- Use only specific, verifiable facts from the research and other data fields "
    "(role, company, niche, location, history, offerings, projects, etc.).\n"
    "- Tone: direct, confident, business-like. A bit of edge is completely fine. "
    "No slang, no hype.\n"
    "- Do NOT mention LinkedIn, Google, \"I saw\", \"I noticed\", \"I found\", or any "
    "other reference to your research process. Just state the fact directly.\n"
    "- Do NOT include the prospect's name, your own name, greetings, or sign-offs.\n"
    "- Do NOT ever type:\"—, --,-\" like: \"— thought I'd reach out\".\n"
    "- You may hint at commercial interest, dynamics, or leverage (e.g. outlasting "
    "competitors, choosing tailored solutions over mass-market ones, doubling down "
    "on a niche, protecting capacity), but you must NOT describe or pitch your own "
    "service or solution.\n"
    "- The sentence should feel like a sharp observation you'd make right before a "
    "serious sales question.\n"
    "- Be specific. Avoid vague praise. Anchor the statement in something time-bound, "
    "location-bound, or model-bound (e.g. what changed, what they doubled down on, "
    "what they kept going while others stopped).\n"
    "Follow the output format exactly every time.\n"
    "-Always write in the informal \"you\" form and make the icebreaker sound personal.\n"
    "-End the icebreaker by implying that's why you're reaching out, using varied "
    "phrasing, e.g.: \"Thought I'd reach out\", \"That's why I wanted to connect\", "
    "\"That's why I wanted to drop you a line\", etc.\n\n"
    "Write in English by default, unless these instructions explicitly require "
    "another language."
)

DEFAULT_LANGUAGE = "de"
VALID_LANGUAGES = {"de", "en"}

# Wie die Sprache dem Modell gesagt wird. Auf Englisch formuliert, aus
# demselben Grund wie der uebrige constraint_block: Formvorgaben befolgt das
# Modell in Englisch verlaesslicher.
_LANGUAGE_NAMES = {"de": "German", "en": "English"}


def default_prompt(language: str) -> str:
    return DEFAULT_PROMPT_EN if language == "en" else DEFAULT_PROMPT_DE


# Rueckwaertskompatibler Alias fuer Aufrufer ohne Sprachwahl.
DEFAULT_PROMPT = DEFAULT_PROMPT_DE

# Am 2026-08-13 von 22 auf 35 gehoben. Gemessen: von 737 erzeugten Aufhaengern
# fielen 439 durch, fast alle mit "33 statt max. 22 Woerter". Der
# Standardprompt verlangt einen konkreten Fakt UND den Anschluss "deswegen
# melde ich mich"; beides zusammen passt nicht in 22 Woerter. Eine Grenze,
# die drei von fuenf Ergebnissen bemaengelt, wird ueberlesen und verdeckt dann
# den echten Fehler. Muss mit DEFAULT_MAX_WORDS in
# apps/web/lib/personalization-defaults.ts uebereinstimmen.
DEFAULT_MAX_WORDS = 35
# Gedankenstriche statt der frueheren Lob-Woerter ("Respekt", "bewundern",
# "stolz", ...): ein Gedankenstrich mitten im Satz ist inzwischen das
# deutlichste Erkennungszeichen fuer KI-Text. Vages Lob faengt der Prompt
# ohnehin ueber "Vermeide vages Lob" ab. Muss mit DEFAULT_BANNED_WORDS in
# apps/web/lib/personalization-defaults.ts uebereinstimmen.
DEFAULT_BANNED_WORDS = ["—", "–", "--", "-"]
DEFAULT_SOURCE = "company_summary"
VALID_SOURCES = {"company_summary", "website_text", "both"}


def constraint_block(max_words: int, banned_words: list[str], language: str = DEFAULT_LANGUAGE) -> str:
    """Die harten Vorgaben, die dem Modell BEIM ERSTEN VERSUCH gesagt werden.

    DER FEHLER, DEN DAS BEHEBT

    Die Wortgrenze stand nie im Prompt. Sie wurde ausschliesslich HINTERHER
    von validate() geprueft. Das Modell hat also nie erfahren, woran es sich
    halten soll, und erst der Korrektur-Versuch nannte die Zahl. Gemessen am
    2026-08-04 ueber 1032 erzeugte Zeilen: Median 24 Woerter bei einer Grenze
    von 22, und 705 Zeilen darueber. Die auffaelligen lagen bei 33 Woertern,
    also 50 Prozent ueber der Vorgabe: kein Ausrutscher, sondern ein Prompt,
    der die Laenge schlicht nicht erwaehnt.

    Wird an JEDEN Prompt angehaengt, auch an einen selbst geschriebenen. Die
    Vorgaben stehen in den Workspace-Einstellungen; sie dort zu setzen und
    dann darauf zu hoffen, dass der Nutzer sie zusaetzlich in seinen Prompt
    schreibt, waere zwei Wahrheiten fuer dieselbe Sache.

    Auf Englisch, unabhaengig von der Sprache des Prompts: das Modell befolgt
    Formvorgaben in Englisch verlaesslicher, und dieser Block sagt nichts
    ueber den INHALT; die Ausgabesprache bestimmt weiterhin der Prompt
    darueber.
    """
    lines = [
        "",
        "",
        "HARD LIMITS (these override anything above):",
        # Die Sprache steht hier und nicht nur im Prompt darueber, aus genau
        # demselben Grund wie die Wortgrenze: sie ist eine Einstellung des
        # Workspaces. Sie dort zu setzen und dann darauf zu hoffen, dass der
        # Nutzer sie zusaetzlich in seinen selbst geschriebenen Prompt
        # schreibt, waeren zwei Wahrheiten fuer dieselbe Sache, und der
        # gemeldete Fehler war genau das.
        # Klammern, damit sichtbar ist, dass hier ZWEI Zeilen absichtlich eine
        # Anweisung ergeben und nicht ein Komma fehlt. Ruff meldet die
        # unbeklammerte Form (ISC004), zu Recht: genau so sieht ein
        # vergessenes Komma aus, und in einer Liste von Prompt-Zeilen faellt
        # der Unterschied niemandem auf.
        (
            f"- Write the icebreaker in {_LANGUAGE_NAMES.get(language, 'German')}. "
            "This overrides any language used in the instructions above."
        ),
        (
            f"- Maximum {max_words} words. Count them before you answer. "
            "Going over is the single most common failure here."
        ),
    ]
    chars = [w.strip() for w in banned_words if w.strip()]
    if chars:
        lines.append("- Never use these characters: " + " ".join(chars))
    lines += [
        # Der Grund fuer diese Zeile: an echten Daten endeten praktisch ALLE
        # erzeugten Aufhaenger mit derselben Wendung, naemlich der ersten,
        # die der Prompt als Beispiel nennt. Ein Beispiel wird vom Modell als
        # Vorlage gelesen, wenn man es nicht ausdruecklich daran hindert. Bei
        # Kaltakquise faellt genau das auf: 94 Mails an dieselbe Nische, die
        # alle gleich enden.
        (
            "- Any example phrasings above are examples, NOT templates. Never reuse "
            "one word for word; end differently every time."
        ),
        "- Output the line itself only: no quotes, no label, no preamble.",
    ]
    return "\n".join(lines)


class NotReadyYet(Exception):
    """Die benoetigte Recherche (company_summary) ist noch nicht fertig -> Job wird
    vom Queue-Retry (fail_job, Backoff) automatisch spaeter erneut versucht."""


def fetch_website_text(url: str) -> str | None:
    """Lesbarer Text der Website.

    Der Abruf selbst liegt seit dem Website-Check in worker/website_fetch.py:
    dieselbe Seite wird jetzt an zwei Stellen geholt (hier fuer den Text, im
    check_website-Job fuer das rohe HTML), und User-Agent, Zeitlimit und
    Weiterleitungsverhalten sollen dabei nicht auseinanderlaufen. Verhalten
    unveraendert, auch die geworfene httpx.HTTPError.
    """
    page = website_fetch.fetch_page(url)
    return trafilatura.extract(page.html)


def _safe_website_text(website: str | None) -> str | None:
    if not website:
        return None
    try:
        text = fetch_website_text(website)
    except httpx.HTTPError:
        return None
    if not text or len(text) < 100:
        return None
    return text[:MAX_SITE_CHARS]


def pain_point_hint(biz: dict) -> str | None:
    """Zusatzsignal aus der Google-Places-Suche (fehlende Website, auffaellig
    niedrige/keine Bewertung). Wird als zusaetzliche, klar benannte Tatsache an
    den Kontext angehaengt; der bestehende System-Prompt weist das Modell
    ohnehin an, spezifische Fakten "aus anderen Datenfeldern" zu nutzen, dieses
    Signal ist also nur ein weiteres solches Datenfeld, kein neuer Prompt-Typ."""
    if not biz.get("website"):
        return "Zusatzsignal: Dieses Unternehmen hat aktuell keine auffindbare Website."
    rating = biz.get("rating")
    if rating is not None and rating < 4.0:
        return f"Zusatzsignal: Die Google-Bewertung liegt bei {rating} von 5 Sternen (auffaellig niedrig)."
    return None


# Wie lange auf einen noch laufenden Website-Check gewartet wird, gerechnet ab
# businesses.created_at.
#
# GESETZTE GRENZE, KEIN MESSWERT. Sie beantwortet eine einzige Frage: was
# passiert, wenn der check_website-Job nie fertig wird (Worker abgestuerzt,
# Status haengt dauerhaft auf 'pending')? Ohne Deckel bekaeme dieser Lead nie
# einen Icebreaker.
#
# DIE ZAHL HAENGT AM RETRY-BUDGET DER QUEUE, nicht an der Dauer des Checks.
# Ein wartender personalize-Job hat genau drei Laeufe: sofort, nach 60
# Sekunden und nach weiteren 240 (queue.fail_job, max_attempts = 3, Backoff
# 60 * attempts^2). Danach steht er endgueltig auf 'failed'. Ein Deckel von
# einer halben Stunde waere deshalb wirkungslos gewesen: der Job waere lange
# vorher aufgegeben worden, und das Warten haette genau das erzeugt, was es
# verhindern soll. Vier Minuten sind kleiner als diese fuenf, der letzte
# Versuch laeuft also verlaesslich durch, notfalls ohne Befund.
#
# Dass dabei ein Befund verlorengehen koennte, ist unwahrscheinlich: die
# check_website-Jobs einer Liste werden VOR ihren personalize-Jobs eingereiht
# (get_businesses._queue_website_audits) und claim_job arbeitet nach run_at,
# holt sie also auch zuerst. Wenn ein personalize-Job an die Reihe kommt, ist
# der Check seiner Firma normalerweise laengst durch.
#
# Die Fehlerrichtung ist bewusst diese: lieber ein Icebreaker ohne Aufhaenger
# als eine Lead-Liste, die stehen bleibt.
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


def audit_hint(biz: dict) -> str | None:
    """Der EINE ranghoechste Website-Befund als Zusatzsignal, Tatsache und Folge.

    Warum genau einer und nicht alle: siehe website_audit.top_finding. Und
    warum ueberhaupt hier und nicht als eigene personalization_source: der
    Befund ist kein Ersatz fuer die Firmenbeschreibung, sondern ein weiteres
    Datenfeld. An dieser Stelle wirkt er fuer alle drei Quellen
    (company_summary, website_text, both), ohne Migration am Quellen-Enum und
    ohne Aenderung an der Oberflaeche.
    """
    finding = website_audit.top_finding(biz.get("website_audit"))
    if not finding:
        return None
    code = finding["code"]
    fact = website_audit.FACT_DE.get(code)
    consequence = website_audit.CONSEQUENCE_DE.get(code)
    if not fact or not consequence:
        return None  # Code ohne hinterlegten Text: lieber kein Signal als ein halbes
    evidence = (finding.get("evidence") or "").strip()
    # Der Beleg ist ein Zitat von der Seite und steht deshalb in Klammern
    # dahinter, nicht im Satz: er soll nachschlagbar sein, nicht formuliert
    # wirken.
    evidence_note = f" (auf der Seite gefunden: {evidence})" if evidence else ""
    return f"Zusatzsignal: {fact}{evidence_note} {consequence}"


def build_context(biz: dict, source: str) -> str | None:
    """Baut den Kontext-Text fuer den Prompt je nach gewaehlter Datenquelle.
    Wirft NotReadyYet, wenn company_summary oder der Website-Check gebraucht
    werden, aber noch laufen (statt permanent leer zu personalisieren)."""
    if audit_pending(biz):
        # Gleiches Muster wie bei der noch laufenden company_summary: der Job
        # geht ueber fail_job mit Backoff zurueck in die Queue. Der Deckel in
        # audit_pending sorgt dafuer, dass daraus keine Endlosschleife wird.
        raise NotReadyYet("Website-Check laeuft noch")

    summary = (biz.get("company_summary") or "").strip() or None
    decisionmaker_pending = biz.get("decisionmaker_status") in ("pending", "running")

    def with_hint(text: str | None) -> str | None:
        # Der Website-Befund ERSETZT den pain_point_hint, er kommt nicht
        # zusaetzlich. Er ist spezifischer (ein konkreter Mangel statt "die
        # Bewertung ist niedrig") und vom Empfaenger selbst nachpruefbar.
        # Ohne Website gibt es ohnehin keinen Befund, und genau dort ist der
        # pain_point_hint stark ("hat gar keine Website") -- die beiden
        # treten sich also nicht auf die Fuesse.
        hint = audit_hint(biz) or pain_point_hint(biz)
        if not hint:
            return text
        return (text + "\n\n" + hint) if text else hint

    if source == "website_text":
        return with_hint(_safe_website_text(biz.get("website")))

    if source == "company_summary":
        if summary:
            return with_hint(summary)
        if decisionmaker_pending:
            raise NotReadyYet("company_summary noch nicht recherchiert")
        return with_hint(_safe_website_text(biz.get("website")))  # Fallback, falls Recherche nichts fand

    # source == "both"
    website_text = _safe_website_text(biz.get("website"))
    if not summary and decisionmaker_pending and not website_text:
        raise NotReadyYet("company_summary noch nicht recherchiert")
    parts = []
    if summary:
        parts.append("Firmenbeschreibung:\n" + summary)
    if website_text:
        parts.append("Website-Text:\n" + website_text)
    return with_hint("\n\n".join(parts) if parts else None)


def word_count(text: str) -> int:
    return len(text.split())


def validate(text: str, max_words: int, banned_words: list[str]) -> list[str]:
    """Liefert eine Liste menschenlesbarer Regelverstoesse (leer = alles ok)."""
    problems = []
    n = word_count(text)
    if n > max_words:
        problems.append(f"zu lang ({n} statt max. {max_words} Wörter)")
    hits = [w.strip() for w in banned_words if w.strip() and _is_banned_hit(text, w.strip())]
    if hits:
        problems.append("enthält verbotene Wörter: " + ", ".join(hits))
    return problems


def _is_banned_hit(text: str, banned: str) -> bool:
    """Steht das verbotene Zeichen wirklich stoerend im Text?

    Fuer normale Woerter ist das ein simpler Teilstring-Treffer. Fuer
    Satzzeichen gilt dieselbe Unterscheidung wie in
    sanitize_banned_punctuation: ein Bindestrich INNERHALB eines Wortes
    ("third-party", "NSF-certified") verbindet ein zusammengesetztes Wort und
    ist kein Verstoss; gemeint sind nur Striche, die Satzteile abtrennen.

    Ohne diese Unterscheidung galt jede Zeile mit einem zusammengesetzten Wort
    als fehlerhaft, sobald "-" auf der Verbotsliste stand. Gemessen an zwei
    echten Suchen: 66 von 69 Zeilen waren als pruefbeduerftig markiert, und
    jede davon hatte einen zweiten, ueberfluessigen OpenAI-Aufruf ausgeloest.
    """
    if not _is_punctuation_only(banned):
        return banned.lower() in text.lower()
    if banned not in _DASHES_ALSO_VALID_INSIDE_WORDS:
        return banned in text
    for match in re.finditer(re.escape(banned), text):
        start, end = match.span()
        before = text[start - 1] if start > 0 else " "
        after = text[end] if end < len(text) else " "
        if not (before.isalnum() and after.isalnum()):
            return True
    return False


def _is_punctuation_only(word: str) -> bool:
    return bool(word) and not any(ch.isalnum() for ch in word)


# Striche, die auch WORTINTERN vorkommen duerfen: der normale Bindestrich
# verbindet zusammengesetzte Woerter ("two-decade", "values-driven",
# "always-on"). Wird er dort durch ein Komma ersetzt, zerlegt das echte Woerter
# ("a two, decade foothold"). Das ist schlimmer als das Gedankenstrich-Problem,
# das die Sanierung loesen soll. Gedankenstriche (— –) und der doppelte Bindestrich
# stehen dagegen nie innerhalb eines Wortes und werden immer ersetzt, auch ohne
# Leerzeichen drumherum ("events—that's why").
_DASHES_ALSO_VALID_INSIDE_WORDS = {"-", "‐"}


def _replace_punctuation_token(text: str, token: str) -> str:
    keep_inside_words = token in _DASHES_ALSO_VALID_INSIDE_WORDS

    def repl(match: "re.Match[str]") -> str:
        if not keep_inside_words:
            return ", "
        # Wurde Leerraum mitgefressen, stand der Strich zwischen Satzteilen.
        if match.group(0) != token:
            return ", "
        start, end = match.span()
        before = text[start - 1] if start > 0 else " "
        after = text[end] if end < len(text) else " "
        if before.isalnum() and after.isalnum():
            return match.group(0)  # Bindestrich im Wort -> unveraendert lassen
        return ", "

    return re.sub(r"\s*" + re.escape(token) + r"\s*", repl, text)


def sanitize_banned_punctuation(text: str, banned_words: list[str]) -> str:
    """Verboten markierte Satzzeichen (allen voran Gedankenstriche) haelt sich
    GPT auch nach einem expliziten Korrektur-Hinweis zuverlaessig NICHT.
    Eine bekannte Modell-Eigenart, kein Prompting-Problem. Fuer Eintraege in
    banned_words, die ausschliesslich aus Satzzeichen bestehen (z.B. "—",
    "--", "-"), ersetzt dieser deterministische Nachbearbeitungsschritt sie
    hart durch ein Komma, statt sich weiter aufs Modell zu verlassen.
    Normale verbotene WOERTER bleiben bewusst aussen vor: die ersatzlos aus
    dem Satz zu streichen wuerde ihn oft kaputt machen, das kann nur eine
    echte Umformulierung (also der bestehende Retry) leisten."""
    punctuation_words = sorted(
        {w.strip() for w in banned_words if w.strip() and _is_punctuation_only(w.strip())},
        key=len,
        reverse=True,  # "--" vor "-", sonst frisst der kurze Treffer den langen an
    )
    result = text
    for w in punctuation_words:
        result = _replace_punctuation_token(result, w)
    result = re.sub(r"\s+,", ",", result)
    result = re.sub(r",\s*,+", ",", result)
    return result.strip(" ,")


def build_input(
    system_prompt: str,
    company_name: str,
    context: str,
    examples: list[dict] | None = None,
    correction: str | None = None,
) -> list[dict]:
    """Die input-Liste fuer die Responses-API.

    ═══════════════════════════════════════════════════════════════════════
    WIE DIE BEISPIELE IN DEN PROMPT KOMMEN
    ═══════════════════════════════════════════════════════════════════════

    Als echte Gespraechs-Turns, nicht als Aufzaehlung im System-Prompt. Ein
    Beispiel ist ein user-Turn (der Kontext) und der darauf folgende
    assistant-Turn (die handgeschriebene Zeile), und danach kommt die echte
    Anfrage als letzter user-Turn. Das Modell sieht damit genau die Abbildung,
    die es nachmachen soll, an derselben Stelle, an der es sie spaeter
    anwenden muss.

    Die Responses-API laesst genau diese vier Rollen in input zu: user,
    assistant, system, developer. Nachgesehen am 2026-08-22 auf
    https://developers.openai.com/api/reference/resources/responses/methods/create
    ("Create a model response", input -> Message). assistant-Turns sind dort
    ausdruecklich die Turns, die als vom Modell erzeugt GELTEN, also genau das,
    was Few-Shot braucht. Sie duerfen im Request stehen, ohne dass es vorher
    einen echten Lauf gegeben hat.

    Der assistant-Turn ist die blanke Zeile: keine Anfuehrungszeichen, kein
    Label, kein "Icebreaker:". Alles, was dort zusaetzlich steht, waere Teil
    des Musters und tauchte in den Ergebnissen wieder auf.

    ZUR FORM DES BEISPIEL-USER-TURNS

    Die echte Anfrage lautet "Unternehmen: <Name>\\n\\n<Kontext>". Ein
    Beispiel hat keinen Firmennamen: personalization_examples speichert nur
    input_context und icebreaker. Es gibt also drei Moeglichkeiten, und zwei
    davon sind schlechter:

      - Einen erfundenen Platzhalternamen einsetzen. Das waere die schlimmste
        Variante, weil derselbe Name dann in JEDEM Beispiel steht und damit
        selbst zum Muster wird. Genau dieser Effekt ist an echten Daten schon
        gemessen worden und steht in constraint_block dokumentiert: die
        erzeugten Zeilen endeten praktisch alle mit derselben Wendung, weil
        der Prompt sie einmal als Beispiel nannte.
      - Bei manchen Beispielen die Zeile setzen und bei anderen nicht. Dann
        ist die Form nicht einmal untereinander gleich.

    Deshalb ist der Beispiel-User-Turn der input_context, wie er hinterlegt
    ist, unveraendert und ohne Zusatz. Das ist untereinander konsistent, und
    der Unterschied zur echten Anfrage ist genau eine Kopfzeile. Die
    Oberflaeche zeigt im Eingabefeld einen Platzhalter, der diese Kopfzeile
    vormacht; wer sie mit einfuegt, hat auch diesen Unterschied nicht mehr.

    DER KORREKTUR-VERSUCH

    haengt am LETZTEN user-Turn, also an der echten Anfrage. An ein Beispiel
    gehaengt wuerde er zum Bestandteil des gelernten Musters, und das Modell
    lernte, dass zu jedem Kontext eine Ruege gehoert.

    PROMPT-CACHING

    Die Reihenfolge system, Beispiele, echte Anfrage ist genau die, die OpenAI
    fuer das Caching verlangt. Nachgesehen am 2026-08-22 auf
    https://developers.openai.com/api/docs/guides/prompt-caching:

      - Es laeuft automatisch und ohne eigenen Marker; einen Gegenwert zu
        Anthropics cache_control gibt es nicht und braucht es nicht.
      - Gecacht wird das PRAEFIX der Anfrage, und die Doku sagt woertlich:
        "Place static content like instructions and examples at the beginning
        of your prompt, and put variable content, such as user-specific
        information, at the end." System-Prompt und Beispielblock sind ueber
        alle Leads eines Workspaces byte-identisch, nur der letzte user-Turn
        wechselt. Diese Funktion baut deshalb in genau dieser Reihenfolge.
      - Der Vorspann muss mindestens 1024 Tokens lang sein, Treffer gibt es
        danach in Schritten von 128 Tokens (fuer Modelle vor GPT-5.6, also
        auch fuer MODEL hier). Ein System-Prompt ohne Beispiele liegt in der
        Regel darunter: ohne hinterlegte Beispiele passiert schlicht nichts,
        ohne Fehler und ohne Aufschlag.
      - Der Eintrag verfaellt nach 5 bis 10 Minuten ohne Zugriff. Innerhalb
        einer laufenden Suche kommen die personalize-Jobs dicht genug
        hintereinander; die erste Zeile nach einer Pause zahlt wieder voll.
    """
    input_items: list[dict] = [{"role": "system", "content": system_prompt}]
    for ex in examples or []:
        input_items.append({"role": "user", "content": ex["input_context"]})
        input_items.append({"role": "assistant", "content": ex["icebreaker"]})

    user_content = f"Unternehmen: {company_name}\n\n{context}"
    if correction:
        user_content += (
            f"\n\nDein letzter Versuch hat folgende Regel(n) verletzt: {correction}. "
            "Bitte korrigiere und antworte erneut nur mit dem Text selbst."
        )
    input_items.append({"role": "user", "content": user_content})
    return input_items


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=60), reraise=True)
def generate(
    company_name: str,
    context: str,
    api_key: str,
    system_prompt: str,
    correction: str | None = None,
    workspace_id: str | None = None,
    search_id: str | None = None,
    examples: list[dict] | None = None,
) -> str:
    client = OpenAI(api_key=api_key)
    resp = client.responses.create(
        model=MODEL,
        input=build_input(system_prompt, company_name, context, examples, correction),
    )
    # Direkt hier festhalten statt beim Aufrufer: ein Korrektur-Versuch ist ein
    # zweiter, echter Aufruf und muss auch zweimal zaehlen. Frueher wurde pro
    # JOB gerechnet, der Nachschlag war damit unsichtbar.
    if workspace_id:
        usage.record_openai(workspace_id, "personalize", resp, search_id=search_id)
    return resp.output_text.strip().strip('"')


def load_examples(workspace_id: str) -> list[dict]:
    """Die hinterlegten Few-Shot-Paare, in der Reihenfolge der Oberflaeche.

    Halbe Paare fliegen raus. Ein Beispiel, bei dem der Kontext ODER die Zeile
    fehlt, bringt dem Modell nicht ein halbes Muster bei, sondern ein falsches:
    einmal "zu diesem Kontext gehoert nichts", einmal "diese Zeile kommt aus
    dem Nichts". Beides ist schlechter als das Beispiel wegzulassen. In der
    Oberflaeche entstehen solche Zeilen zwangslaeufig, weil ein neues Paar
    zuerst leer angelegt und dann gefuellt wird.
    """
    rows = (
        sb()
        .table("personalization_examples")
        .select("input_context, icebreaker, sort_order")
        .eq("workspace_id", workspace_id)
        .order("sort_order")
        .order("created_at")
        .limit(MAX_EXAMPLES)
        .execute()
        .data
        or []
    )
    examples = []
    for row in rows:
        context = (row.get("input_context") or "").strip()
        icebreaker = (row.get("icebreaker") or "").strip()
        if not context or not icebreaker:
            continue
        examples.append({"input_context": context, "icebreaker": icebreaker})
    return examples


def load_agent_config(workspace_id: str) -> dict:
    row = (
        sb()
        .table("workspaces")
        # personalization_model steht bewusst NICHT mehr in dieser Auswahl:
        # die Spalte gibt es weiter (Migration 0097), gelesen wird sie seit dem
        # 2026-08-22 von niemandem mehr. Siehe Modul-Docstring.
        .select(
            "personalization_prompt, personalization_source, "
            "personalization_max_words, personalization_banned_words, "
            "personalization_language"
        )
        .eq("id", workspace_id)
        .single()
        .execute()
        .data
        or {}
    )
    source = row.get("personalization_source") or DEFAULT_SOURCE
    if source not in VALID_SOURCES:
        source = DEFAULT_SOURCE
    banned_raw = row.get("personalization_banned_words")
    banned_words = (
        [w for w in (x.strip() for x in banned_raw.split(",")) if w]
        if banned_raw
        else list(DEFAULT_BANNED_WORDS)
    )
    language = row.get("personalization_language") or DEFAULT_LANGUAGE
    if language not in VALID_LANGUAGES:
        language = DEFAULT_LANGUAGE
    return {
        # Ohne eigenen Prompt gilt der Standard IN DER GEWAEHLTEN SPRACHE.
        # Vorher stand hier fest DEFAULT_PROMPT (deutsch), daher kamen
        # deutsche Icebreaker fuer einen Workspace, dessen Oberflaeche den
        # englischen Prompt anzeigte. Siehe Migration 0083.
        "system_prompt": (row.get("personalization_prompt") or "").strip()
        or default_prompt(language),
        "source": source,
        "max_words": row.get("personalization_max_words") or DEFAULT_MAX_WORDS,
        "banned_words": banned_words,
        "language": language,
    }


def run(job: dict) -> None:
    from worker.keys import get_api_key  # lokaler Import, haelt Testabhaengigkeiten schlank

    ws = job["workspace_id"]
    business_id = job["payload"]["business_id"]
    # force=true kommt ausschliesslich von "neu erzeugen" in der Pruefliste
    # (requeue_personalization, Migration 0084). Ohne diese Unterscheidung war
    # der Knopf wirkungslos: er wird nur auf Zeilen geklickt, die schon einen
    # Text haben, also griff die Abkuerzung unten immer. Der Job lief an,
    # kehrte sofort um und galt als erledigt.
    force = bool(job["payload"].get("force"))
    biz = sb().table("businesses").select(BUSINESS_WITH_SEARCH).eq("id", business_id).single().execute().data
    if biz.get("personalization") and not force:
        # Schutz gegen doppeltes Bezahlen, wenn ein Pipeline-Job ein zweites
        # Mal ankommt (Neustart des Workers, wiederholte Zustellung).
        return
    if search_is_deleted(biz):
        return  # Suche im Papierkorb, keine OpenAI-Kosten fuer unsichtbare Leads

    cfg = load_agent_config(ws)

    context = build_context(biz, cfg["source"])  # kann NotReadyYet werfen -> Queue retried spaeter
    if not context:
        return  # keine Datenbasis vorhanden und Recherche bereits abgeschlossen -> kein Retry-Spam

    api_key = get_api_key(ws, "openai")
    examples = load_examples(ws)
    # Direkt vom Datensatz: das eingebettete searches(...) liefert nur
    # deleted_at, keine id (siehe BUSINESS_WITH_SEARCH).
    search_id = biz.get("search_id")
    # Die Vorgaben gehoeren IN den Prompt, nicht nur in die Nachpruefung,
    # siehe constraint_block.
    system_prompt = cfg["system_prompt"] + constraint_block(
        cfg["max_words"], cfg["banned_words"], cfg["language"]
    )

    def write_line(correction: str | None = None) -> str:
        """Ein Modellaufruf.

        Bewusst als eine Stelle: der erste Versuch und die EINE Korrekturrunde
        darunter gehen durch dieselbe Funktion, damit sie nicht auseinander
        laufen koennen. An dieser Nachbehandlung haengen mehrere gemessene
        Befunde (siehe validate und sanitize_banned_punctuation).
        """
        return generate(
            biz["name"], context, api_key, system_prompt,
            correction=correction, workspace_id=ws, search_id=search_id,
            examples=examples,
        )

    line = write_line()
    problems = validate(line, cfg["max_words"], cfg["banned_words"])
    needs_review = False
    if problems:
        line = write_line(correction="; ".join(problems))
        line = sanitize_banned_punctuation(line, cfg["banned_words"])
        needs_review = bool(validate(line, cfg["max_words"], cfg["banned_words"]))

    sb().table("businesses").update(
        {"personalization": line, "personalization_needs_review": needs_review}
    ).eq("id", business_id).execute()
