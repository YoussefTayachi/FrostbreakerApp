"""Einordnung von Anbieter-Fehlern: aufgebrauchtes Guthaben vs. Drosselung.

Warum es diese Datei gibt: Am 2026-08-03 standen 467 fehlgeschlagene Jobs in
der Warteschlange. 128 davon (88 personalize und 40 find_decisionmaker)
trugen denselben Text:

    Error code: 429 - {'error': {'message': 'You have no credits remaining.
    Add credits to continue using the API ...

Das OpenAI-Guthaben war leer. Die App hat trotzdem 128-mal weiter versucht,
jeder Versuch hat die Zustellversuche des Jobs verbraucht, und am Ende waren
die Jobs endgueltig 'failed', ohne dass jemand je eine Meldung gesehen
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
liefern; nur der Meldungstext trennt sie. Genau deshalb steht die Logik hier
als reine Funktion mit Tests gegen die echten Texte aus der Datenbank und
nicht verstreut in den Pipelines.

BEI ANTHROPIC STIMMT "BEIDES IST 429" NICHT.

Nachgesehen am 2026-08-22 auf
https://platform.claude.com/docs/en/api/errors und
https://platform.claude.com/docs/en/api/rate-limits. Dort gibt es DREI
verschiedene Antworten fuer "kein Geld mehr", mit drei verschiedenen Codes:

    402 billing_error         "There's an issue with your billing or payment
                              information."
    400 invalid_request_error Selbst gesetztes Ausgabelimit erreicht. Die
                              Meldung beginnt mit "You have reached your
                              specified API usage limits" bzw. "You have
                              reached your specified workspace API usage
                              limits".
    429 rate_limit_error      Monatsdeckel der Tarifstufe erreicht. Woertlich:
                              "You have reached your API usage limits: your
                              organization has crossed its monthly API usage
                              threshold, set based on your organization's API
                              tier. You will regain access on ... at 00:00
                              UTC." Dazu details.error_code =
                              "enforced_spend_limit_reached" und KEIN
                              retry-after-Header.

Der letzte Fall ist der gefaehrlichste: Typ und Code sind identisch mit einer
gewoehnlichen Drosselung, und die Doku sagt ausdruecklich, dass Wiederholen
(auch das automatische des SDK) bis zum Monatswechsel scheitert. Die
Reihenfolge in classify_error, erst Guthaben und dann Drosselung, ist dadurch
noch wichtiger als bei OpenAI.
"""
from __future__ import annotations

import re

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
    # Anthropic, Quelle und Datum siehe Modul-Docstring. Bewusst die
    # Typ-Kennung UND den Meldungstext: das SDK gibt den kompletten
    # JSON-Koerper als Fehlertext aus, damit steht beides drin, und wenn
    # Anthropic den Satz umformuliert, traegt der Typ weiter.
    "billing_error",
    "issue with your billing or payment information",
    "enforced_spend_limit_reached",
    "you have reached your api usage limits",
    "you have reached your specified api usage limits",
    "you have reached your specified workspace api usage limits",
    "crossed its monthly api usage threshold",
)

# Nur Drosselung, kein Geldproblem.
_RATE_LIMIT_MARKERS = (
    "too many requests",
    "rate limit",
    "rate_limit",
)

# Der nackte Statuscode, getrennt von den Textmarkern oben, weil er anders
# geprueft werden muss.
#
# Vorher stand hier schlicht der Teilstring "429". Das trifft auch mitten in
# einer laengeren Zeichenkette, und Anthropic haengt an JEDEN Fehler eine
# request_id der Form "req_018EeWyXxfu5pfWkrYcMdjWG" an (Beispiel aus
# https://platform.claude.com/docs/en/api/errors, 2026-08-22). Enthaelt die
# zufaellig "429", galt ein voellig gewoehnlicher Fehler als Drosselung und
# wurde stumm zurueckgestellt statt gemeldet.
#
# Die eigentliche Verwechslungsgefahr, ein Anthropic-Guthabenfehler als
# Drosselung, besteht dagegen NICHT: classify_error prueft Guthaben zuerst,
# und alle drei Anthropic-Formulierungen stehen oben. Diese Zeile behebt den
# zweiten, unauffaelligeren Fall.
#
# Die Grenzen sind so gesetzt, dass die bisher erkannten Formen unveraendert
# treffen: "Error code: 429 - {...}" (OpenAI-SDK) und "Client error '429 Too
# Many Requests' for url ..." (httpx).
_HTTP_429 = re.compile(r"(?<![0-9a-z])429(?![0-9a-z])")

# Aus der Fehlermeldung ablesbare Anbieter: die httpx-Fehler enthalten die
# aufgerufene URL, das ist zuverlaessiger als vom Job-Typ zurueckzuschliessen.
_URL_PROVIDERS = (
    ("api.hunter.io", "hunter"),
    ("api.apollo.io", "apollo"),
    ("api.prospeo.io", "prospeo"),
    ("api.openai.com", "openai"),
    ("openai.com", "openai"),
    # Greift bei Verbindungsfehlern, die httpx mit URL meldet. Die
    # SDK-Fehler von Anthropic tragen wie die von OpenAI KEINE URL, dafuer
    # gibt es den provider_hint weiter unten.
    ("api.anthropic.com", "anthropic"),
    ("googleapis.com", "google_maps"),
    ("neverbounce.com", "neverbounce"),
)

# Letzter Rueckfall, wenn die Meldung keine URL enthaelt (z.B. die SDK-Fehler
# von OpenAI). Entspricht der Zuordnung in get_businesses.py: get_businesses
# haengt an der Quelle der Suche und laesst sich hier deshalb nicht aufloesen.
#
# 'personalize' steht hier weiterhin auf 'openai', WEIL das die Voreinstellung
# jedes Workspaces ist (workspaces.personalization_model, Migration 0097).
# Stellt ein Workspace auf Claude um, waere diese Zuordnung falsch, und davon
# haengt ab, wessen Guthaben-Alarm ausgeloest wird. Deshalb gibt personalize.py
# den tatsaechlich benutzten Anbieter als provider_hint mit; der schlaegt diese
# Tabelle. Sie einfach zu leeren waere die schlechtere Loesung: dann bekaeme
# der Regelfall (OpenAI, SDK-Fehler ohne URL) gar keinen Alarm mehr, und genau
# dieser Fall ist der Grund, warum es diese Datei gibt.
_JOB_TYPE_PROVIDERS = {
    "find_decisionmaker": "openai",
    "personalize": "openai",
    "hunt_persons": "hunter",
}

# Zweiter Rueckfall: Meldungen, die WIR selbst formuliert haben und die
# deshalb keine URL enthalten. ProspeoPlanError sagt "Prospeo hat den
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
    ebenfalls 429, und Anthropic tut es beim Monatsdeckel der Tarifstufe
    genauso (siehe Modul-Docstring). Wuerde zuerst auf Drosselung geprueft,
    waere jedes leere Konto als voruebergehend eingestuft. Genau dieser Fehler
    hat die 128 Fehlschlaege erzeugt.
    """
    if not error_text:
        return None
    text = error_text.lower()
    if any(marker in text for marker in _OUT_OF_CREDIT_MARKERS):
        return "out_of_credit"
    if any(marker in text for marker in _RATE_LIMIT_MARKERS):
        return "rate_limited"
    if _HTTP_429.search(text):
        return "rate_limited"
    return None


def provider_from_error(
    error_text: str,
    job_type: str | None = None,
    provider_hint: str | None = None,
) -> str | None:
    """Welcher Anbieter steckt hinter dem Fehler?

    Erst die URL aus der Meldung, dann unsere eigenen Anbieternamen, dann der
    vom Aufrufer mitgegebene Hinweis, zuletzt der Job-Typ. get_businesses
    bleibt absichtlich ohne Job-Typ-Rueckfall: welcher Anbieter dort zustaendig
    ist, haengt an der Quelle der Suche (maps/corporate/apollo/prospeo) und
    laesst sich aus dem Fehlertext allein nicht sicher sagen. Lieber kein
    Anbieter als der falsche.

    provider_hint ist der Weg fuer Pipelines, die den Anbieter WISSEN, waehrend
    er sich aus dem Text nicht ablesen laesst. Bei personalize ist genau das
    der Fall, seit ein Workspace zwischen OpenAI und Claude waehlen kann: beide
    SDKs melden ihre Fehler ohne URL, und der Job-Typ allein sagt nur noch, was
    die Voreinstellung ist. Die URL bleibt trotzdem vorn, weil sie direkt aus
    dem Fehler kommt und damit nicht veralten kann.
    """
    if error_text:
        text = error_text.lower()
        for needle, provider in _URL_PROVIDERS:
            if needle in text:
                return provider
        for needle, provider in _NAME_PROVIDERS:
            if needle in text:
                return provider
    if provider_hint:
        return provider_hint
    if job_type:
        return _JOB_TYPE_PROVIDERS.get(job_type)
    return None
