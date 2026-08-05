"""Einordnung von Anbieter-Fehlern: aufgebrauchtes Guthaben vs. Drosselung.

Warum es diese Datei gibt: Am 2026-08-03 standen 467 fehlgeschlagene Jobs in
der Warteschlange. 128 davon -- 88 personalize und 40 find_decisionmaker --
trugen denselben Text:

    Error code: 429 - {'error': {'message': 'You have no credits remaining.
    Add credits to continue using the API ...

Das OpenAI-Guthaben war leer. Die App hat trotzdem 128-mal weiter versucht,
jeder Versuch hat die Zustellversuche des Jobs verbraucht, und am Ende waren
die Jobs endgueltig 'failed' -- ohne dass jemand je eine Meldung gesehen
haette. Fuer ein Produkt, bei dem der Kunde seine eigenen Schluessel
mitbringt, ist das der wichtigste Ausfall ueberhaupt: laeuft fremdes Guthaben
aus, steht alles still, und es faellt erst auf, wenn eine Woche Akquise fehlt.

Zwei Faelle, die sehr unterschiedlich behandelt werden muessen:

    out_of_credit   Geld/Kontingent ist alle. Wiederholen ist zwecklos, bis
                    ein Mensch etwas tut. -> Job aufheben statt aufbrauchen,
                    Alarm ausloesen.
    rate_limited    Zu schnell gefragt. Loest sich von allein. -> normal
                    zurueckstellen, kein Alarm.

Die Unterscheidung ist bei OpenAI heikel, weil BEIDE Faelle den Code 429
liefern -- nur der Meldungstext trennt sie. Genau deshalb steht die Logik hier
als reine Funktion mit Tests gegen die echten Texte aus der Datenbank und
nicht verstreut in den Pipelines.
"""
from __future__ import annotations

# Formulierungen, die "das Konto ist leer" bedeuten, quer ueber die Anbieter.
# Kleingeschrieben verglichen.
_OUT_OF_CREDIT_MARKERS = (
    "no credits remaining",
    "insufficient_quota",
    "insufficient quota",
    "exceeded your current quota",
    "billing_hard_limit_reached",
    "billing hard limit",
    "quota exceeded",
    "payment required",
    "not enough credits",
    "credit limit",
    "upgrade your plan",
)

# Nur Drosselung, kein Geldproblem.
_RATE_LIMIT_MARKERS = (
    "too many requests",
    "rate limit",
    "rate_limit",
    "429",
)

# Aus der Fehlermeldung ablesbare Anbieter -- die httpx-Fehler enthalten die
# aufgerufene URL, das ist zuverlaessiger als vom Job-Typ zurueckzuschliessen.
_URL_PROVIDERS = (
    ("api.hunter.io", "hunter"),
    ("api.apollo.io", "apollo"),
    ("api.prospeo.io", "prospeo"),
    ("api.openai.com", "openai"),
    ("openai.com", "openai"),
    ("googleapis.com", "google_maps"),
    ("neverbounce.com", "neverbounce"),
)

# Rueckfall, wenn die Meldung keine URL enthaelt (z.B. die SDK-Fehler von
# OpenAI). Entspricht der Zuordnung in get_businesses.py: get_businesses haengt
# an der Quelle der Suche und laesst sich hier deshalb nicht aufloesen.
_JOB_TYPE_PROVIDERS = {
    "find_decisionmaker": "openai",
    "personalize": "openai",
    "hunt_persons": "hunter",
}

# Zweiter Rueckfall: Meldungen, die WIR selbst formuliert haben und die
# deshalb keine URL enthalten -- ProspeoPlanError sagt "Prospeo hat den
# Schluessel abgelehnt", nicht "https://api.prospeo.io/...".
#
# Bewusst eine eigene, kurze Liste statt den Anbieternamen einfach zu
# _URL_PROVIDERS zu werfen: dort steht laut Vertrag eine URL, und ein
# Anbietername als "URL" waere genau die Sorte stiller Bedeutungsverschiebung,
# die spaeter niemand mehr nachvollzieht. Nur Namen, die eindeutig genug sind,
# um nicht zufaellig in einer fremden Fehlermeldung aufzutauchen.
_NAME_PROVIDERS = (
    ("prospeo", "prospeo"),
)


def classify_error(error_text: str) -> str | None:
    """'out_of_credit', 'rate_limited' oder None (gewoehnlicher Fehler).

    Reihenfolge ist wesentlich: OpenAI schickt bei aufgebrauchtem Guthaben
    ebenfalls 429. Wuerde zuerst auf Drosselung geprueft, waere jedes leere
    Konto als voruebergehend eingestuft -- genau der Fehler, der die 128
    Fehlschlaege erzeugt hat.
    """
    if not error_text:
        return None
    text = error_text.lower()
    if any(marker in text for marker in _OUT_OF_CREDIT_MARKERS):
        return "out_of_credit"
    if any(marker in text for marker in _RATE_LIMIT_MARKERS):
        return "rate_limited"
    return None


def provider_from_error(error_text: str, job_type: str | None = None) -> str | None:
    """Welcher Anbieter steckt hinter dem Fehler?

    Erst die URL aus der Meldung, dann unsere eigenen Anbieternamen, dann der
    Job-Typ. get_businesses bleibt absichtlich ohne Job-Typ-Rueckfall: welcher
    Anbieter dort zustaendig ist, haengt an der Quelle der Suche
    (maps/corporate/apollo/prospeo) und laesst sich aus dem Fehlertext allein
    nicht sicher sagen. Lieber kein Anbieter als der falsche.
    """
    if error_text:
        text = error_text.lower()
        for needle, provider in _URL_PROVIDERS:
            if needle in text:
                return provider
        for needle, provider in _NAME_PROVIDERS:
            if needle in text:
                return provider
    if job_type:
        return _JOB_TYPE_PROVIDERS.get(job_type)
    return None
