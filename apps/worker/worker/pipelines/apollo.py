"""Apollo.io — Firmen UND Entscheider samt verifizierter E-Mail in einem Lauf.

Anders als die beiden bestehenden Quellen ist das keine reine Firmensuche:
Apollos People-Search liefert die Person (Name, Titel, E-Mail) zusammen mit
ihrer Firma zurueck. Deshalb schreibt diese Pipeline beides -- businesses UND
contacts -- und die Anreicherungsjobs (find_decisionmaker/hunt_persons)
entfallen fuer Apollo-Suchen komplett. Genau darin liegt der Zweck der
Integration: die KI-Websuche findet gemessen nur bei ~22% der Firmen eine
E-Mail (siehe Kommentar in get_businesses.py), Apollo liefert per
contact_email_status-Filter ausschliesslich Personen, fuer die bereits eine
verifizierte Adresse vorliegt.

Kosten/Limits, die das Design bestimmen (Apollo-Doku, Stand 2026-08):
  * Ein Master-API-Key existiert erst ab Apollos Organization-Plan. Ein Key
    aus einem kleineren Plan bekommt 403 -- das wird als klare Meldung
    weitergegeben, nicht als "keine Ergebnisse" verschluckt.
  * People-Search kostet 1 Credit pro Seite (bis 100 Treffer), nicht pro
    Person. Grosse Suchen sind dadurch guenstig; teuer ist erst das
    Freischalten persoenlicher Adressen (bulk_match).
  * Harte Anzeigegrenze bei Apollo: 100 Treffer/Seite, max. 500 Seiten.
    Unsere Grenzen liegen bewusst weit darunter (siehe Konstanten).
  * Rate Limit rund 50 Anfragen/Minute, planabhaengig. PAGE_PAUSE_S haelt
    Abstand, statt in den 429 zu laufen und sich auf Retries zu verlassen.

Docs: https://docs.apollo.io/reference/people-api-search
"""
import logging
import time

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from worker.http_safety import raise_for_status_safe

SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/search"
BULK_MATCH_URL = "https://api.apollo.io/api/v1/people/bulk_match"

PER_PAGE = 100
# 1000 Leads pro Suche = 10 Seiten. Bewusst grosszuegig (Apollo erlaubt
# technisch 500 Seiten), aber endlich: eine versehentlich zu breite Suche soll
# nicht das ganze Monatskontingent des Kunden verbrauchen.
APOLLO_MAX_PER_SEARCH = 1000
# Zweite, uebergeordnete Bremse pro Workspace und Tag -- greift ueber mehrere
# Suchen hinweg (z.B. Fan-out mit vielen Kombinationen oder ein Lead-Abo, das
# taeglich laeuft).
APOLLO_MAX_PER_DAY = 5000
# Apollos Rate Limit liegt bei rund 50 Anfragen/Minute. 1,5s Abstand liegt mit
# ~40/min sicher darunter und macht selbst eine 10-Seiten-Suche in 15s.
PAGE_PAUSE_S = 1.5
# bulk_match nimmt laut Doku maximal 10 Personen pro Aufruf.
BULK_MATCH_CHUNK = 10

log = logging.getLogger(__name__)


class ApolloPlanError(Exception):
    """Apollo verweigert den Zugriff auf Key-Ebene (403) -- praktisch immer ein
    Key ohne Master-API-Recht (nur im Organization-Plan enthalten). Eigene
    Klasse, damit get_businesses daraus eine erklaerende Fehlermeldung machen
    kann statt eines rohen HTTP-Fehlers."""


class ApolloDailyCapReached(Exception):
    """Tageskontingent (APOLLO_MAX_PER_DAY) fuer diesen Workspace erschoepft."""


def _is_retryable(exc: BaseException) -> bool:
    """Gleiche Logik wie in discover.py: ein deterministischer 4xx wird beim
    dritten Versuch nicht ploetzlich zum Erfolg. 429 ist die Ausnahme -- das
    IST transient."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if 400 <= status < 500 and status != 429:
            return False
    return True


# Apollos vollstaendige, gueltige Werte fuer person_seniorities. Ein Wert
# ausserhalb dieser Liste ist keine Geschmacksfrage, sondern eine ungueltige
# Anfrage -- deshalb wird jede Auswahl aus dem Formular hier gegengeprueft
# statt ungefiltert durchgereicht (siehe _valid_seniorities).
APOLLO_SENIORITIES = [
    "owner",
    "founder",
    "c_suite",
    "vp",
    "head",
    "director",
    "manager",
    "senior",
    "entry",
    "intern",
]

# Standardauswahl, wenn das Formular keine trifft: Senioritaeten, die als
# Entscheider gelten. Ohne diese Einschraenkung liefert Apollo auch
# Praktikanten und Sachbearbeiter -- fuer Cold Outreach wertlos, aber sie
# wuerden Credits und das Tageskontingent verbrauchen.
DECISIONMAKER_SENIORITIES = ["owner", "founder", "c_suite", "vp", "head", "director"]


def _valid_seniorities(raw: object) -> list[str]:
    """Nur von Apollo anerkannte Werte weitergeben, Reihenfolge stabil halten.
    Bleibt nach dem Filtern nichts uebrig, gilt die Entscheider-Vorauswahl --
    eine Suche ohne Senioritaets-Einschraenkung wuerde quer durch alle
    Hierarchiestufen Credits verbrauchen."""
    if not isinstance(raw, list):
        return list(DECISIONMAKER_SENIORITIES)
    picked = [s for s in APOLLO_SENIORITIES if s in raw]
    return picked or list(DECISIONMAKER_SENIORITIES)


def _employee_range(headcount: str | None) -> str | None:
    """Unsere Formularwerte ("11-50", "10001+") in Apollos Range-Schreibweise
    ("11,50", "10001,1000000") uebersetzen."""
    if not headcount:
        return None
    value = headcount.strip()
    if value.endswith("+"):
        return f"{value[:-1]},1000000"
    if "-" in value:
        low, _, high = value.partition("-")
        return f"{low},{high}"
    return None


def build_people_search_body(filters: dict, page: int) -> dict:
    """Erzeugt den People-Search-Body aus unseren Such-Filtern (pure, testbar).

    contact_email_status=verified ist der Kern der Integration: Apollo gibt so
    ausschliesslich Personen zurueck, fuer die eine verifizierte E-Mail
    vorliegt. Ohne diesen Filter kaeme derselbe Trefferquoten-Verlust zurueck,
    den Apollo gerade loesen soll.
    """
    body: dict = {
        "page": page,
        "per_page": PER_PAGE,
        "contact_email_status": ["verified"],
        "person_seniorities": _valid_seniorities(filters.get("apollo_seniorities")),
    }
    titles = [t.strip() for t in str(filters.get("person_titles") or "").split(",") if t.strip()]
    if titles:
        body["person_titles"] = titles
    # Standort der FIRMA, nicht der Person: gesucht sind Unternehmen in einem
    # Markt: wo die Person privat sitzt, ist fuer die Zielgruppe unerheblich.
    locations = [
        loc
        for loc in (filters.get("apollo_locations") or [])
        if isinstance(loc, str) and loc.strip()
    ]
    if locations:
        body["organization_locations"] = [loc.strip() for loc in locations]
    keywords = [k.strip() for k in str(filters.get("keywords") or "").split(",") if k.strip()]
    if keywords:
        body["q_organization_keyword_tags"] = keywords
    employee_range = _employee_range(filters.get("headcount"))
    if employee_range:
        body["organization_num_employees_ranges"] = [employee_range]
    domains = [d.strip() for d in str(filters.get("domains") or "").split(",") if d.strip()]
    if domains:
        body["q_organization_domains"] = "\n".join(domains)
    if not (titles or locations or keywords or employee_range or domains):
        raise ValueError("Apollo-Suche braucht mindestens einen Filter")
    return body


def is_masked_email(email: str | None) -> bool:
    """Apollo maskiert Adressen, die der Plan nicht freigeschaltet hat, als
    "email_not_unlocked@domain.com". Unveraendert gespeichert waere das eine
    garantiert bouncende Fantasieadresse -- solche Treffer muessen entweder
    freigeschaltet oder verworfen werden."""
    if not email:
        return True
    return "email_not_unlocked" in email.lower() or "not_unlocked" in email.lower()


def parse_apollo_person(person: dict) -> dict | None:
    """Eine Apollo-Person in unser {business, contact}-Paar uebersetzen.

    Gibt None zurueck, wenn die Firma nicht identifizierbar ist: ohne Domain
    laesst sich weder entdoppeln noch spaeter personalisieren (die
    Website-Quelle im AI-Agent braucht sie), und ohne Namen gibt es keinen
    Ansprechpartner.
    """
    org = person.get("organization") or {}
    domain = (org.get("primary_domain") or "").strip() or None
    website = org.get("website_url") or (f"https://{domain}" if domain else None)
    name = (org.get("name") or "").strip() or domain
    full_name = (person.get("name") or "").strip() or None
    if not name or not full_name:
        return None

    phone = (org.get("primary_phone") or {}).get("number")
    business = {
        # Apollo kennt keine Google-place_id. Wie im Corporate-Modus bleibt das
        # Feld leer und die Entdopplung laeuft ueber die Website/Domain.
        "place_id": None,
        "name": name,
        "website": website,
        "address": ", ".join(
            p for p in [org.get("city"), org.get("state"), org.get("country")] if p
        )
        or None,
        "phone_national": phone,
    }
    email = person.get("email")
    contact = {
        "apollo_id": person.get("id"),
        "full_name": full_name,
        "first_name": person.get("first_name") or full_name.split(" ", 1)[0],
        "last_name": person.get("last_name"),
        "title": person.get("title"),
        "seniority": person.get("seniority"),
        "department": (person.get("departments") or [None])[0],
        "email": None if is_masked_email(email) else email,
        "email_verification_status": person.get("email_status"),
        "linkedin": person.get("linkedin_url"),
        "twitter": person.get("twitter_url"),
        "facebook": person.get("facebook_url"),
        "source": "apollo",
    }
    return {"business": business, "contact": contact}


def _headers(api_key: str) -> dict:
    # Key im Header, nicht als Query-Parameter: so kann er gar nicht erst in
    # einer Fehler-URL landen (vgl. worker/http_safety.py, das genau dieses
    # Problem bei Hunter/Google nachtraeglich entschaerfen muss).
    return {"x-api-key": api_key, "Content-Type": "application/json", "Accept": "application/json"}


def _raise_for_plan(exc: httpx.HTTPStatusError) -> None:
    if exc.response.status_code in (401, 403):
        raise ApolloPlanError(
            "Apollo hat den Key abgelehnt (403). Der programmatische API-Zugriff "
            "(Master-API-Key) ist bei Apollo erst im Organization-Plan enthalten -- "
            "ein Key aus Free/Basic/Professional funktioniert hier nicht."
        ) from exc


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=30),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def search_people(filters: dict, api_key: str, page: int) -> list[dict]:
    body = build_people_search_body(filters, page)
    try:
        r = httpx.post(SEARCH_URL, json=body, headers=_headers(api_key), timeout=60)
        raise_for_status_safe(r)
    except httpx.HTTPStatusError as exc:
        _raise_for_plan(exc)
        raise
    return r.json().get("people") or []


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=30),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _bulk_match_chunk(apollo_ids: list[str], api_key: str) -> dict[str, str]:
    """Freischalten der Adressen fuer eine Handvoll Personen. Rueckgabe:
    apollo_id -> E-Mail (nur echte, freigeschaltete Adressen)."""
    body = {
        "details": [{"id": pid} for pid in apollo_ids],
        "reveal_personal_emails": True,
    }
    try:
        r = httpx.post(BULK_MATCH_URL, json=body, headers=_headers(api_key), timeout=60)
        raise_for_status_safe(r)
    except httpx.HTTPStatusError as exc:
        _raise_for_plan(exc)
        raise
    out: dict[str, str] = {}
    for matched in r.json().get("matches") or []:
        if not matched:
            continue
        email = matched.get("email")
        pid = matched.get("id")
        if pid and email and not is_masked_email(email):
            out[pid] = email
    return out


def reveal_emails(apollo_ids: list[str], api_key: str) -> dict[str, str]:
    """bulk_match in Haeppchen von BULK_MATCH_CHUNK. Ein fehlgeschlagenes
    Haeppchen darf die uebrigen nicht mitnehmen -- die bereits freigeschalteten
    Adressen sind bezahlt und sollen nicht verfallen. Ein ApolloPlanError
    dagegen betrifft jeden weiteren Aufruf gleichermassen und bricht ab."""
    revealed: dict[str, str] = {}
    for i in range(0, len(apollo_ids), BULK_MATCH_CHUNK):
        chunk = apollo_ids[i : i + BULK_MATCH_CHUNK]
        try:
            revealed.update(_bulk_match_chunk(chunk, api_key))
        except ApolloPlanError:
            raise
        except Exception as exc:  # noqa: BLE001 -- absichtlich breit, s. Docstring
            log.warning("Apollo bulk_match fuer %s Personen fehlgeschlagen: %s", len(chunk), exc)
        if i + BULK_MATCH_CHUNK < len(apollo_ids):
            time.sleep(PAGE_PAUSE_S)
    return revealed


def collect_people(filters: dict, api_key: str, limit: int) -> list[dict]:
    """Blaettert People-Search bis limit erreicht ist oder Apollo nichts mehr
    liefert. Entdoppelt innerhalb des Laufs anhand der Apollo-Personen-ID:
    ueberlappende Seiten sind bei sich aendernden Ergebnismengen normal und
    wuerden sonst dieselbe Person mehrfach anlegen."""
    capped = min(limit, APOLLO_MAX_PER_SEARCH)
    out: list[dict] = []
    seen_ids: set[str] = set()
    page = 1
    while len(out) < capped and page <= (APOLLO_MAX_PER_SEARCH // PER_PAGE):
        people = search_people(filters, api_key, page)
        if not people:
            break
        for person in people:
            pid = person.get("id")
            if pid and pid in seen_ids:
                continue
            if pid:
                seen_ids.add(pid)
            parsed = parse_apollo_person(person)
            if parsed:
                out.append(parsed)
            if len(out) >= capped:
                break
        if len(people) < PER_PAGE:
            break  # letzte Seite
        page += 1
        if len(out) < capped:
            time.sleep(PAGE_PAUSE_S)
    return out
