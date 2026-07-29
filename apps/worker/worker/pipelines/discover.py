"""Corporate-Modus — Firmen per Hunter Discover API finden.

Filter: Branche (industry), Standort (Stadt + Land), Firmengröße (headcount),
Keywords. Der Discover-Call selbst ist bei Hunter kostenlos; Credits fallen
erst bei der anschließenden Domain-Search (hunt_persons) an.
Docs: https://hunter.io/api-documentation/v2#discover
"""
import httpx
from tenacity import retry, retry_if_not_exception_type, stop_after_attempt, wait_exponential

DISCOVER_URL = "https://api.hunter.io/v2/discover"


class DiscoverPaginationError(Exception):
    """Hunter lehnt offset/limit ab -- laut Doku nur auf einem Premium-Plan
    aenderbar, ein Free-Plan-Key bekommt bei offset>0 einen "pagination_error".
    Eigene Exception, damit run_corporate das von echten (retry-werten)
    Netzwerk-/Serverfehlern unterscheiden und dem Nutzer eine klare Meldung
    statt eines generischen Fehlers zeigen kann."""


def build_discover_body(filters: dict) -> dict:
    """Erzeugt den Discover-Request-Body aus unseren Such-Filtern (pure, testbar)."""
    body: dict = {}
    loc: dict = {}
    if filters.get("country"):
        loc["country"] = filters["country"]
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
    if not body:
        raise ValueError("Corporate-Suche braucht mindestens einen Filter")
    return body


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
    retry=retry_if_not_exception_type(DiscoverPaginationError),
    reraise=True,
)
def discover_companies(filters: dict, api_key: str, offset: int = 0) -> list[dict]:
    # offset/limit sind bei Hunter Query-Parameter, nicht Teil des JSON-Bodys
    # (der enthaelt nur die inhaltlichen Filter, siehe build_discover_body).
    params: dict = {"api_key": api_key, "limit": 100}
    if offset:
        params["offset"] = offset
    r = httpx.post(DISCOVER_URL, params=params, json=build_discover_body(filters), timeout=30)
    if r.status_code == 400:
        errors = (r.json() or {}).get("errors") or []
        if any(e.get("code") == "pagination_error" for e in errors):
            raise DiscoverPaginationError(
                "Hunter erlaubt offset/limit nur auf einem Premium-Plan -- "
                "diese Suche kann nicht weiter als die erste Ergebnisseite blaettern."
            )
    r.raise_for_status()
    return r.json().get("data") or []
