"""Pipeline 4 — KI-Personalisierung / Icebreaker.

Generiert die personalisierte Eroeffnungszeile ({{personalization}}-Variable)
fuer die Akquise-Mail. Nutzt je nach Workspace-Einstellung (personalization_source)
entweder die vom find_decisionmaker-Job recherchierte Firmenbeschreibung
(businesses.company_summary), den gecrawlten Website-Text, oder beides.

Der System-Prompt ist vollstaendig ueberschreibbar (workspaces.personalization_prompt);
ohne eigene Vorgabe gilt DEFAULT_PROMPT. Wortzahl und verbotene Woerter werden nach
der Generierung geprueft; bei Verstoss gibt es genau einen Korrektur-Versuch mit
Hinweis auf das Problem. Schlaegt auch der zweite Versuch fehl, wird das Ergebnis
trotzdem gespeichert, aber als personalization_needs_review markiert.
"""
import re

import httpx
import trafilatura
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from worker.db import sb
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted

MODEL = "gpt-4.1-mini"
MAX_SITE_CHARS = 6000

DEFAULT_PROMPT = (
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

DEFAULT_MAX_WORDS = 22
DEFAULT_BANNED_WORDS = [
    "Respekt", "bewundern", "stolz", "Lob", "begeistert",
    "aufgeregt", "inspiriert", "beeindruckt", "geehrt",
]
DEFAULT_SOURCE = "company_summary"
VALID_SOURCES = {"company_summary", "website_text", "both"}


class NotReadyYet(Exception):
    """Die benoetigte Recherche (company_summary) ist noch nicht fertig -> Job wird
    vom Queue-Retry (fail_job, Backoff) automatisch spaeter erneut versucht."""


def fetch_website_text(url: str) -> str | None:
    r = httpx.get(
        url,
        timeout=20,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (compatible; ThawBot/1.0)"},
    )
    r.raise_for_status()
    return trafilatura.extract(r.text)


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
    den Kontext angehaengt -- der bestehende System-Prompt weist das Modell
    ohnehin an, spezifische Fakten "aus anderen Datenfeldern" zu nutzen, dieses
    Signal ist also nur ein weiteres solches Datenfeld, kein neuer Prompt-Typ."""
    if not biz.get("website"):
        return "Zusatzsignal: Dieses Unternehmen hat aktuell keine auffindbare Website."
    rating = biz.get("rating")
    if rating is not None and rating < 4.0:
        return f"Zusatzsignal: Die Google-Bewertung liegt bei {rating} von 5 Sternen (auffaellig niedrig)."
    return None


def build_context(biz: dict, source: str) -> str | None:
    """Baut den Kontext-Text fuer den Prompt je nach gewaehlter Datenquelle.
    Wirft NotReadyYet, wenn company_summary gebraucht wird, die Recherche
    dafuer aber noch laeuft (statt permanent leer zu personalisieren)."""
    summary = (biz.get("company_summary") or "").strip() or None
    decisionmaker_pending = biz.get("decisionmaker_status") in ("pending", "running")

    def with_hint(text: str | None) -> str | None:
        hint = pain_point_hint(biz)
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
    lowered = text.lower()
    hits = [w for w in banned_words if w.strip() and w.strip().lower() in lowered]
    if hits:
        problems.append("enthält verbotene Wörter: " + ", ".join(hits))
    return problems


def _is_punctuation_only(word: str) -> bool:
    return bool(word) and not any(ch.isalnum() for ch in word)


def sanitize_banned_punctuation(text: str, banned_words: list[str]) -> str:
    """Verboten markierte Satzzeichen (allen voran Gedankenstriche) haelt sich
    GPT auch nach einem expliziten Korrektur-Hinweis zuverlaessig NICHT --
    eine bekannte Modell-Eigenart, kein Prompting-Problem. Fuer Eintraege in
    banned_words, die ausschliesslich aus Satzzeichen bestehen (z.B. "—",
    "--", "-"), ersetzt dieser deterministische Nachbearbeitungsschritt sie
    hart durch ein Komma, statt sich weiter aufs Modell zu verlassen.
    Normale verbotene WOERTER bleiben bewusst aussen vor -- die ersatzlos aus
    dem Satz zu streichen wuerde ihn oft kaputt machen, das kann nur eine
    echte Umformulierung (also der bestehende Retry) leisten."""
    punctuation_words = sorted(
        {w.strip() for w in banned_words if w.strip() and _is_punctuation_only(w.strip())},
        key=len,
        reverse=True,
    )
    result = text
    for w in punctuation_words:
        result = re.sub(r"\s*" + re.escape(w) + r"\s*", ", ", result)
    result = re.sub(r"\s+,", ",", result)
    result = re.sub(r",\s*,+", ",", result)
    return result.strip(" ,")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=60), reraise=True)
def generate(
    company_name: str,
    context: str,
    api_key: str,
    system_prompt: str,
    correction: str | None = None,
) -> str:
    client = OpenAI(api_key=api_key)
    user_content = f"Unternehmen: {company_name}\n\n{context}"
    if correction:
        user_content += (
            f"\n\nDein letzter Versuch hat folgende Regel(n) verletzt: {correction}. "
            "Bitte korrigiere und antworte erneut nur mit dem Text selbst."
        )
    resp = client.responses.create(
        model=MODEL,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    )
    return resp.output_text.strip().strip('"')


def load_agent_config(workspace_id: str) -> dict:
    row = (
        sb()
        .table("workspaces")
        .select(
            "personalization_prompt, personalization_source, "
            "personalization_max_words, personalization_banned_words"
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
    return {
        "system_prompt": (row.get("personalization_prompt") or "").strip() or DEFAULT_PROMPT,
        "source": source,
        "max_words": row.get("personalization_max_words") or DEFAULT_MAX_WORDS,
        "banned_words": banned_words,
    }


def run(job: dict) -> None:
    from worker.keys import get_api_key  # lokaler Import, haelt Testabhaengigkeiten schlank

    ws = job["workspace_id"]
    business_id = job["payload"]["business_id"]
    biz = sb().table("businesses").select(BUSINESS_WITH_SEARCH).eq("id", business_id).single().execute().data
    if biz.get("personalization"):
        return
    if search_is_deleted(biz):
        return  # Suche im Papierkorb -- keine OpenAI-Kosten fuer unsichtbare Leads

    cfg = load_agent_config(ws)
    context = build_context(biz, cfg["source"])  # kann NotReadyYet werfen -> Queue retried spaeter
    if not context:
        return  # keine Datenbasis vorhanden und Recherche bereits abgeschlossen -> kein Retry-Spam

    api_key = get_api_key(ws, "openai")
    line = generate(biz["name"], context, api_key, cfg["system_prompt"])
    problems = validate(line, cfg["max_words"], cfg["banned_words"])
    needs_review = False
    if problems:
        line = generate(
            biz["name"], context, api_key, cfg["system_prompt"], correction="; ".join(problems)
        )
        line = sanitize_banned_punctuation(line, cfg["banned_words"])
        needs_review = bool(validate(line, cfg["max_words"], cfg["banned_words"]))

    sb().table("businesses").update(
        {"personalization": line, "personalization_needs_review": needs_review}
    ).eq("id", business_id).execute()
