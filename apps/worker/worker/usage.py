"""Verbrauch kostenpflichtiger API-Aufrufe festhalten.

Bis hierher entstand die Kostenzahl auf dem Dashboard aus Job-Zaehlern: Anzahl
Jobs mal angenommener Preis. Apollo und NeverBounce fehlten darin komplett, die
"Hunter-Credits" waren in Wahrheit die Anzahl erledigter Jobs, und ein Job mit
zwei OpenAI-Aufrufen zaehlte wie einer.

Deshalb schreibt jeder zahlungsrelevante Aufruf hier eine Zeile mit der
tatsaechlich verbrauchten MENGE. Der Euro-Betrag ist daraus abgeleitet und
kann veralten, wenn ein Anbieter seine Tarife aendert; die Menge bleibt
richtig. Ist ein Preis unbekannt, wird cost_usd bewusst leer gelassen: eine
ehrliche Luecke ist besser als eine erfundene Zahl.

Das Festhalten darf nie den eigentlichen Arbeitsschritt kippen. Schlaegt der
Schreibvorgang fehl, wird das protokolliert und der Lauf geht weiter. Eine
fehlende Kostenzeile ist aergerlich, ein abgebrochener Lead-Import teuer.
"""

import logging

from worker.db import sb

log = logging.getLogger(__name__)

# --- Preise -----------------------------------------------------------------
# Veroeffentlichte Listenpreise, Stand der letzten Pruefung 2026-08-02. Sie
# stehen bewusst an EINER Stelle, damit eine Tarifaenderung ein Einzeiler ist
# und nicht eine Suche quer durch die Pipelines.
#
# Wer sie anpasst: die bereits geschriebenen Zeilen behalten ihren damaligen
# Betrag. Das ist Absicht: rueckwirkend neu zu rechnen wuerde die Historie
# verfaelschen.
OPENAI_USD_PER_1M_INPUT = 0.40
OPENAI_USD_PER_1M_OUTPUT = 1.60
# Ein Eingangstoken, das aus dem Cache gelesen wurde, kostet ein Viertel.
# Nachgesehen am 2026-08-22 auf https://developers.openai.com/api/docs/pricing,
# Zeile gpt-4.1-mini (also MODEL aus personalize.py): Input $0.40, Cached input
# $0.10, Output $1.60. Einen Aufschlag fuers Schreiben gibt es bei diesem
# Modell nicht.
#
# Die Zahl ist erst mit den Few-Shot-Beispielen wichtig geworden: seither steht
# ein Vorspann von mehreren tausend Tokens in JEDER Anfrage, und der wird
# innerhalb einer laufenden Suche ueberwiegend gecacht gelesen. Ohne diesen
# Satz haette die Kostenzeile ihn viermal zu teuer verbucht.
OPENAI_USD_PER_1M_CACHED_INPUT = 0.10

# Preise je Modell, nachgesehen am 2026-09-23 auf
# https://developers.openai.com/api/docs/pricing: gpt-4.1 Input $2.00,
# Cached $0.50, Output $8.00; gpt-4.1-mini $0.40 / $0.10 / $1.60.
#
# WARUM DAS HIER STEHT: bis zum 2026-09-23 hat dieses Buch JEDEN OpenAI-
# Aufruf zum mini-Tarif verbucht, auch die Personen-Recherche mit gpt-4.1
# (fuenfmal teurer), und die Websuche gar nicht. Youssef hat 30 Euro
# nachgeladen, die in einem Nachmittag weg waren, waehrend das Buch 11 Dollar
# zeigte. Die echte Rechnung: 662 Recherche-Aufrufe mit je einer Websuche
# (1 Cent) und rund 19.000 Tokens Suchergebnis zu gpt-4.1-Preisen (3,8 Cent).
OPENAI_PRICES_PER_1M = {
    # (Input, Cached Input, Output)
    "gpt-4.1": (2.00, 0.50, 8.00),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
}
# Die Websuche als Werkzeug: $10 je 1.000 Aufrufe, alle Modelle, zuzueglich
# der Suchergebnis-Tokens zum Modellpreis (dieselbe Seite, 2026-09-23).
OPENAI_USD_PER_WEB_SEARCH_CALL = 0.01


def openai_prices(model: str | None) -> tuple[float, float, float]:
    """Der Tarif zum Modellnamen; OpenAI meldet ihn mit Datumsanhang
    ("gpt-4.1-2025-04-14"), deshalb Praefixvergleich, laengster zuerst."""
    name = (model or "").lower()
    for key in sorted(OPENAI_PRICES_PER_1M, key=len, reverse=True):
        if name.startswith(key):
            return OPENAI_PRICES_PER_1M[key]
    return (OPENAI_USD_PER_1M_INPUT, OPENAI_USD_PER_1M_CACHED_INPUT, OPENAI_USD_PER_1M_OUTPUT)


# Hunter und Apollo rechnen in Credits ab, deren Eurowert vom gebuchten Tarif
# abhaengt und deshalb nicht allgemein bezifferbar ist. Wir halten die Credits
# fest und lassen den Betrag offen, statt einen Tarif zu unterstellen.
NEVERBOUNCE_USD_PER_CHECK = 0.008

# Anthropic hatte hier am 2026-08-22 kurzzeitig vier eigene Preise (Claude als
# zweiter Personalisierungs-Anbieter). Der Weg ist noch am selben Tag wieder
# entfallen, die Preise sind mit ihm gegangen. Der Wert 'anthropic' bleibt
# absichtlich im CHECK-Constraint von api_usage stehen (Migration 0097): er
# stoert nicht, es gibt 0 Zeilen damit (gemessen am 2026-08-22), und eine
# Migration, die einen Constraint zurueckbaut, ist mehr Risiko als Nutzen.


def openai_cost_usd(
    input_tokens: int, output_tokens: int, cached_input_tokens: int = 0, model: str | None = None
) -> float:
    """cached_input_tokens ist ein TEIL von input_tokens, kein Zusatz.

    OpenAI meldet input_tokens als Gesamtsumme und den gecachten Anteil
    darunter in input_tokens_details.cached_tokens (Beispiel aus der Doku,
    nachgesehen am 2026-08-22: input_tokens 2600, davon cached_tokens 2000).
    Anthropic hat das andersherum gemacht, deshalb steht es hier ausdruecklich:
    wer beide Zahlen addierte, wuerde den Vorspann doppelt berechnen.
    """
    frisch = max(input_tokens - cached_input_tokens, 0)
    p_in, p_cached, p_out = openai_prices(model)
    return (
        frisch / 1_000_000 * p_in
        + cached_input_tokens / 1_000_000 * p_cached
        + output_tokens / 1_000_000 * p_out
    )


def web_search_calls(response: object) -> int:
    """Wie oft die Antwort tatsaechlich gesucht hat (web_search_call-Eintraege)."""
    return sum(
        1
        for o in (getattr(response, "output", None) or [])
        if getattr(o, "type", "") == "web_search_call"
    )


def record(
    workspace_id: str,
    provider: str,
    operation: str,
    units: float,
    unit_kind: str,
    cost_usd: float | None = None,
    search_id: str | None = None,
) -> None:
    """Eine Verbrauchszeile schreiben. Wirft nie."""
    if units <= 0:
        return
    try:
        sb().table("api_usage").insert(
            {
                "workspace_id": workspace_id,
                "provider": provider,
                "operation": operation,
                "units": units,
                "unit_kind": unit_kind,
                "cost_usd": cost_usd,
                "search_id": search_id,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001 (siehe Modul-Docstring)
        log.warning(
            "Verbrauch (%s/%s) konnte nicht festgehalten werden: %s", provider, operation, exc
        )


def record_openai(
    workspace_id: str,
    operation: str,
    response: object,
    search_id: str | None = None,
) -> None:
    """Tokenverbrauch aus einer OpenAI-Antwort uebernehmen.

    Gezaehlt wird, was die Antwort selbst meldet, nicht was wir geschaetzt
    haetten. Ein Korrektur-Versuch schlaegt damit korrekt doppelt zu Buche.
    Fehlt das usage-Feld, wird nichts geschrieben statt geraten.

    input_tokens_details.cached_tokens geht nur in den PREIS ein, nicht in die
    Menge: die Tokens stecken schon in input_tokens (siehe openai_cost_usd).
    Fehlt das Feld, ist der gecachte Anteil 0, und es wird gerechnet wie
    bisher.
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    eingang = int(getattr(usage, "input_tokens", 0) or 0)
    ausgang = int(getattr(usage, "output_tokens", 0) or 0)
    details = getattr(usage, "input_tokens_details", None)
    gecacht = int(getattr(details, "cached_tokens", 0) or 0)
    gesamt = eingang + ausgang
    if gesamt <= 0:
        return
    model = str(getattr(response, "model", "") or "")
    record(
        workspace_id,
        "openai",
        operation,
        gesamt,
        "tokens",
        cost_usd=openai_cost_usd(eingang, ausgang, gecacht, model=model),
        search_id=search_id,
    )
    # Die Websuche als eigene Zeile: sie ist ein eigener Posten auf OpenAIs
    # Rechnung und soll im Buch nicht in den Tokens verschwinden.
    suchen = web_search_calls(response)
    if suchen:
        record(
            workspace_id,
            "openai",
            operation + "_web_search",
            suchen,
            "calls",
            cost_usd=suchen * OPENAI_USD_PER_WEB_SEARCH_CALL,
            search_id=search_id,
        )
