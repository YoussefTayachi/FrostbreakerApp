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

Kosten/Limits, die das Design bestimmen (aus dem eingeloggten Apollo-Account
abgelesen, Stand 2026-08):
  * Der Free-Plan sperrt mixed_people/api_search UND people/bulk_match, also
    genau die zwei Endpunkte dieser Pipeline. API-Zugang beginnt bei Apollos
    Basic-Plan. Ein Master-Key hebt die Plan-Sperre NICHT auf -- er erweitert
    nur den Umfang innerhalb dessen, was der Plan hergibt. Der 403 wird
    deshalb als erklaerende Meldung weitergegeben (ApolloPlanError), nicht als
    "keine Ergebnisse" verschluckt.
  * People-Search kostet 1 Credit pro Seite (bis 100 Treffer), nicht pro
    Person. Grosse Suchen sind dadurch guenstig; teuer ist erst das
    Freischalten persoenlicher Adressen (bulk_match: 1 Credit pro E-Mail,
    8 pro Telefonnummer -- Telefonnummern fragen wir bewusst nicht ab).
  * Harte Anzeigegrenze bei Apollo: 100 Treffer/Seite, max. 500 Seiten.
    Unsere Grenzen liegen bewusst weit darunter (siehe Konstanten).
  * Rate Limits (Free): 50/Minute, 200/Stunde, 600/Tag. PAGE_PAUSE_S haelt
    Abstand, statt in den 429 zu laufen und sich auf Retries zu verlassen.
  * Der Key gehoert in den x-api-key-Header: Apollo hat das Mitgeben als
    URL-Parameter als "deprecated soon" angekuendigt.

Docs: https://docs.apollo.io/reference/people-api-search
"""
import logging
import time

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from worker.http_safety import raise_for_status_safe

# api_search, NICHT mixed_people/search: letzteres ist der Endpunkt hinter
# Apollos eigener Oberflaeche, dokumentiert und fuer API-Keys freigegeben ist
# ausschliesslich api_search.
SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search"
BULK_MATCH_URL = "https://api.apollo.io/api/v1/people/bulk_match"
# Firmendaten zu einer Domain. Kostet keine Credits (Apollos
# Verbrauchsuebersicht kennt nur "Exports", also das Freischalten von
# Adressen) und liefert das, was die Personensuche gerade nicht mitgibt:
# short_description, keywords und Branche.
BULK_ORG_URL = "https://api.apollo.io/api/v1/organizations/bulk_enrich"
# Kostet keine Credits und beruehrt keine Suchdaten -- reiner Lebenszeichen-Test
# fuer einen Key (siehe apps/web/app/api/apollo/health).
HEALTH_URL = "https://api.apollo.io/api/v1/auth/health"

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
# organizations/bulk_enrich ebenfalls 10 Domains pro Aufruf.
BULK_ORG_CHUNK = 10
# Obergrenze fuer die Firmenbeschreibung. Der Personalisierungs-Prompt
# braucht Anhaltspunkte, keinen kompletten Unternehmensauftritt -- und lange
# Texte kosten bei jedem Lead OpenAI-Tokens.
MAX_SUMMARY_CHARS = 2000
# Wie viele Such-Kandidaten pro gewuenschtem Lead gesammelt werden. Die Suche
# ist kostenlos, das Anreichern nicht -- ein Puffer kostet also nichts und
# faengt Kandidaten ab, die beim bulk_match doch keine Domain oder Adresse
# liefern. Zu gross waere trotzdem unsinnig: es verlaengert nur die Laufzeit.
CANDIDATE_OVERFETCH = 3

log = logging.getLogger(__name__)


class ApolloPlanError(Exception):
    """Apollo verweigert den Zugriff (401/403) -- praktisch immer ein Key aus
    einem Plan, der den Endpunkt nicht enthaelt (Free sperrt Personensuche und
    bulk_match). Eigene Klasse, damit get_businesses daraus eine erklaerende
    Fehlermeldung machen kann statt eines rohen HTTP-Fehlers."""


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
    # In einer frueheren Fassung hier faelschlich entfernt: eine Websuche hatte
    # "partner" nicht gelistet. Apollos eigene Oberflaeche fuehrt es sehr wohl
    # (in einer Beispielsuche Germany+ecommerce mit 2.300 Treffern), es ist
    # gueltig und fuer Kanzleien/Beratungen sogar die wichtigste Stufe.
    "partner",
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
DECISIONMAKER_SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director"]


def _valid_seniorities(raw: object) -> list[str]:
    """Nur von Apollo anerkannte Werte weitergeben, Reihenfolge stabil halten.
    Bleibt nach dem Filtern nichts uebrig, gilt die Entscheider-Vorauswahl --
    eine Suche ohne Senioritaets-Einschraenkung wuerde quer durch alle
    Hierarchiestufen Credits verbrauchen."""
    if not isinstance(raw, list):
        return list(DECISIONMAKER_SENIORITIES)
    picked = [s for s in APOLLO_SENIORITIES if s in raw]
    return picked or list(DECISIONMAKER_SENIORITIES)


# Apollos eigene elf Stufen aus dem "# Employees"-Filter. Apollo akzeptiert
# technisch beliebige untere,obere Grenzen -- eine eigene Stufung waere aber ein
# stiller Unterschied zu dem, was der Kunde in Apollo selbst sieht ("11-50" ist
# dort keine Option). Muss mit APOLLO_EMPLOYEE_RANGES in
# apps/web/app/new-search-form.tsx uebereinstimmen.
APOLLO_EMPLOYEE_RANGES = [
    "1-10", "11-20", "21-50", "51-100", "101-200", "201-500",
    "501-1000", "1001-2000", "2001-5000", "5001-10000", "10001+",
]


def _employee_range(headcount: str | None) -> str | None:
    """Formularwert ("11-20", "10001+") in Apollos Range-Schreibweise
    ("11,20", "10001,1000000"). Unbekannte Stufen werden verworfen statt
    umgerechnet -- ein Wert, den Apollos Oberflaeche nicht kennt, waere eine
    stille Abweichung von dem, was der Kunde dort sieht."""
    if not headcount:
        return None
    value = headcount.strip()
    if value not in APOLLO_EMPLOYEE_RANGES:
        return None
    if value.endswith("+"):
        return f"{value[:-1]},1000000"
    low, _, high = value.partition("-")
    return f"{low},{high}"


def _technology_uids(raw: object) -> list[str]:
    """Technologie-Slugs aus dem Formular saeubern.

    Die Auswahl entsteht in apps/web/lib/technologies.ts und kommt hier bereits
    in Apollos Schreibweise an (dort aufgeloest, weil eine Suche fest zu einer
    Quelle gehoert). Gegengeprueft wird nicht: Apollos Katalog hat ueber 10.000
    Eintraege, den im Worker zu spiegeln hiesse, ihn doppelt zu pflegen und bei
    jeder Apollo-Erweiterung gueltige Werte auszusperren. Ein unbekannter Slug
    schadet bei Apollo auch nicht -- er grenzt die Suche nur weiter ein.
    Entdoppelt bei stabiler Reihenfolge, damit der Body testbar bleibt.
    """
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


def build_people_search_body(filters: dict, page: int, per_page: int = PER_PAGE) -> dict:
    """Erzeugt den People-Search-Body aus unseren Such-Filtern (pure, testbar).

    contact_email_status=verified ist der Kern der Integration: Apollo gibt so
    ausschliesslich Personen zurueck, fuer die eine verifizierte E-Mail
    vorliegt. Ohne diesen Filter kaeme derselbe Trefferquoten-Verlust zurueck,
    den Apollo gerade loesen soll.

    per_page ist einstellbar, weil die Diagnose und der Trefferzaehler nur die
    Gesamtzahl brauchen: mit per_page=1 kostet die Antwort einen Bruchteil der
    Uebertragung und liefert total_entries genauso.

    MUSS mit buildApolloSearchBody() in apps/web/lib/apollo-query.ts
    uebereinstimmen -- die Oberflaeche zaehlt damit die Treffer vor dem Start,
    und eine Abweichung waere eine Zusage, die die Suche nicht einloest.
    """
    body: dict = {
        "page": page,
        "per_page": per_page,
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
        # Der Parameter heisst q_organization_domains_LIST und nimmt ein Array.
        # Vorher stand hier q_organization_domains mit newline-getrenntem String
        # -- den kennt die People-Search nicht, er wurde stillschweigend ignoriert.
        body["q_organization_domains_list"] = domains
    # Eingesetzte Technik der Firma -- damit laesst sich ein Shopify-Shop direkt
    # ansprechen, statt ihn ueber das Keyword "ecommerce" zu erraten. "any_of"
    # ist Absicht: mehrere Shopsysteme sind ein ODER (Shopify ODER Shopware),
    # ein UND haette bei Shopsystemen praktisch nie einen Treffer.
    technologies = _technology_uids(filters.get("technologies"))
    if technologies:
        body["currently_using_any_of_technology_uids"] = technologies
    if not (titles or locations or keywords or employee_range or domains or technologies):
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
    """Einen ANGEREICHERTEN Apollo-Datensatz (ein Eintrag aus matches[] von
    people/bulk_match) in unser {business, contact}-Paar uebersetzen.

    Wichtig: Das funktioniert NUR mit der Antwort von bulk_match, nicht mit der
    von mixed_people/api_search. Die Suche liefert bewusst nur eine
    anonymisierte Vorschau -- first_name, last_name_obfuscated, has_email und
    ein organization-Objekt, das ausser dem Namen ausschliesslich has_*-Flags
    enthaelt. Weder name noch email noch primary_domain stehen darin. Genau
    daran ist die Integration anfangs gescheitert: der Parser wurde auf die
    Suchantwort angewendet, fand nie einen vollen Namen, verwarf jede Person --
    und die Suche endete ohne Fehler mit null Treffern (siehe collect_people).

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


def build_company_summary(org: dict) -> str | None:
    """Aus Apollos Firmendatensatz die Textgrundlage fuer die Personalisierung.

    Beschreibung UND Stichwoerter, weil beide etwas anderes leisten: die
    Beschreibung liefert den Selbstanspruch der Firma, die Stichwoerter die
    konkreten Aufhaenger ("collagen peptides", "nsf certified for sport"), an
    denen eine Eroeffnungszeile festmachen kann. Nur eines von beidem waere
    entweder blumig oder eine Schlagwortwolke.
    """
    if not isinstance(org, dict):
        return None
    parts: list[str] = []
    desc = (org.get("short_description") or "").strip()
    if desc:
        parts.append(desc[:MAX_SUMMARY_CHARS])
    keywords = [k for k in (org.get("keywords") or []) if isinstance(k, str) and k.strip()]
    if keywords:
        parts.append("Stichwoerter: " + ", ".join(keywords[:25]))
    industry = (org.get("industry") or "").strip()
    if industry:
        parts.append("Branche: " + industry)
    text = "\n\n".join(parts).strip()
    # Zu duenn ist schlechter als nichts: personalize faellt dann auf den
    # Website-Text zurueck, statt aus zwei Worten einen Satz zu erfinden.
    return text if len(text) >= 80 else None


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=30),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _bulk_enrich_chunk(domains: list[str], api_key: str) -> dict[str, dict]:
    r = httpx.post(
        BULK_ORG_URL, json={"domains": domains}, headers=_headers(api_key), timeout=60
    )
    try:
        raise_for_status_safe(r)
    except httpx.HTTPStatusError as exc:
        _raise_for_plan(exc)
        raise
    out: dict[str, dict] = {}
    for org in r.json().get("organizations") or []:
        if not isinstance(org, dict):
            continue
        key = (org.get("primary_domain") or "").strip().lower()
        if key:
            out[key] = org
    return out


def fetch_company_summaries(domains: list[str], api_key: str) -> dict[str, str]:
    """Firmenbeschreibungen zu Domains holen, Domain -> Text.

    Warum das ueberhaupt gebraucht wird: Apollos Personensuche liefert im
    organization-Objekt ausschliesslich den Namen und ein paar has_*-Flags,
    also nichts, woraus sich eine Eroeffnungszeile schreiben liesse. Ohne
    diesen Schritt faellt personalize auf den Website-Text zurueck -- und den
    holen die meisten Shops nicht heraus: gemessen an einer echten Suche
    antworteten 12 von 12 Seiten mit HTTP 429 auf unseren Crawler, am Ende
    hatten nur 10 von 45 Firmen eine Zeile. Ueber diesen Endpunkt waren es
    35 von 35.

    Kostet keine Credits: Apollo rechnet nur Exporte ab (Freischalten von
    Adressen), Firmendaten stehen nicht in der Verbrauchsuebersicht. Deshalb
    ist der Aufruf hier unkritisch, auch fuer jede Firma einzeln.

    Wirft nicht bei einzelnen Fehlschlaegen: eine fehlende Beschreibung soll
    die Suche nicht kippen, personalize hat weiterhin den Website-Fallback.
    """
    out: dict[str, str] = {}
    clean = [d.strip().lower() for d in domains if d and d.strip()]
    for i in range(0, len(clean), BULK_ORG_CHUNK):
        chunk = clean[i : i + BULK_ORG_CHUNK]
        try:
            for domain, org in _bulk_enrich_chunk(chunk, api_key).items():
                summary = build_company_summary(org)
                if summary:
                    out[domain] = summary
        except ApolloPlanError:
            raise
        except Exception as exc:  # noqa: BLE001 -- Zusatzdaten, kein Arbeitsschritt
            log.warning("Apollo-Firmendaten fuer %s Domains fehlgeschlagen: %s", len(chunk), exc)
        if i + BULK_ORG_CHUNK < len(clean):
            time.sleep(PAGE_PAUSE_S)
    return out


def _headers(api_key: str) -> dict:
    # Key im Header, nicht als Query-Parameter: so kann er gar nicht erst in
    # einer Fehler-URL landen (vgl. worker/http_safety.py, das genau dieses
    # Problem bei Hunter/Google nachtraeglich entschaerfen muss).
    return {"x-api-key": api_key, "Content-Type": "application/json", "Accept": "application/json"}


def _raise_for_plan(exc: httpx.HTTPStatusError) -> None:
    if exc.response.status_code in (401, 403):
        raise ApolloPlanError(
            "Apollo hat den Key abgelehnt (403). Der Free-Plan gibt die Personensuche "
            "und das E-Mail-Anreichern ueber die API nicht frei (mixed_people/api_search "
            "und people/bulk_match sind dort gesperrt) -- dafuer braucht es mindestens "
            "Apollos Basic-Plan. Ein Master-Key hebt die Plan-Sperre nicht auf. "
            "Firmensuche (organizations/search) waere im Free-Plan erlaubt."
        ) from exc


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=30),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def post_search(body: dict, api_key: str) -> dict:
    """Eine People-Search-Anfrage. Kostet keine Credits.

    Gibt die ganze Antwort zurueck, nicht nur people[]: total_entries wird fuer
    den Trefferzaehler und die Fehlerdiagnose gebraucht. Achtung, total_entries
    steht auf OBERSTER Ebene -- pagination ist bei diesem Endpunkt durchgaengig
    null, anders als bei Apollos uebrigen Such-Endpunkten.
    """
    try:
        r = httpx.post(SEARCH_URL, json=body, headers=_headers(api_key), timeout=60)
        raise_for_status_safe(r)
    except httpx.HTTPStatusError as exc:
        _raise_for_plan(exc)
        raise
    return r.json()


def search_people(filters: dict, api_key: str, page: int) -> list[dict]:
    """Eine Seite der People-Search. Liefert nur die anonymisierte Vorschau --
    brauchbar ist daraus praktisch nur die id und das has_email-Flag (siehe
    candidate_ids)."""
    return post_search(build_people_search_body(filters, page), api_key).get("people") or []


def candidate_ids(people: list[dict]) -> list[str]:
    """Aus der Suchvorschau die Personen herausziehen, fuer die sich das
    Anreichern ueberhaupt lohnt.

    has_email ist das einzige belastbare Signal der Vorschau: Apollo sagt damit
    zu, dass eine Adresse hinterlegt ist. Wer das Flag nicht hat, wuerde beim
    bulk_match ohne E-Mail zurueckkommen -- der Aufruf waere zwar gratis (Apollo
    berechnet nichts, wenn nichts geliefert wird), aber er verbraucht ein
    Kontingent im Zehnerpaket und damit am Ende echte Credits fuer weniger
    Leads. Reihenfolge bleibt stabil, Duplikate fallen raus."""
    out: list[str] = []
    for person in people:
        pid = person.get("id")
        if pid and person.get("has_email") and pid not in out:
            out.append(pid)
    return out


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=30),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _bulk_match_chunk(apollo_ids: list[str], api_key: str) -> list[dict]:
    """Anreicherung fuer maximal BULK_MATCH_CHUNK Personen. Liefert die vollen
    Datensaetze aus matches[] -- erst hier gibt es Name, E-Mail und die
    Firmendomain (die Suche liefert davon nichts, siehe parse_apollo_person).

    reveal_phone_number bleibt bewusst aus: Telefonnummern kosten 8 Credits
    statt 1 und Apollo liefert sie ohnehin nur asynchron per Webhook."""
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
    return [m for m in (r.json().get("matches") or []) if m]


def enrich_people(apollo_ids: list[str], api_key: str, wanted: int) -> list[dict]:
    """Kandidaten anreichern, bis wanted verwertbare Leads zusammen sind.

    Die Paketgroesse richtet sich nach dem, was noch fehlt -- nicht stur nach
    BULK_MATCH_CHUNK. Wer fuenf Leads will, reichert fuenf Personen an und zahlt
    fuenf Credits, nicht zehn. Sobald das Ziel erreicht ist, wird abgebrochen;
    die restlichen Kandidaten aus der (kostenlosen) Suche bleiben ungenutzt.

    Ein fehlgeschlagenes Paket darf die uebrigen nicht mitnehmen -- schon
    bezahlte Adressen sollen nicht verfallen. Ein ApolloPlanError betrifft
    dagegen jeden weiteren Aufruf gleichermassen und bricht sofort ab.
    """
    out: list[dict] = []
    idx = 0
    while idx < len(apollo_ids) and len(out) < wanted:
        need = wanted - len(out)
        chunk = apollo_ids[idx : idx + min(BULK_MATCH_CHUNK, need)]
        idx += len(chunk)
        try:
            for match in _bulk_match_chunk(chunk, api_key):
                parsed = parse_apollo_person(match)
                if parsed:
                    out.append(parsed)
        except ApolloPlanError:
            raise
        except Exception as exc:  # noqa: BLE001 -- absichtlich breit, s. Docstring
            log.warning("Apollo bulk_match fuer %s Personen fehlgeschlagen: %s", len(chunk), exc)
        if idx < len(apollo_ids) and len(out) < wanted:
            time.sleep(PAGE_PAUSE_S)
    return out[:wanted]


def collect_people(filters: dict, api_key: str, limit: int) -> list[dict]:
    """Zweistufig, weil Apollo es so vorgibt: erst kostenlos suchen, dann
    gezielt anreichern.

    1. mixed_people/api_search kostet nichts und liefert nur eine anonymisierte
       Vorschau. Daraus werden ausschliesslich die IDs der Personen gesammelt,
       die laut has_email eine Adresse haben.
    2. people/bulk_match macht daraus die vollen Datensaetze -- und kostet
       1 Credit pro gelieferter Adresse.

    Deshalb wird in Stufe 1 bewusst mehr gesammelt als gebraucht
    (CANDIDATE_OVERFETCH): das ist gratis und schafft Ersatz fuer Kandidaten,
    die beim Anreichern doch keine Domain oder Adresse liefern. Stufe 2 stoppt
    exakt beim Ziel, sodass die Credit-Kosten der Zahl der gelieferten Leads
    entsprechen und nicht der Zahl der Suchtreffer.
    """
    capped = min(limit, APOLLO_MAX_PER_SEARCH)
    if capped <= 0:
        return []
    target_candidates = capped * CANDIDATE_OVERFETCH
    ids: list[str] = []
    seen: set[str] = set()
    page = 1
    while len(ids) < target_candidates and page <= (APOLLO_MAX_PER_SEARCH // PER_PAGE):
        people = search_people(filters, api_key, page)
        if not people:
            break
        for pid in candidate_ids(people):
            if pid not in seen:
                seen.add(pid)
                ids.append(pid)
        if len(people) < PER_PAGE:
            break  # letzte Seite
        page += 1
        if len(ids) < target_candidates:
            time.sleep(PAGE_PAUSE_S)

    if not ids:
        # Kein Fehler, aber die haeufigste Ursache fuer "Suche fertig, null
        # Leads" -- ohne diese Zeile bliebe voellig offen, ob Apollo nichts
        # fand oder die Anreicherung scheiterte.
        log.warning(
            "Apollo People-Search lieferte keine Person mit hinterlegter E-Mail "
            "(Filter zu eng oder Zielgruppe in Apollo nicht vorhanden)."
        )
        return []
    return enrich_people(ids, api_key, capped)


# Welcher Filter wird bei der Ursachensuche versuchsweise weggelassen, und wie
# heisst er fuer den Nutzer. Reihenfolge = Verdachtsreihenfolge: der
# Technologie-Filter steht vorn, weil er der schaerfste ist (in einer echten
# Suche schnitt er 170.000 Treffer auf unter 1.000) und weil ein Slug, den
# Apollo nicht kennt, kommentarlos null liefert statt einen Fehler zu melden.
_DIAGNOSABLE_FILTERS = [
    ("currently_using_any_of_technology_uids", "der Technologie-Filter"),
    ("q_organization_keyword_tags", "die Stichwörter"),
    ("person_titles", "die Positionen"),
    ("organization_locations", "die Länderauswahl"),
    ("organization_num_employees_ranges", "die Firmengröße"),
    ("person_seniorities", "die Senioritäts-Stufen"),
]


def _thousands(n: int) -> str:
    """168561 -> "168.561". Deutsche Schreibweise, weil die Meldung deutsch ist."""
    return f"{n:,}".replace(",", ".")


def _total(body: dict, api_key: str) -> int:
    """Gesamttreffer fuer einen Body. per_page=1, weil nur die Zahl zaehlt."""
    data = post_search(body | {"page": 1, "per_page": 1}, api_key)
    total = data.get("total_entries")
    return total if isinstance(total, int) else 0


def explain_empty_result(filters: dict, api_key: str) -> str:
    """Warum hat diese Suche nichts geliefert? Fuer den Nutzer lesbar.

    Ohne diese Erklaerung endet eine leere Suche mit "fertig, 0 Leads" und der
    Nutzer hat keinen Anhaltspunkt, welcher der sechs Filter schuld war. Genau
    das ist am 2026-08-02 passiert: ein Technologie-Slug existierte bei Apollo
    nicht, Apollo meldete das nicht als Fehler, und die Suche lief sauber leer
    durch.

    Vorgehen ist dieselbe Bisektion, die man sonst von Hand macht: jeden Filter
    einmal weglassen und schauen, ob dann Treffer kommen. Das kostet nichts
    (die Suche ist gratis) und passiert nur auf dem Null-Pfad, also hoechstens
    einmal pro leerer Suche. PAGE_PAUSE_S haelt dabei Abstand zum Rate Limit.

    Wirft nicht: eine fehlgeschlagene Diagnose darf die Suche nicht nachtraeglich
    zum Fehler machen -- sie ist eine Zusatzauskunft, kein Arbeitsschritt.
    """
    try:
        full = build_people_search_body(filters, 1, per_page=1)
        data = post_search(full, api_key)
        people = data.get("people") or []
        total = data.get("total_entries")

        if people and not any(p.get("has_email") for p in people):
            # Passende Personen gibt es, aber Apollo hat fuer keine davon eine
            # Adresse hinterlegt. Ein anderer Filter hilft hier nicht.
            return (
                f"Apollo kennt {total or len(people)} passende Personen, aber für keine davon "
                "eine hinterlegte E-Mail-Adresse. Die Suche verlangt eine verifizierte Adresse, "
                "deshalb bleibt die Liste leer. Meist hilft es, die Positionen weiter zu fassen."
            )
        if people:
            # Kandidaten mit Adresse waren da, trotzdem kam nichts an: das
            # Freischalten (bulk_match) hat nichts Verwertbares geliefert.
            return (
                "Apollo hat passende Personen mit E-Mail gefunden, beim Freischalten kam aber "
                "kein vollständiger Datensatz zurück (es fehlten Firmenname oder Domain). "
                "Ein erneuter Lauf liefert oft ein anderes Ergebnis."
            )

        for key, label in _DIAGNOSABLE_FILTERS:
            if key not in full:
                continue
            reduced = {k: v for k, v in full.items() if k != key}
            time.sleep(PAGE_PAUSE_S)
            found = _total(reduced, api_key)
            if found > 0:
                # Tausenderpunkte nur auf der ZAHL bilden, nicht auf dem Satz:
                # ein .replace(",", ".") ueber die ganze Meldung erwischt auch
                # die Satzkommata und macht Punkte daraus.
                return (
                    f"Keine Treffer. Verantwortlich ist {label}: ohne diesen einen Filter "
                    f"findet Apollo {_thousands(found)} Personen. Entweder passt der Wert "
                    "nicht zur restlichen Auswahl, oder Apollo kennt für diese Zielgruppe "
                    "schlicht niemanden."
                )

        return (
            "Keine Treffer. Kein einzelner Filter ist allein schuld: auch wenn man je einen "
            "weglässt, findet Apollo nichts. Die Kombination ist insgesamt zu eng, am besten "
            "zwei Filter gleichzeitig lockern."
        )
    except ApolloPlanError:
        raise
    except Exception as exc:  # noqa: BLE001 -- Diagnose darf nie die Suche kippen
        log.warning("Apollo-Ursachensuche fehlgeschlagen: %s", exc)
        return (
            "Keine Treffer. Die Ursache ließ sich nicht ermitteln, weil Apollo bei der "
            "Nachfrage nicht erreichbar war."
        )


def check_key(api_key: str) -> dict:
    """Lebenszeichen-Test fuer einen Apollo-Key.

    /auth/health kostet keine Credits und ist in jedem Plan erlaubt -- damit
    laesst sich "ist der Key gueltig?" beantworten, ohne eine Suche zu starten
    und Kontingent zu verbrennen. Beantwortet ausdruecklich NICHT, ob der Plan
    die Personensuche freigibt; das zeigt sich erst beim ersten echten Lauf
    (dann als ApolloPlanError).
    """
    r = httpx.get(HEALTH_URL, headers=_headers(api_key), timeout=20)
    if r.status_code in (401, 403):
        return {"ok": False, "status": r.status_code}
    raise_for_status_safe(r)
    body = r.json()
    return {"ok": bool(body.get("is_logged_in")), "status": r.status_code}
