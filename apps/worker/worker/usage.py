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

# Anthropic, Listenpreise fuer CLAUDE_MODEL aus
# worker/pipelines/personalize.py. Stand 2026-08-22, nachgesehen auf
# https://platform.claude.com/docs/en/about-claude/pricing (Tabelle
# "Model pricing", Zeile "Claude Opus 5"):
#
#   Base Input $5 / MTok    5m Cache Writes $6.25 / MTok
#   Cache Hits $0.50 / MTok Output $25 / MTok
#
# ACHTUNG: diese vier Zahlen gelten je MODELL, nicht je Anbieter. Wer
# CLAUDE_MODEL in personalize.py aendert, muss sie hier mitaendern, sonst
# rechnet die Kostenzeile still mit dem Preis eines anderen Modells.
ANTHROPIC_USD_PER_1M_INPUT = 5.00
ANTHROPIC_USD_PER_1M_OUTPUT = 25.00
# Zwei eigene Preise, weil Anthropic Cache-Tokens getrennt meldet und getrennt
# abrechnet. Sie hier zum normalen Eingang zu zaehlen waere doppelt falsch:
# ein Cache-Treffer kostet ein Zehntel, ein Cache-Schreibvorgang das 1,25fache
# des Eingangspreises. Wir schreiben Beispiele als gecachten Vorspann (siehe
# generate_claude), also treten beide Posten wirklich auf.
#
# Der 5-Minuten-Preis, nicht der 1-Stunden-Preis: generate_claude setzt
# cache_control ohne ttl, und das ist laut derselben Seite die 5-Minuten-Form.
ANTHROPIC_USD_PER_1M_CACHE_WRITE = 6.25
ANTHROPIC_USD_PER_1M_CACHE_READ = 0.50


def openai_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens / 1_000_000 * OPENAI_USD_PER_1M_INPUT
        + output_tokens / 1_000_000 * OPENAI_USD_PER_1M_OUTPUT
    )


def anthropic_cost_usd(
    input_tokens: int,
    output_tokens: int,
    cache_write_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    return (
        input_tokens / 1_000_000 * ANTHROPIC_USD_PER_1M_INPUT
        + output_tokens / 1_000_000 * ANTHROPIC_USD_PER_1M_OUTPUT
        + cache_write_tokens / 1_000_000 * ANTHROPIC_USD_PER_1M_CACHE_WRITE
        + cache_read_tokens / 1_000_000 * ANTHROPIC_USD_PER_1M_CACHE_READ
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


def record_claude(
    workspace_id: str,
    operation: str,
    response: object,
    search_id: str | None = None,
) -> None:
    """Tokenverbrauch aus einer Anthropic-Antwort uebernehmen.

    Gleiche Bauform wie record_openai: gezaehlt wird, was die Antwort selbst
    meldet, nicht was wir geschaetzt haetten. Fehlt das usage-Feld oder steht
    nichts drin, wird nichts geschrieben statt geraten.

    Der Unterschied zu OpenAI sind die zwei zusaetzlichen Felder
    cache_creation_input_tokens und cache_read_input_tokens. Anthropic zaehlt
    sie NEBEN input_tokens, nicht darin: laut
    https://platform.claude.com/docs/en/api/rate-limits (Abschnitt
    "Cache-aware ITPM", nachgesehen 2026-08-22) gilt

        total_input_tokens = cache_read + cache_creation + input_tokens

    input_tokens ist also nur der Rest hinter dem letzten Cache-Punkt. Wer die
    beiden Felder weglaesst, meldet bei einem gecachten Vorspann fast nichts
    mehr als Verbrauch, obwohl die Tokens sehr wohl abgerechnet werden. Sie
    haben eigene Preise (siehe oben), deshalb gehen sie mit eigenen Saetzen in
    die Kostenzahl ein und nicht pauschal zum Eingangspreis.
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    eingang = int(getattr(usage, "input_tokens", 0) or 0)
    ausgang = int(getattr(usage, "output_tokens", 0) or 0)
    cache_write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    cache_read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
    gesamt = eingang + ausgang + cache_write + cache_read
    if gesamt <= 0:
        return
    record(
        workspace_id,
        "anthropic",
        operation,
        gesamt,
        "tokens",
        cost_usd=anthropic_cost_usd(eingang, ausgang, cache_write, cache_read),
        search_id=search_id,
    )
