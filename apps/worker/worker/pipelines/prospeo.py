"""Prospeo — Firmen UND Entscheider samt verifizierter E-Mail in einem Lauf.

Vierter Suchweg neben maps, corporate und apollo. Der Aufbau entspricht
bewusst pipelines/apollo.py: Personensuche liefert Person plus Firma, diese
Pipeline schreibt also businesses UND contacts, und die Anreicherungsjobs
(find_decisionmaker/hunt_persons) entfallen.

═══════════════════════════════════════════════════════════════════════════
WARUM ES DIESEN WEG NEBEN APOLLO GIBT
═══════════════════════════════════════════════════════════════════════════

Apollos API haengt am Tarif: Free und Basic haben gar keinen Zugang, der
Master-Key ist an die Organization-Stufe gebunden (ab $119 je Nutzer, mind.
drei Sitze). Fuer BYOK ist das die teuerste Stelle der Einstiegshuerde --
der Kunde muss einen Tarif buchen, der ein Vielfaches von Frostbreaker
kostet. Der 403 steht seit Wochen in apollo.py:421 dokumentiert.

Prospeo laesst den Schluessel schon im kostenlosen Tarif anlegen und rechnet
je KONTO ab statt je Sitz.

Dazu Filter, die die anderen drei Wege nicht haben und die fuer die Ansprache
mehr wert sind als jede Groessenangabe: wer gerade wofuer Stellen ausschreibt
(company_job_posting_hiring_for), Website-Traffic samt Wachstum, Kaufabsicht
je Thema und eine Wappalyzer-gestuetzte Technologie-Erkennung.

═══════════════════════════════════════════════════════════════════════════
KOSTEN UND GRENZEN, DIE DAS DESIGN BESTIMMEN
═══════════════════════════════════════════════════════════════════════════

Aus prospeo.io/api-docs und dem eingeloggten Konto, Stand 2026-08-05:

  * Die SUCHE kostet Credits: 1 Credit je 25 Treffer, also 1 je Seite. Das
    ist der wichtigste Unterschied zu Apollo, wo die Suche gratis ist und nur
    das Freischalten kostet. Ein zu grosser Kandidaten-Puffer waere hier also
    nicht mehr umsonst -- SEARCH_OVERSHOOT ist deshalb klein.
  * Das ANREICHERN kostet 1 Credit je gefundener Adresse, 10 je Mobilnummer.
    Mobilnummern fragen wir bewusst nicht ab (enrich_mobile bleibt aus).
  * Kein Treffer kostet nichts. Und: derselbe Datensatz innerhalb von 90
    Tagen erneut angereichert kostet ebenfalls nichts.
  * Seitengroesse 25, hoechstens 1000 Seiten, also max. 25.000 Treffer.
  * bulk-enrich-person nimmt hoechstens 50 Personen je Aufruf.
  * Ratengrenzen je Tarif (Anfragen/Sekunde):
        Suche    Starter 1  · Growth 2  · Pro 5
        Enrich   Starter 5  · Growth 5  · Pro 30
    Die Pausen unten sind auf den KLEINSTEN Tarif ausgelegt. Wer mehr hat,
    wartet unnoetig -- das ist der richtige Fehler: zu langsam ist ein
    laengerer Lauf, zu schnell ist ein 429 und ein abgebrochener Job.
  * Der Schluessel gehoert in den X-KEY-Header.

Die Antwort fuehrt bei jedem Aufruf mit, wie viel Kontingent bleibt:
x-daily-request-left, x-minute-request-left, x-minute-reset-seconds. Das
nutzt _sleep_for_rate_limit(), statt bei einem 429 blind zu warten.

═══════════════════════════════════════════════════════════════════════════
ZWEI SCHRITTE, WEIL DIE SUCHE KEINE ADRESSEN HERGIBT
═══════════════════════════════════════════════════════════════════════════

search-person liefert die Felder email und mobile mit, aber IMMER unrevealed
(`revealed: false`). Die Adresse kommt ausschliesslich aus einem zweiten
Aufruf. Dieselbe Zweiteilung wie bei Apollo (api_search + bulk_match), nur
mit anderen Namen -- und mit dem Unterschied, dass hier schon der erste
Schritt Credits kostet.

Docs: https://prospeo.io/api-docs
"""
import logging
import time
import uuid
from typing import Callable

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from worker.http_safety import raise_for_status_safe

log = logging.getLogger(__name__)

SEARCH_URL = "https://api.prospeo.io/search-person"
BULK_ENRICH_URL = "https://api.prospeo.io/bulk-enrich-person"
# Kostet laut Doku keine Credits und beruehrt keine Suchdaten -- reiner
# Lebenszeichen-Test fuer einen Schluessel (siehe app/api/prospeo/health).
SUGGESTIONS_URL = "https://api.prospeo.io/search-suggestions"

# Von Prospeo fest vorgegeben, nicht von uns gewaehlt.
PER_PAGE = 25
MAX_PAGES = 1000
BULK_ENRICH_CHUNK = 50

# Obergrenze je Suche. Bewusst endlich: eine versehentlich zu breite Suche
# soll nicht das Monatskontingent des Kunden verbrauchen. 1000 Leads sind
# 40 Suchseiten (40 Credits) plus bis zu 1000 Anreicherungs-Credits.
PROSPEO_MAX_PER_SEARCH = 1000
# Zweite Bremse ueber mehrere Suchen hinweg, je Workspace und Tag.
PROSPEO_MAX_PER_DAY = 5000

# 1,1s zwischen Suchseiten: der Starter-Tarif erlaubt 1 Anfrage/Sekunde.
SEARCH_PAUSE_S = 1.1
# 0,25s zwischen Anreicherungs-Bloecken: 5/Sekunde auf allen Tarifen.
ENRICH_PAUSE_S = 0.25

# Wie viele Such-Kandidaten je gewuenschtem Lead gesammelt werden.
#
# Bei Apollo steht hier 3, weil dort die Suche gratis ist. Hier kostet jede
# Seite einen Credit, also ist der Puffer knapp: 1,4 faengt die Kandidaten ab,
# die keine Firmendomain mitbringen oder beim Anreichern keine Adresse
# liefern, ohne ein Drittel des Kontingents fuer Vorrat auszugeben.
SEARCH_OVERSHOOT = 1.4

MAX_SUMMARY_CHARS = 2000

# Spiegeln PROSPEO_HEADCOUNT_RANGES und PROSPEO_REVENUE_TIERS in
# apps/web/lib/prospeo-query.ts. Prospeos oberste Groessenstufe heisst
# "10000+" -- Apollo schreibt "10001+". Eine gemeinsame Konstante fuer beide
# Anbieter waere deshalb bei genau einer der beiden Suchen ein stiller Fehler.
HEADCOUNT_RANGES = [
    "1-10", "11-20", "21-50", "51-100", "101-200", "201-500",
    "501-1000", "1001-2000", "2001-5000", "5001-10000", "10000+",
]
REVENUE_TIERS = [
    "<100K", "100K", "500K", "1M", "5M", "10M", "25M", "50M",
    "100M", "250M", "500M", "1B", "5B", "10B+",
]

# GROSSGESCHRIEBEN, und es sind vier statt zwei.
#
# Die Doku schreibt "contains (default) or exact". Die API lehnt beides klein
# ab: "Invalid match_mode. Must be one of: CONTAINS, EXACT, SIMILAR, STRICT."
# Am 2026-08-05 gegen die echte API gemessen -- ohne diesen Testlauf waere
# jede Suche mit Positionsangabe an einem 400 gescheitert.
MATCH_MODES = ["CONTAINS", "EXACT", "SIMILAR", "STRICT"]
DEFAULT_MATCH_MODE = "CONTAINS"


def _match_mode(raw) -> str:
    """Vergleichsart normalisieren. Unbekanntes faellt auf CONTAINS zurueck,
    statt Prospeo einen ungueltigen Wert zu schicken."""
    value = str(raw or "").strip().upper()
    return value if value in MATCH_MODES else DEFAULT_MATCH_MODE


class ProspeoPlanError(Exception):
    """Der Tarif gibt einen benutzten Filter oder Endpunkt nicht frei.

    Eigene Klasse, weil die Antwort darauf eine voellig andere ist als bei
    jedem anderen Fehler: nicht "spaeter nochmal", sondern "dieser Filter
    kostet bei Prospeo einen hoeheren Tarif". Wird als Klartext an die Suche
    geschrieben statt als "fehlgeschlagen".
    """


class ProspeoDailyCapReached(Exception):
    """Unsere eigene Tagesgrenze, nicht Prospeos."""


class ProspeoRateLimited(Exception):
    """Prospeos Ratengrenze (429).

    Eigene Klasse und ausdruecklich WIEDERHOLBAR -- anders als
    ProspeoPlanError. Der Unterschied ist wesentlich:

      Tarifsperre   aendert sich nicht durch Warten. Sofort aufgeben und
                    erklaeren.
      Ratengrenze   ist per Definition voruebergehend. Der Suchendpunkt
                    erlaubt auf dem kleinsten Tarif EINE Anfrage pro
                    Sekunde -- da ist ein 429 keine Stoerung, sondern der
                    Normalfall bei Gleichzeitigkeit.

    Vorher fuehrte jeder 429 dazu, dass der ganze Job einen seiner drei
    Versuche verbrannte und die Suche auf "fehlgeschlagen" sprang. Bei drei
    Versuchen mit quadratischem Backoff war eine Suche damit nach gut vier
    Minuten endgueltig tot, obwohl eine Sekunde Warten gereicht haette.
    """


def _headers(api_key: str) -> dict:
    # Schluessel im Header, nicht als Query-Parameter -- so kann er gar nicht
    # erst in einer Fehler-URL landen (vgl. worker/http_safety.py).
    return {"X-KEY": api_key, "Content-Type": "application/json", "Accept": "application/json"}


def _is_retryable(exc: BaseException) -> bool:
    """Netzfehler, 5xx und die Ratengrenze erneut versuchen -- 4xx nicht.

    429 IST wiederholbar (siehe ProspeoRateLimited). Vor dem erneuten Versuch
    wird die von Prospeo genannte Wartezeit abgesessen, es laeuft also nicht
    blind in dieselbe Grenze.

    Eine Tarifsperre ist dagegen nicht wiederholbar: sie aendert sich durch
    Warten nicht, und drei Versuche daran waeren drei vergeudete Minuten und
    eine spaetere, nicht bessere Fehlermeldung.
    """
    if isinstance(exc, ProspeoRateLimited):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return isinstance(exc, (httpx.TimeoutException, httpx.TransportError))


def raise_for_filter_error(response: httpx.Response) -> None:
    """Prospeos Fachfehler in eine Meldung uebersetzen, die der Nutzer versteht.

    ACHTUNG, das war die groesste Ueberraschung im Testlauf am 2026-08-05:
    eine Tarifsperre kommt NICHT als 403, sondern als **HTTP 400** mit einem
    Fehlercode im Rumpf:

        {"error": true,
         "error_code": "PLAN_REQUIRED",
         "filter_error": "Filters not available on your plan: company_technology (STARTER+)"}

    Wer nur auf 403 prueft (so stand es hier zuerst), verbucht das als
    gewoehnlichen HTTP-Fehler -- in der Oberflaeche stand "Prospeo ist gerade
    nicht erreichbar", obwohl Prospeo praezise geantwortet hatte.

    filter_error wird woertlich weitergegeben: Prospeo nennt darin den
    Filternamen und die noetige Stufe, und das ist besser als jede
    Umschreibung von uns.
    """
    status = response.status_code
    if status == 401:
        raise ProspeoPlanError(
            "Prospeo hat den Schluessel abgelehnt (401). Bitte den API-Key in den "
            "Einstellungen pruefen -- er steht im Prospeo-Konto unter API."
        )

    if status not in (400, 403) and status < 500:
        return
    if status >= 500:
        return

    detail = ""
    code = ""
    try:
        body = response.json()
        code = str(body.get("error_code") or "")
        detail = str(body.get("filter_error") or body.get("message") or "")
    except Exception:  # noqa: BLE001
        detail = (response.text or "")[:300]

    if code == "PLAN_REQUIRED":
        raise ProspeoPlanError(
            f"Prospeo: dieser Filter ist in deinem Tarif nicht enthalten. {detail} "
            "(Technologie und Stellenausschreibungen ab Starter, Website-Traffic ab Pro.)"
        )
    if code == "INVALID_FILTERS":
        raise ProspeoPlanError(f"Prospeo hat einen Filterwert abgelehnt: {detail}")
    if detail:
        raise ProspeoPlanError(f"Prospeo hat die Anfrage abgelehnt ({status}): {detail}")


def _header_int(response: httpx.Response, name: str, default: int = 0) -> int:
    try:
        return int(response.headers[name])
    except (KeyError, TypeError, ValueError):
        return default


def _sleep_for_rate_limit(response: httpx.Response) -> None:
    """Warten, bevor die Grenze zuschlaegt -- nicht danach.

    Prospeo gibt bei jeder Antwort mit, wie viele Anfragen in dieser Sekunde,
    Minute und an diesem Tag noch frei sind. Ist eines der Fenster
    aufgebraucht, warten wir genau bis zu seinem Ende, statt in den 429 zu
    laufen.

    Die SEKUNDE gehoert unbedingt dazu: der Suchendpunkt erlaubt auf dem
    kleinsten Tarif genau eine Anfrage pro Sekunde, und nach jedem
    erfolgreichen Aufruf steht dort x-second-request-left: 0. Ohne diese
    Wartezeit laeuft der naechste Aufruf zuverlaessig in einen 429 -- das war
    der Grund, warum der erste Testlauf am 2026-08-05 dreimal hintereinander
    scheiterte.
    """
    if _header_int(response, "x-minute-request-left", 1) <= 0:
        reset = _header_int(response, "x-minute-reset-seconds")
        if reset > 0:
            log.info("Prospeo: Minutenkontingent aufgebraucht, warte %ss", reset)
            time.sleep(min(reset + 1, 70))
            return
    if _header_int(response, "x-second-request-left", 1) <= 0:
        # Sekundenfenster: kurz, aber genau das, was den 429 ausloest.
        time.sleep(max(1, _header_int(response, "x-second-reset-seconds", 1)) + 0.2)


def daily_left(response: httpx.Response) -> int | None:
    """Wie viele Anfragen heute noch frei sind, oder None wenn unbekannt."""
    try:
        return int(response.headers["x-daily-request-left"])
    except (KeyError, TypeError, ValueError):
        return None


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=30),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _post(url: str, body: dict, api_key: str) -> httpx.Response:
    r = httpx.post(url, json=body, headers=_headers(api_key), timeout=60)
    # Vor raise_for_status: Prospeo legt den eigentlichen Grund in den Rumpf,
    # und der ist bei 400 aussagekraeftiger als der Statuscode.
    raise_for_filter_error(r)
    if r.status_code == 429:
        # Erst die von Prospeo genannte Wartezeit absitzen, dann wiederholen.
        # tenacity faengt ProspeoRateLimited ab (siehe _is_retryable).
        wait = max(
            _header_int(r, "x-second-reset-seconds", 1),
            _header_int(r, "x-minute-reset-seconds") if _header_int(r, "x-minute-request-left", 1) <= 0 else 0,
        )
        log.info("Prospeo 429, warte %ss und versuche erneut", wait)
        time.sleep(min(wait + 0.5, 70))
        raise ProspeoRateLimited(
            "Prospeos Ratengrenze (429). Der Suchendpunkt erlaubt auf dem "
            f"kleinsten Tarif eine Anfrage pro Sekunde. Prospeos Antwort: "
            f"{(r.text or '')[:200]}"
        )
    raise_for_status_safe(r)
    _sleep_for_rate_limit(r)
    return r


def build_search_filters(f: dict) -> dict:
    """Unsere gespeicherten Filter -> Prospeos filters-Objekt.

    MUSS mit buildProspeoFilters() in apps/web/lib/prospeo-query.ts
    uebereinstimmen. Der Trefferzaehler im Formular stellt dieselbe Anfrage;
    weicht ein Feld ab, verspricht die Oberflaeche eine Zahl, die die Suche
    nicht einloest.

    Grundregel wie dort: ein nicht gesetzter Filter taucht GAR NICHT auf. Ein
    leeres include-Array ist bei Prospeo keine fehlende Bedingung, sondern
    eine, die nichts erfuellt -- der Fehler erschiene als "keine Treffer".
    """
    out: dict = {}

    def comma_list(value, limit=None) -> list[str]:
        items = [v.strip() for v in str(value or "").split(",") if v.strip()]
        return items[:limit] if limit else items

    def clean_list(value, limit=None) -> list[str]:
        if not isinstance(value, list):
            return []
        items = [str(v).strip() for v in value if str(v).strip()]
        return items[:limit] if limit else items

    def num(value):
        if value is None or value == "":
            return None
        try:
            n = float(value)
        except (TypeError, ValueError):
            return None
        return int(n) if float(n).is_integer() else n

    titles = comma_list(f.get("person_titles"))
    if titles:
        out["person_job_title"] = {
            "include": titles,
            "match_mode": _match_mode(f.get("person_title_match")),
        }

    person_locations = clean_list(f.get("person_locations"))
    if person_locations:
        out["person_location_search"] = {"include": person_locations}

    company_locations = clean_list(f.get("company_locations"))
    if company_locations:
        out["company_location_search"] = {"include": company_locations}

    industries = clean_list(f.get("industries"), 500)
    if industries:
        out["company_industry"] = {"include": industries}

    headcount = [h for h in clean_list(f.get("headcount")) if h in HEADCOUNT_RANGES]
    if headcount:
        out["company_headcount_range"] = {"include": headcount}

    keywords = comma_list(f.get("keywords"), 20)
    if keywords:
        out["company_keywords"] = {"include": keywords}

    technologies = clean_list(f.get("technologies"), 20)
    if technologies:
        out["company_technology"] = {"include": technologies}

    revenue = [r for r in clean_list(f.get("revenue")) if r in REVENUE_TIERS]
    if revenue:
        out["company_revenue"] = {"include": revenue}

    funding = clean_list(f.get("funding"))
    if funding:
        out["company_funding"] = {"include": funding}

    intent = clean_list(f.get("intent"))
    if intent:
        out["company_intent"] = {"include": intent}

    hiring = comma_list(f.get("hiring_for"), 500)
    if hiring:
        out["company_job_posting_hiring_for"] = {
            # Dieselbe Schreibweise wie bei match_mode. Nicht gegen die echte
            # API geprueft, weil der Filter den Starter-Tarif braucht und der
            # Testschluessel auf Free lief -- die Grossschreibung ist hier die
            # sichere Annahme, weil Prospeo sie bei match_mode erzwingt.
            "include": hiring,
            "match_type": _match_mode(f.get("hiring_match")),
        }

    job_min, job_max = num(f.get("job_posting_min")), num(f.get("job_posting_max"))
    if job_min is not None or job_max is not None:
        quantity = {}
        if job_min is not None:
            quantity["min"] = job_min
        if job_max is not None:
            quantity["max"] = job_max
        out["company_job_posting_quantity"] = quantity

    # Website-Traffic. Laut Doku muss mindestens eines der drei Kriterien
    # gesetzt sein (Besuche, Veraenderung, Laender) -- ein Objekt aus nur
    # einem Zeitraum waere eine ungueltige Anfrage.
    traffic: dict = {}
    min_visits, max_visits = num(f.get("traffic_min_visits")), num(f.get("traffic_max_visits"))
    if min_visits is not None:
        traffic["min_monthly_visits"] = min_visits
    if max_visits is not None:
        traffic["max_monthly_visits"] = max_visits

    change_min, change_max = num(f.get("traffic_change_min")), num(f.get("traffic_change_max"))
    if change_min is not None or change_max is not None:
        change = {"period": f.get("traffic_change_period") or "monthly"}
        if change_min is not None:
            change["min_change"] = change_min
        if change_max is not None:
            change["max_change"] = change_max
        traffic["visit_change"] = change

    countries = clean_list(f.get("traffic_countries"), 5)
    if countries:
        traffic["top_countries"] = countries
        # min_country_pct ist laut Doku nur zusammen mit top_countries erlaubt.
        pct = num(f.get("traffic_country_min_pct"))
        if pct is not None:
            traffic["min_country_pct"] = pct

    if min_visits is not None or max_visits is not None or "visit_change" in traffic or countries:
        out["company_website_traffic"] = traffic

    return out


def search_page(filters: dict, api_key: str, page: int) -> dict:
    """Eine Suchseite. Kostet 1 Credit."""
    return _post(SEARCH_URL, {"filters": filters, "page": page}, api_key).json()


def build_company_summary(company: dict) -> str | None:
    """Textgrundlage fuer die Personalisierung, aus Prospeos Firmendatensatz.

    Beschreibung UND Technologien UND Branche, weil alle drei etwas anderes
    leisten: die Beschreibung liefert den Selbstanspruch der Firma, die
    Technologien konkrete Aufhaenger ("nutzt Klaviyo und Gorgias"), die
    Branche die Einordnung. Nur eines waere entweder blumig oder eine
    Schlagwortwolke.

    Zu duenn ist schlechter als nichts: personalize faellt dann auf den
    Website-Text zurueck, statt aus zwei Woertern einen Satz zu erfinden.
    """
    if not isinstance(company, dict):
        return None
    parts: list[str] = []
    desc = (company.get("description") or "").strip()
    if desc:
        parts.append(desc[:MAX_SUMMARY_CHARS])

    tech = company.get("technology") or {}
    names = tech.get("technology_names") if isinstance(tech, dict) else None
    if isinstance(names, list) and names:
        parts.append("Eingesetzte Technik: " + ", ".join(str(n) for n in names[:25]))

    industry = (company.get("industry") or "").strip()
    if industry:
        parts.append("Branche: " + industry)

    text = "\n\n".join(parts).strip()
    return text if len(text) >= 80 else None


def _website_of(company: dict) -> str | None:
    """Website oder aus der Domain gebaut.

    Die Website ist der Entdopplungsschluessel dieser Pipeline (Prospeo kennt
    keine Google-place_id). Ohne sie ist ein Datensatz unbrauchbar -- er
    liesse sich weder entdoppeln noch spaeter personalisieren.
    """
    website = (company.get("website") or "").strip()
    if website:
        return website
    domain = (company.get("domain") or "").strip()
    return f"https://{domain}" if domain else None


def _address_of(company: dict) -> str | None:
    """Anschrift. Prospeo liefert eine fertige raw_address mit -- die ist
    vollstaendiger als alles, was wir aus den Einzelteilen zusammensetzen
    (sie enthaelt die Strasse). Rueckfall auf Stadt/Region/Land, weil laut
    Doku jedes Feld null sein kann."""
    loc = company.get("location")
    if not isinstance(loc, dict):
        return None
    raw = (loc.get("raw_address") or "").strip()
    if raw:
        return raw
    parts = [loc.get("city"), loc.get("state"), loc.get("country")]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def _phone_of(company: dict) -> str | None:
    """Telefonnummer der Firmenzentrale.

    phone_hq ist ein OBJEKT, keine Zeichenkette:

        {"phone_hq": "+16165759676", "phone_hq_national": "(616) 575-9676",
         "phone_hq_international": "+16165759676", ...}

    Am 2026-08-05 im Testlauf gesehen. Ohne diese Funktion waere ein dict in
    die Textspalte businesses.phone_national gewandert -- entweder ein
    Datenbankfehler oder, schlimmer, ein gespeichertes "{'phone_hq': ...}".
    """
    phone = company.get("phone_hq")
    if isinstance(phone, str):
        return phone.strip() or None
    if not isinstance(phone, dict):
        return None
    for key in ("phone_hq_national", "phone_hq", "phone_hq_international"):
        value = phone.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _current_job(person: dict) -> dict:
    """Der aktuelle Eintrag aus der Job-Historie.

    Senioritaet und Abteilung stehen NICHT oben auf dem Person-Objekt --
    dort sind sie durchgaengig null. Sie haengen am einzelnen Job in
    job_history, wo current=true steht. Ebenfalls erst im Testlauf am
    2026-08-05 aufgefallen; vorher haette jeder Kontakt seniority=None
    bekommen, und die Kampagnen-Auswahl "nur Entscheider" haette nichts
    mehr zu filtern gehabt.
    """
    history = person.get("job_history")
    if not isinstance(history, list):
        return {}
    for job in history:
        if isinstance(job, dict) and job.get("current"):
            return job
    return history[0] if history and isinstance(history[0], dict) else {}


def _map_pair(person: dict, company: dict, email: str | None, email_status: str | None) -> dict | None:
    """Person plus Firma in unsere beiden Zeilen uebersetzen.

    Gibt None zurueck, wenn Website oder Name fehlen -- dieselbe Regel wie bei
    Apollo: ohne Website kein Entdopplungsschluessel, ohne Namen kein
    Ansprechpartner.
    """
    website = _website_of(company)
    name = (company.get("name") or "").strip() or (company.get("domain") or "").strip()
    full_name = (person.get("full_name") or "").strip() or " ".join(
        p for p in [person.get("first_name"), person.get("last_name")] if p
    ).strip()
    if not website or not name or not full_name:
        return None

    job = _current_job(person)
    # Erst der Job, dann die oberste Ebene: falls Prospeo die Felder eines
    # Tages doch oben mitliefert, gewinnt weiterhin der konkrete Job.
    departments = job.get("departments") or person.get("departments")
    department = departments[0] if isinstance(departments, list) and departments else None
    seniority = job.get("seniority") or person.get("seniority")

    business = {
        # Prospeo kennt keine Google-place_id. Wie im Corporate- und
        # Apollo-Modus bleibt das Feld leer, die Entdopplung laeuft ueber die
        # Website.
        "place_id": None,
        "name": name,
        "website": website,
        "address": _address_of(company),
        "phone_national": _phone_of(company),
    }
    contact = {
        "prospeo_id": person.get("person_id"),
        "full_name": full_name,
        "first_name": person.get("first_name") or full_name.split(" ", 1)[0],
        "last_name": person.get("last_name"),
        "title": person.get("current_job_title") or job.get("title"),
        "seniority": seniority,
        "department": department,
        "email": email,
        # Prospeo meldet VERIFIED oder UNAVAILABLE. Wir speichern es in
        # unserer eigenen Schreibweise, damit die Lead-Tabelle nicht je
        # Anbieter eine eigene Uebersetzung braucht.
        "email_verification_status": "valid" if email_status == "VERIFIED" else None,
        "linkedin": person.get("linkedin_url"),
        "source": "prospeo",
    }
    return {"business": business, "contact": contact, "company_summary": build_company_summary(company)}


def collect_people(
    filters: dict,
    api_key: str,
    wanted: int,
    on_search_charge: Callable[[int], None] | None = None,
    on_enrich_charge: Callable[[int], None] | None = None,
) -> list[dict]:
    """Suchen, anreichern, in unsere Struktur uebersetzen.

    Zwei getrennte Rueckmeldungen fuer den Verbrauch, weil es zwei
    verschiedene Kostenarten sind: die Suche kostet je Seite, das Anreichern
    je gefundener Adresse. Eine gemeinsame Zahl liesse sich in der
    Kostenansicht nicht mehr auseinanderdividieren.
    """
    built = build_search_filters(filters)
    if not built:
        # Ohne Filter liefe die Suche quer durch 200 Millionen Kontakte und
        # verbrennt Credits. Das gehoert verhindert, nicht bemerkt.
        raise ValueError("Prospeo-Suche ohne Filter -- das waere teuer und sinnlos.")

    target = min(wanted, PROSPEO_MAX_PER_SEARCH)
    budget = int(target * SEARCH_OVERSHOOT)

    candidates: list[tuple[dict, dict]] = []
    pages_used = 0
    page = 1
    while len(candidates) < budget and page <= MAX_PAGES:
        data = search_page(built, api_key, page)
        pages_used += 1
        results = data.get("results") or []
        if not results:
            break
        for row in results:
            person, company = row.get("person") or {}, row.get("company") or {}
            if person.get("person_id") and _website_of(company):
                candidates.append((person, company))

        pagination = data.get("pagination") or {}
        total_pages = pagination.get("total_page") or 0
        if page >= total_pages:
            break
        page += 1
        time.sleep(SEARCH_PAUSE_S)

    if on_search_charge and pages_used:
        on_search_charge(pages_used)
    if not candidates:
        return []

    # Anreichern in 50er-Bloecken. Der identifier ist Pflicht und ordnet die
    # Antwort dem Eingang zu -- Prospeo garantiert keine Reihenfolge.
    by_identifier: dict[str, tuple[dict, dict]] = {}
    payload: list[dict] = []
    for person, company in candidates[:budget]:
        ident = uuid.uuid4().hex
        by_identifier[ident] = (person, company)
        payload.append({"identifier": ident, "person_id": person["person_id"]})

    pairs: list[dict] = []
    enriched_count = 0
    for i in range(0, len(payload), BULK_ENRICH_CHUNK):
        if len(pairs) >= target:
            break
        chunk = payload[i : i + BULK_ENRICH_CHUNK]
        body = {
            "data": chunk,
            # Nur verifizierte Adressen: eine unverifizierte kostet denselben
            # Credit und erhoeht die Bounce-Quote, die der Torwart spaeter
            # gegen den Kampagnenstart haelt.
            "only_verified_email": True,
            # Mobilnummern kosten das Zehnfache und werden hier nicht
            # gebraucht -- der Anrufkanal arbeitet mit der Firmennummer.
            "enrich_mobile": False,
        }
        data = _post(BULK_ENRICH_URL, body, api_key).json()

        for match in data.get("matched") or []:
            ident = match.get("identifier")
            source = by_identifier.get(ident)
            if not source:
                continue
            # Person und Firma aus der Anreicherung sind vollstaendiger als
            # aus der Suche -- deshalb vorrangig, mit Rueckfall auf die
            # Suchdaten, falls ein Feld fehlt.
            person = {**source[0], **(match.get("person") or {})}
            company = {**source[1], **(match.get("company") or {})}

            email_obj = person.get("email") or {}
            email = email_obj.get("email") if isinstance(email_obj, dict) else None
            status = email_obj.get("status") if isinstance(email_obj, dict) else None
            if not email:
                continue
            enriched_count += 1

            pair = _map_pair(person, company, email, status)
            if pair:
                pairs.append(pair)
            if len(pairs) >= target:
                break

        if i + BULK_ENRICH_CHUNK < len(payload):
            time.sleep(ENRICH_PAUSE_S)

    if on_enrich_charge and enriched_count:
        on_enrich_charge(enriched_count)
    return pairs[:target]


def explain_empty_result(filters: dict, api_key: str) -> str:
    """Warum kam nichts zurueck?

    "Fertig, 0 Leads" ohne Begruendung ist die frustrierendste Auskunft, die
    eine Suche geben kann -- der Nutzer sieht acht Filter und weiss nicht,
    welcher schuld war. Dieselbe Ueberlegung wie in apollo.explain_empty_result.

    Die Pruefung laeuft nur auf dem Null-Pfad und kostet je Versuch eine
    Suchseite, also einen Credit. Deshalb wird hoechstens VIERMAL nachgefragt
    und nicht jeder Filter einzeln durchprobiert.
    """
    built = build_search_filters(filters)
    if not built:
        return "Es war kein Filter gesetzt."

    # Der teuerste zuerst: Traffic und Stellenanzeigen schneiden am haertesten.
    order = [
        ("company_website_traffic", "der Website-Traffic-Filter"),
        ("company_job_posting_hiring_for", "die Stellenausschreibungen"),
        ("company_technology", "der Technologie-Filter"),
        ("company_intent", "die Kaufabsicht"),
    ]
    for field, label in order:
        if field not in built:
            continue
        probe = {k: v for k, v in built.items() if k != field}
        if not probe:
            continue
        try:
            data = search_page(probe, api_key, 1)
        except Exception:  # noqa: BLE001 -- Diagnose, kein Arbeitsschritt
            break
        total = (data.get("pagination") or {}).get("total_count") or 0
        if total > 0:
            return (
                f"Prospeo hat zu dieser Kombination nichts gefunden. Ohne {label} "
                f"waeren es {total} Treffer -- dieser Filter ist also der engste."
            )
        time.sleep(SEARCH_PAUSE_S)

    return (
        "Prospeo hat zu dieser Kombination nichts gefunden. Am ehesten hilft ein "
        "weiteres Land, eine breitere Branche oder weniger Positionen."
    )
