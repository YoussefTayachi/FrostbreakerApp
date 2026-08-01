"""Corporate-Modus — Firmen per Hunter Discover API finden.

Filter: Branche (industry), Standort (Stadt + Land), Firmengröße (headcount),
Keywords, eingesetzte Technik (technology). Der Discover-Call selbst ist bei
Hunter kostenlos; Credits fallen erst bei der anschließenden Domain-Search
(hunt_persons) an.

Achtung beim technology-Filter: Hunter zählt ihn zu den "Advanced Discover
filters" und gibt ihn erst ab dem Starter-Plan frei (Free hat nur "Basic
filters"). Ein Free-Key bekommt darauf einen 4xx — deshalb HunterPlanError,
damit die Suche nicht als anonymer HTTP-Fehler endet.
Docs: https://hunter.io/api-documentation/v2#discover
"""
import logging

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from worker.http_safety import raise_for_status_safe

DISCOVER_URL = "https://api.hunter.io/v2/discover"

log = logging.getLogger(__name__)


class HunterPlanError(Exception):
    """Hunter lehnt einen Filter ab, den der Plan nicht enthaelt. Praktisch
    immer der Technologie-Filter: den gibt Hunter erst ab dem Starter-Plan
    frei. Eigene Klasse, damit daraus eine erklaerende Meldung wird statt
    "Suche fehlgeschlagen (400)"."""


def _is_retryable(exc: BaseException) -> bool:
    """Kein Sinn, einen deterministischen 4xx-Fehler (falsche Anfrage, falscher
    Key, Plan-Limit) dreimal mit Backoff zu wiederholen -- das kann beim naechsten
    Versuch nicht anders ausgehen. 429 (Rate Limit) ist die Ausnahme: das IST
    transient und verdient einen Retry."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if 400 <= status < 500 and status != 429:
            return False
    return True


def _is_client_error(exc: BaseException) -> bool:
    return (
        isinstance(exc, httpx.HTTPStatusError)
        and 400 <= exc.response.status_code < 500
        and exc.response.status_code != 429
    )


def _clean_slugs(raw: object) -> list[str]:
    """Technologie-Slugs aus dem Formular saeubern (entdoppelt, Reihenfolge
    stabil). Nicht gegen Hunters Katalog geprueft: der haelt rund 2.000
    Eintraege, die im Worker zu spiegeln hiesse, sie doppelt zu pflegen."""
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for value in raw:
        if not isinstance(value, str):
            continue
        slug = value.strip()
        if slug and slug not in out:
            out.append(slug)
    return out


def build_discover_body(filters: dict) -> dict:
    """Erzeugt den Discover-Request-Body aus unseren Such-Filtern (pure, testbar)."""
    body: dict = {}
    loc: dict = {}
    if filters.get("country"):
        loc["country"] = filters["country"]
    # state kennt Hunters Schema ausdruecklich nur fuer die USA -- und eine
    # US-Stadt OHNE Bundesstaat lehnt Hunter mit 400 ab (in Hunters eigener
    # Oberflaeche ist jede US-Stadt voll qualifiziert: "New York, New York,
    # United States"). Bei jedem anderen Land wird das Feld ignoriert bzw.
    # abgelehnt, deshalb hier hart an country == "US" gebunden.
    if filters.get("state") and filters.get("country") == "US":
        loc["state"] = filters["state"]
    if filters.get("city"):
        loc["city"] = filters["city"]
    if loc:
        body["headquarters_location"] = {"include": [loc]}
    if filters.get("industry"):
        body["industry"] = {"include": [filters["industry"]]}
    if filters.get("headcount"):
        body["headcount"] = [filters["headcount"]]
    if filters.get("keywords"):
        kw = [k.strip() for k in str(filters["keywords"]).split(",") if k.strip()]
        if kw:
            body["keywords"] = {"include": kw, "match": "any"}
    # Eingesetzte Technik der Firma -- so lassen sich z.B. gezielt Shopify-Shops
    # finden, statt sie ueber Branche/Keywords zu erraten. Die Slugs kommen
    # bereits in Hunters Schreibweise an (aufgeloest in
    # apps/web/lib/technologies.ts, weil eine Suche fest zu einer Quelle
    # gehoert). "match": "any" ist wichtig: Hunters Default ist "all", was bei
    # mehreren Shopsystemen (Shopify UND Shopware) nie einen Treffer haette.
    tech = _clean_slugs(filters.get("technologies"))
    if tech:
        body["technology"] = {"include": tech, "match": "any"}
    if not body:
        raise ValueError("Corporate-Suche braucht mindestens einen Filter")
    return body


def _raise_for_plan(exc: BaseException, filters: dict) -> None:
    """Einen 4xx in eine erklaerende Meldung uebersetzen, wenn die Suche einen
    Technologie-Filter enthielt.

    Hunter nennt in der Antwort nicht, welcher Filter zu hoch gegriffen war,
    deshalb wird hier nicht geraten: die Meldung sagt, dass der
    Technologie-Filter der wahrscheinliche Grund ist, ohne die anderen
    auszuschliessen. Ohne Technologie-Filter bleibt der urspruengliche Fehler
    unveraendert -- eine falsche Erklaerung waere schlechter als keine.
    """
    if not _is_client_error(exc) or not _clean_slugs(filters.get("technologies")):
        return
    raise HunterPlanError(
        "Hunter hat die Suche abgelehnt. Wahrscheinlichster Grund: der "
        "Technologie-Filter (z.B. Shopify) zaehlt bei Hunter zu den "
        "\"Advanced Discover filters\" und ist erst ab dem Starter-Plan "
        "enthalten -- der Free-Plan hat nur die Basisfilter. Entweder den "
        "Technologie-Filter abwaehlen oder den Hunter-Plan erweitern."
    ) from exc


def parse_discover_company(c: dict) -> dict:
    domain = c.get("domain")
    return {
        "place_id": None,
        "name": c.get("organization") or domain or "NA",
        "website": f"https://{domain}" if domain else None,
    }


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=30),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _discover_request(filters: dict, api_key: str, offset: int) -> list[dict]:
    # offset ist bei Hunter ein Query-Parameter, nicht Teil des JSON-Bodys (der
    # enthaelt nur die inhaltlichen Filter, siehe build_discover_body). limit
    # wird bewusst NICHT mitgeschickt: 100 ist ohnehin Hunters Default und
    # gleichzeitig das Maximum, und je weniger Pagination-Parameter in der
    # Anfrage stehen, desto weniger Angriffsflaeche fuer eine Plan-Ablehnung.
    params: dict = {"api_key": api_key}
    if offset:
        params["offset"] = offset
    r = httpx.post(DISCOVER_URL, params=params, json=build_discover_body(filters), timeout=30)
    raise_for_status_safe(r)
    return r.json().get("data") or []


def discover_companies(filters: dict, api_key: str, offset: int = 0) -> list[dict]:
    """Pagination ist bewusst nur eine Verbesserung, keine Voraussetzung.

    Hunter erlaubt offset laut Doku nur ab einem bestimmten Plan; ein Key ohne
    dieses Recht bekommt dort einen 4xx. Ohne diesen Fallback wuerde eine
    Wiederholung derselben Suche komplett fehlschlagen (Status "failed", null
    Firmen) -- schlechter als vor der Pagination, wo sie zumindest lief und die
    Dedupe-Pruefung die schon bekannten Firmen aussortierte. Deshalb: bei einem
    Client-Fehler MIT offset einmal ohne offset nachfassen. Ergebnis ist dann
    wieder Seite 1 (meist nichts Neues nach Dedupe), aber die Suche laeuft
    sauber durch statt zu sterben.

    Bewusst an JEDEM 4xx festgemacht statt an einer Textsuche nach
    "pagination": Hunters genaue Fehlerform fuer diesen Fall ist nicht
    dokumentiert, und ein Fallback-Versuch ohne offset ist auch bei einem
    anders gelagerten 4xx die richtige Reaktion -- schlaegt der zweite Versuch
    aus demselben Grund fehl, kommt der Fehler ohnehin unveraendert hoch.
    """
    try:
        if not offset:
            return _discover_request(filters, api_key, 0)
        try:
            return _discover_request(filters, api_key, offset)
        except Exception as exc:
            if not _is_client_error(exc):
                raise
            log.warning(
                "Hunter lehnte offset=%s ab (%s) -- faellt auf die erste Ergebnisseite "
                "zurueck. Fuer echtes Blaettern braucht es einen Hunter-Plan mit "
                "Pagination; ohne den liefert eine Wiederholung derselben Filter "
                "kaum neue Firmen.",
                offset,
                exc,
            )
            return _discover_request(filters, api_key, 0)
    except Exception as exc:
        # Bewusst erst hier, nach dem Offset-Fallback: sonst wuerde eine
        # abgelehnte Pagination dem Technologie-Filter angelastet.
        _raise_for_plan(exc, filters)
        raise
