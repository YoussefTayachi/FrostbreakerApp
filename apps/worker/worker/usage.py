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
# Hunter und Apollo rechnen in Credits ab, deren Eurowert vom gebuchten Tarif
# abhaengt und deshalb nicht allgemein bezifferbar ist. Wir halten die Credits
# fest und lassen den Betrag offen, statt einen Tarif zu unterstellen.
NEVERBOUNCE_USD_PER_CHECK = 0.008


def openai_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens / 1_000_000 * OPENAI_USD_PER_1M_INPUT
        + output_tokens / 1_000_000 * OPENAI_USD_PER_1M_OUTPUT
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
        log.warning("Verbrauch (%s/%s) konnte nicht festgehalten werden: %s", provider, operation, exc)


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
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    eingang = int(getattr(usage, "input_tokens", 0) or 0)
    ausgang = int(getattr(usage, "output_tokens", 0) or 0)
    gesamt = eingang + ausgang
    if gesamt <= 0:
        return
    record(
        workspace_id,
        "openai",
        operation,
        gesamt,
        "tokens",
        cost_usd=openai_cost_usd(eingang, ausgang),
        search_id=search_id,
    )
