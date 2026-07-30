"""Pipeline 1 — Port von n8n 'Get_Businesses'.

1. Geocoding (location -> lat/lng)
2. Places Text Search mit Pagination (nextPageToken) bis max_results
3. Upsert in public.businesses (Dedupe via workspace_id+place_id statt Name)
4. Auto-Enrichment: enqueued find_decisionmaker + hunt_persons pro Business
"""
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from worker.db import sb
from worker.dedupe import businesses_to_skip
from worker.http_safety import raise_for_status_safe
from worker.keys import get_api_key
from worker.pipelines.discover import discover_companies, parse_discover_company
from worker.suppression import domain_of, load_suppression
from worker.queue import enqueue

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.priceLevel,"
    "places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,"
    "places.rating,nextPageToken"
)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30), reraise=True)
def geocode(location: str, api_key: str) -> dict:
    r = httpx.get(GEOCODE_URL, params={"address": location, "key": api_key}, timeout=30)
    raise_for_status_safe(r)
    results = r.json().get("results") or []
    if not results:
        raise ValueError(f"Geocoding ohne Treffer für '{location}'")
    return results[0]["geometry"]["location"]  # {lat, lng}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30), reraise=True)
def search_places_page(
    query: str, lat: float, lng: float, radius_m: int, api_key: str, page_token: str = ""
) -> dict:
    body: dict = {
        "textQuery": query,
        "locationBias": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius_m}
        },
    }
    if page_token:
        body["pageToken"] = page_token
    r = httpx.post(
        PLACES_URL,
        json=body,
        headers={"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": FIELD_MASK},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def parse_place(p: dict) -> dict:
    return {
        "place_id": p.get("id"),
        "name": (p.get("displayName") or {}).get("text") or "NA",
        "website": p.get("websiteUri"),
        "address": p.get("formattedAddress"),
        "phone_national": p.get("nationalPhoneNumber"),
        "phone_international": p.get("internationalPhoneNumber"),
        "rating": p.get("rating"),
        "price_level": p.get("priceLevel"),
    }


def matching_prior_search_ids(filters: dict, prior_searches: list[dict]) -> list[str]:
    """IDs frueherer Corporate-Suchen mit EXAKT denselben Filtern -- Grundlage
    fuer den Hunter-Discover-Offset (siehe _discover_offset): Hunter liefert
    fuer eine fixe Filterkombination ohne offset immer dieselbe erste
    Ergebnisseite, deshalb muss eine Wiederholung derselben Suche wissen, wie
    viele Firmen dafuer in diesem Workspace schon geholt wurden."""
    current = filters or {}
    return [s["id"] for s in prior_searches if (s.get("filters") or {}) == current]


def _discover_offset(search: dict, ws: str) -> int:
    """Wie viele Firmen wurden fuer exakt diese Filterkombination in diesem
    Workspace schon von Hunter Discover geholt. Ohne das wuerde eine
    Wiederholung derselben Suche immer wieder dieselbe erste Ergebnisseite
    abfragen und dank der Dedupe-Pruefung unten fast nur noch bereits
    bekannte Firmen sehen -- effektiv keine neuen Leads."""
    # Geloeschte Suchen zaehlen nicht mit: deren Firmen sperren die Dedupe-
    # Pruefung ebenfalls nicht mehr (siehe worker/dedupe.py). Wuerden sie hier
    # weiter mitzaehlen, wuerde der Offset an Ergebnissen vorbeispringen, die
    # gerade wieder aufgenommen werden duerfen.
    prior = (
        sb()
        .table("searches")
        .select("id, filters")
        .eq("workspace_id", ws)
        .eq("source", "corporate")
        .neq("id", search["id"])
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    matching_ids = matching_prior_search_ids(search.get("filters") or {}, prior)
    if not matching_ids:
        return 0
    count_res = (
        sb()
        .table("businesses")
        .select("id", count="exact", head=True)
        .eq("workspace_id", ws)
        .in_("search_id", matching_ids)
        .execute()
    )
    return count_res.count or 0


def run_corporate(search: dict, ws: str) -> None:
    """Corporate-Modus: Hunter Discover statt Google Maps."""
    api_key = get_api_key(ws, "hunter")
    offset = _discover_offset(search, ws)
    companies = discover_companies(search.get("filters") or {}, api_key, offset=offset)
    # Nur gegen wirklich noch relevante Firmen sperren, nicht gegen alles je
    # Gefundene -- siehe worker/dedupe.py.
    existing = {b["website"] for b in businesses_to_skip(ws) if b.get("website")}
    _, blocked_domains = load_suppression(ws)
    rows = []
    for c in companies:
        row = parse_discover_company(c)
        if not row["website"] or row["website"] in existing:
            continue
        d = domain_of(row["website"])
        if d and d in blocked_domains:
            continue
        rows.append(row | {"workspace_id": ws, "search_id": search["id"]})
        existing.add(row["website"])
        if len(rows) >= search["max_results"]:
            break
    if rows:
        sb().table("businesses").insert(rows).execute()


def run(job: dict) -> None:
    ws = job["workspace_id"]
    search_id = job["payload"]["search_id"]
    auto_enrich = job["payload"].get("auto_enrich", True)

    search = sb().table("searches").select("*").eq("id", search_id).single().execute().data
    # error mit zuruecksetzen: ein neuer Versuch (Queue-Retry oder Lead-Abo) darf
    # nicht die Fehlermeldung des vorherigen mitschleppen. Sonst steht am Ende
    # eine erfolgreich abgeschlossene Suche mit einer Fehlermeldung in der
    # Datenbank -- irrefuehrend fuer jeden, der sie liest, und eine Zeitbombe
    # fuer jede Oberflaeche, die error unabhaengig vom Status anzeigt.
    sb().table("searches").update({"status": "running", "error": None}).eq("id", search_id).execute()
    source = search.get("source", "maps")
    try:
        if source == "corporate":
            run_corporate(search, ws)
            _finish(search_id, ws, auto_enrich, source)
            return
        api_key = get_api_key(ws, "google_maps")
        loc = geocode(search["location"], api_key)
        known = {b["place_id"] for b in businesses_to_skip(ws) if b.get("place_id")}
        _, blocked_domains = load_suppression(ws)
        filters = search.get("filters") or {}
        pain_point_no_website = bool(filters.get("pain_point_no_website"))
        pain_point_max_rating = filters.get("pain_point_max_rating")
        collected, token, pages = 0, "", 0
        while collected < search["max_results"] and pages < 10:
            data = search_places_page(
                search["query"], loc["lat"], loc["lng"], search["radius_m"], api_key, token
            )
            pages += 1
            rows = []
            for pl in data.get("places") or []:
                if collected + len(rows) >= search["max_results"]:
                    break
                parsed = parse_place(pl)
                if not parsed["place_id"] or parsed["place_id"] in known:
                    continue
                d = domain_of(parsed.get("website"))
                if d and d in blocked_domains:
                    continue
                # Pain-Point-Filter: Firma muss dem gewaehlten Signal entsprechen,
                # sonst wird sie gar nicht erst aufgenommen (kein Zwischenzustand noetig).
                if pain_point_no_website and parsed.get("website"):
                    continue
                if pain_point_max_rating is not None:
                    rating = parsed.get("rating")
                    if rating is not None and rating > pain_point_max_rating:
                        continue
                known.add(parsed["place_id"])
                rows.append(parsed | {"workspace_id": ws, "search_id": search_id})
            if rows:
                sb().table("businesses").upsert(
                    rows, on_conflict="workspace_id,place_id"
                ).execute()
                collected += len(rows)
            token = data.get("nextPageToken") or ""
            if not token:
                break
        _finish(search_id, ws, auto_enrich, source)
    except Exception as exc:
        sb().table("searches").update({"status": "failed", "error": str(exc)[:1000]}).eq(
            "id", search_id
        ).execute()
        raise


def _finish(search_id: str, ws: str, auto_enrich: bool, source: str) -> None:
    sb().table("searches").update({"status": "completed"}).eq("id", search_id).execute()
    if not auto_enrich:
        return
    # Hunter-Domain-Search (hunt_persons) kostet pro Firma Credits. Bei "corporate"
    # (Hunter Discover) kam die Firma bereits aus einer kostenlosen Datenbank-Suche,
    # und find_decisionmaker (OpenAI) findet die Email dort ohnehin kostenlos -- ein
    # zusaetzlicher bezahlter Hunter-Abgleich waere doppelte Kosten fuer denselben
    # Zweck. Nur im Maps-Modus, wo es keine alternative kostenlose Firmen-Datenbank
    # gibt, bleibt Hunter als zweite, parallele Quelle aktiv (deckt Faelle ab, in
    # denen die KI-Websuche nichts findet).
    run_hunt_persons = source == "maps"
    for b in (
        sb()
        .table("businesses")
        .select("id,website")
        .eq("search_id", search_id)
        .eq("decisionmaker_status", "pending")
        .execute()
        .data
    ):
        enqueue(ws, "find_decisionmaker", {"business_id": b["id"]})
        if run_hunt_persons and b.get("website"):
            enqueue(ws, "hunt_persons", {"business_id": b["id"]})
        # personalize funktioniert jetzt auch ohne Website (Basis: company_summary aus
        # find_decisionmaker); wartet ueber NotReadyYet + Queue-Retry, falls die
        # Recherche noch laeuft.
        enqueue(ws, "personalize", {"business_id": b["id"]})
