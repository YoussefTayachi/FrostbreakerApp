"""Pipeline 1 — Port von n8n 'Get_Businesses'.

1. Geocoding (location -> lat/lng)
2. Places Text Search mit Pagination (nextPageToken) bis max_results
3. Upsert in public.businesses (Dedupe via workspace_id+place_id statt Name)
4. Auto-Enrichment: enqueued find_decisionmaker + hunt_persons pro Business

Drei Quellen, die sich in Schritt 1-3 unterscheiden und in Schritt 4 fast:
  maps       Google Places -> Firmen, Anreicherung per KI-Websuche + Hunter
  corporate  Hunter Discover -> Firmen, Anreicherung per KI-Websuche + Hunter
  apollo     Apollo People-Search -> Firmen UND Kontakte in einem Schritt,
             deshalb keine Anreicherung noetig (siehe pipelines/apollo.py)
  prospeo    Prospeo Search + Bulk-Enrich -> ebenfalls Firmen UND Kontakte.
             Wie Apollo, aber mit Filtern, die die anderen Wege nicht haben
             (Stellenausschreibungen, Website-Traffic, Kaufabsicht) und mit
             API-Zugang schon im kostenlosen Tarif (siehe pipelines/prospeo.py)

Die beiden Personen-Wege teilen sich den Schreibpfad in _store_people_pairs.
"""
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from worker import usage
from worker.db import sb
from worker.dedupe import businesses_to_skip
from worker.email_classify import classify_email
from worker.http_safety import raise_for_status_safe
from worker.keys import get_api_key
from worker.pipelines import apollo, prospeo
from worker.pipelines.discover import discover_companies, parse_discover_company
from worker.queue import enqueue
from worker.search_state import SearchCancelled, search_is_cancelled
from worker.suppression import domain_of, is_suppressed, load_suppression

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.priceLevel,"
    "places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,"
    "places.rating,nextPageToken"
)


def _domains(rows: list[dict]) -> set[str]:
    """Die Domains einer Sperrmenge (businesses_to_skip) als Vergleichsmenge.

    Frueher wurde hier die rohe website-Zeichenkette verglichen. Das ging
    solange gut, wie jede Quelle dieselbe Schreibweise lieferte -- Apollo gibt
    "x.com", Hunter "https://x.com", Places "https://www.x.com/". Ueber
    domain_of() ist das dieselbe Firma, als Zeichenkette waren es drei.
    """
    out = {domain_of(r.get("website")) for r in rows if r.get("website")}
    out.discard(None)
    out.discard("")
    return out  # type: ignore[return-value]


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
    #
    # Verglichen wird die Domain, nicht die Website-Zeichenkette: "x.com",
    # "https://x.com" und "https://www.x.com/" sind dieselbe Firma, und seit
    # Migration 0095 steckt in der Sperrmenge auch das Archiv, das nur die
    # blanke Domain kennt.
    existing = _domains(businesses_to_skip(ws))
    _, blocked_domains = load_suppression(ws)
    rows = []
    for c in companies:
        row = parse_discover_company(c)
        d = domain_of(row["website"])
        if not d or d in existing:
            continue
        if d in blocked_domains:
            continue
        rows.append(row | {"workspace_id": ws, "search_id": search["id"]})
        existing.add(d)
        if len(rows) >= search["max_results"]:
            break
    if rows:
        sb().table("businesses").insert(rows).execute()


def apollo_leads_today(ws: str) -> int:
    """Wie viele Apollo-Kontakte dieser Workspace in den letzten 24 Stunden
    angelegt hat -- Grundlage fuer APOLLO_MAX_PER_DAY. Gezaehlt wird der
    KONTAKT, nicht die Firma: bei Apollo entspricht ein Kontakt einem
    freigeschalteten, credit-kostenden Treffer, und genau das soll die Bremse
    begrenzen."""
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    res = (
        sb()
        .table("contacts")
        .select("id", count="exact", head=True)
        .eq("workspace_id", ws)
        .eq("source", "apollo")
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0


def prospeo_leads_today(ws: str) -> int:
    """Wie viele Prospeo-Kontakte in den letzten 24 Stunden entstanden sind.

    Gezaehlt wird wie bei Apollo der KONTAKT: bei Prospeo entspricht ein
    Kontakt einem angereicherten Treffer, und genau der kostet einen Credit.
    Die Suchseiten kosten zusaetzlich, sind aber um Groessenordnungen
    billiger (1 Credit je 25 Treffer) -- die Bremse gehoert an die teure
    Seite.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    res = (
        sb()
        .table("contacts")
        .select("id", count="exact", head=True)
        .eq("workspace_id", ws)
        .eq("source", "prospeo")
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0


def _rank_fields(
    rank_of: Callable[[str], tuple[int | None, str | None]] | None, website: str
) -> dict:
    """Die drei Rang-Spalten fuer eine Firma, oder ein leeres Dictionary.

    Leer statt None-Werte: eine Zeile ohne Rang soll gar keine
    traffic_rank-Spalten mitschicken. So bleibt ein spaeter nachgetragener
    Rang (etwa aus Tranco) unterscheidbar von einem, der aktiv als "nicht
    vorhanden" geschrieben wurde.
    """
    if rank_of is None:
        return {}
    rank, source = rank_of(website)
    if rank is None:
        return {}
    return {
        "traffic_rank": rank,
        "traffic_rank_source": source,
        "traffic_rank_at": datetime.now(timezone.utc).isoformat(),
    }


def _surviving_pairs(ws: str, pairs: list[dict]) -> tuple[dict[str, dict], dict[str, list[dict]]]:
    """Was von den gelieferten Paaren ueberhaupt gespeichert wird.

    Herausgezogen aus _store_people_pairs, weil die Antwort VOR dem Bezahlen
    gebraucht wird und nicht erst danach.
    ═══════════════════════════════════════════════════════════════════════
    Bis zum 2026-08-09 lief die Reihenfolge andersherum: Apollo lieferte die
    Paare, der Worker kaufte fuer jede gelieferte Firma den Firmendatensatz
    (1 Credit je Firma) -- und erst danach warf _store_people_pairs die
    Dubletten, gesperrten Domains und Sperrlisten-Treffer weg. Bezahlt war da
    laengst alles.

    Nachgezaehlt an einem echten Konto: 61 gekaufte Firmendatensaetze, 55
    gespeicherte Firmen. Sechs Credits fuer Zeilen, die nie eine Ansicht
    erreicht haben; bei einer der Suchen waren es 4 von 10. Der Filter stand
    hinter der Kasse.

    Auf der Personenseite laesst sich derselbe Griff NICHT anwenden: Apollos
    kostenlose Vorschau gibt die Domain nicht heraus (siehe
    apollo.collect_people), die Sperrliste kann also erst nach dem
    Freischalten greifen. Was hier gespart wird, sind die Firmendaten.
    """
    # Gegen bereits bekannte Firmen sperren (Domain als Schluessel, weil
    # weder Apollo noch Prospeo eine Google-place_id kennen).
    existing = _domains(businesses_to_skip(ws))
    sup_emails, blocked_domains = load_suppression(ws)

    # Mehrere Entscheider derselben Firma sind der Normalfall und sollen EINE
    # businesses-Zeile teilen -- sonst zaehlt das Dashboard dieselbe Firma
    # mehrfach und die Kampagnen-Auswahl "eine Person pro Firma"
    # (lib/contacts.ts) haette nichts mehr zu waehlen.
    by_website: dict[str, dict] = {}
    contacts_by_website: dict[str, list[dict]] = {}
    for pair in pairs:
        biz, contact = pair["business"], pair["contact"]
        website = biz.get("website")
        d = domain_of(website)
        if not website or not d or d in existing:
            continue
        if d in blocked_domains:
            continue
        if contact.get("email") and is_suppressed(sup_emails, blocked_domains, email=contact["email"]):
            continue
        by_website.setdefault(website, biz)
        contacts_by_website.setdefault(website, []).append(contact)
    return by_website, contacts_by_website


def _store_people_pairs(
    search: dict,
    ws: str,
    pairs: list[dict],
    transport_field: str,
    summary_of: Callable[[str], str | None],
    rank_of: Callable[[str], tuple[int | None, str | None]] | None = None,
    surviving: tuple[dict[str, dict], dict[str, list[dict]]] | None = None,
) -> tuple[int, int]:
    """Personen-plus-Firma-Paare entdoppeln, filtern und schreiben.

    Herausgezogen aus run_apollo, als Prospeo als vierter Weg dazukam. Der
    Ablauf ist fuer beide Wege identisch, und eine zweite Kopie waere die
    Sorte Verdopplung, die genau so lange gleich bleibt, bis jemand nur eine
    der beiden Stellen repariert.

    Was sich zwischen den Anbietern UNTERSCHEIDET und deshalb von aussen
    hereingereicht wird:

      transport_field  das Feld, das nur dem Anreichern diente (apollo_id
                       bzw. prospeo_id) und nicht in die Datenbank gehoert
      summary_of       woher die Firmenbeschreibung kommt. Apollo holt sie
                       in einem eigenen, kostenlosen Aufruf ueber die Domain;
                       Prospeo liefert sie je Treffer gleich mit
      rank_of          Popularitaetsrang und dessen Quelle je Website
                       (Migration 0079). Optional, weil ihn nicht jeder Weg
                       liefert: Google Maps kennt so etwas gar nicht, und
                       Prospeo gibt ihn nur im Pro-Tarif heraus.

      surviving        bereits ermitteltes Ergebnis von _surviving_pairs. Der
                       Apollo-Weg braucht es schon vorher, um nur noch die
                       Firmen anzureichern, die auch gespeichert werden --
                       ohne diesen Durchreichweg wuerde derselbe Filter
                       zweimal laufen und dabei zweimal die Sperrliste laden.

    Gibt (geschriebene Firmen, geschriebene Kontakte) zurueck. 0 Firmen heisst
    "geliefert, aber alles schon bekannt oder gesperrt" -- eine ganz andere
    Auskunft als "nichts gefunden", und der Aufrufer formuliert sie selbst.
    """
    by_website, contacts_by_website = (
        surviving if surviving is not None else _surviving_pairs(ws, pairs)
    )

    if not by_website:
        return 0, 0

    websites = list(by_website)
    rows = [
        by_website[w]
        | {
            "workspace_id": ws,
            "search_id": search["id"],
            # Der Ansprechpartner kam mit -- die Entscheider-Recherche ist
            # damit erledigt und darf nicht noch einmal Geld kosten.
            "decisionmaker_status": "found",
            # hunt_persons laeuft fuer diese Wege grundsaetzlich nicht
            # (Hunter-Credits fuer Daten, die schon da sind).
            "hunter_status": "not_found",
            # Leer lassen, wenn nichts da ist: personalize hat dann weiterhin
            # den Website-Rueckfall.
            "company_summary": summary_of(w),
            # Rang, Quelle und Zeitpunkt zusammen -- eine nackte Zahl liesse
            # nicht erkennen, ob sie von heute stammt oder aus Alexas
            # Altbestand (siehe Migration 0079).
            **_rank_fields(rank_of, w),
        }
        for w in websites
    ]
    inserted = sb().table("businesses").insert(rows).execute().data or []

    contact_rows = []
    for biz_row, website in zip(inserted, websites):
        for c in contacts_by_website[website]:
            email = c.get("email")
            if not email:
                continue  # Freischalten fehlgeschlagen -> kein verwertbarer Lead
            email_type = classify_email(email)
            if email_type == "generic":
                continue  # Rollen-Adresse: gleiche Regel wie bei Hunter/KI
            contact_rows.append(
                {k: v for k, v in c.items() if k != transport_field}
                | {
                    "workspace_id": ws,
                    "business_id": biz_row["id"],
                    "email_type": email_type,
                }
            )
    if contact_rows:
        sb().table("contacts").insert(contact_rows).execute()

    # Firmen, fuer die am Ende kein brauchbarer Kontakt uebrig blieb, ehrlich
    # als 'not_found' markieren statt sie als 'found' zu fuehren -- sonst zeigt
    # die Suchliste einen Fortschritt, den es nicht gibt.
    with_contact = {r["business_id"] for r in contact_rows}
    empty_ids = [r["id"] for r in inserted if r["id"] not in with_contact]
    if empty_ids:
        sb().table("businesses").update({"decisionmaker_status": "not_found"}).in_(
            "id", empty_ids
        ).execute()

    return len(inserted), len(contact_rows)


def _note(search_id: str, text: str) -> None:
    """Erklaerung zu einer durchgelaufenen Suche hinterlegen.

    Bewusst getrennt von searches.error: error heisst "fehlgeschlagen" und wird
    im Frontend rot als Fehlschlag gezeigt. Diese Suche ist aber nicht
    fehlgeschlagen, sie hat nur nichts gefunden -- und der Unterschied ist fuer
    den Nutzer wesentlich.
    """
    sb().table("searches").update({"note": text[:1000]}).eq("id", search_id).execute()


def run_apollo(search: dict, ws: str) -> None:
    """Apollo-Modus: fertig angereicherte Personen samt Firma holen und
    speichern.

    Entdopplung und Blockliste laufen hier zwangslaeufig NACH der Anreicherung,
    anders als im Corporate-Modus. Grund ist Apollos API: die kostenlose Suche
    liefert keine Firmendomain, und ohne Domain gibt es keinen Schluessel, gegen
    den sich vorher entdoppeln liesse. Ein bereits bekannter Lead kann also
    einen Credit kosten und danach verworfen werden. Begrenzt wird das ueber
    max_results (die Anreicherung stoppt exakt bei dieser Zahl) statt ueber eine
    Vorfilterung, die technisch nicht moeglich ist.
    """
    api_key = get_api_key(ws, "apollo")
    already_today = apollo_leads_today(ws)
    remaining_today = apollo.APOLLO_MAX_PER_DAY - already_today
    if remaining_today <= 0:
        raise apollo.ApolloDailyCapReached(
            f"Tageskontingent erreicht: {already_today} Apollo-Leads in den letzten "
            f"24 Stunden (Grenze {apollo.APOLLO_MAX_PER_DAY}). Die Suche laeuft "
            "automatisch weiter, sobald wieder Kontingent frei ist."
        )
    wanted = min(search["max_results"], remaining_today)

    filters = search.get("filters") or {}
    # Apollo rechnet pro freigeschalteter Adresse ab. Der Betrag bleibt leer:
    # was ein Credit in Euro wert ist, haengt am gebuchten Tarif und liesse
    # sich hier nur unterstellen (siehe worker/usage.py).
    # Die Firmen, die dieser Workspace schon hat -- als normalisierte Namen.
    #
    # Sie gehen in die KOSTENLOSE Suchstufe, nicht erst in die Pruefung nach
    # dem Anreichern. Vorher lief es andersherum, und das war teuer: am
    # 2026-08-09 lieferte eine Suche genau eine Person, sie wurde angereichert
    # (2 Credits) und danach als Dublette verworfen -- null Leads, und die
    # Suche gab auf, obwohl Apollo fuer dieselben Filter hunderte weitere
    # Treffer hatte.
    #
    # Der Name ist das einzige Merkmal, das Apollos Vorschau hergibt; die
    # Domain kommt erst mit dem bezahlten Datensatz. Die Abwaegung dazu steht
    # in apollo.collect_people.
    known_companies = {
        apollo.normalize_company(b.get("name"))
        for b in businesses_to_skip(ws)
        if b.get("name")
    }
    known_companies.discard("")

    skipped: list[int] = []
    pairs = apollo.collect_people(
        filters,
        api_key,
        wanted,
        on_charge=lambda n: usage.record(
            ws, "apollo", "bulk_match", n, "credits", search_id=search["id"]
        ),
        known_companies=known_companies,
        on_skip=skipped.append,
        # Wird vor jedem bulk_match-Paket gefragt. Das ist der einzige Punkt,
        # an dem ein Abbruch noch Geld spart -- danach ist alles bezahlt.
        should_stop=lambda: search_is_cancelled(search["id"]),
    )
    # Nach der Suche noch einmal: die teuren Folgeschritte (Firmendaten,
    # Aufhaenger je Lead) sollen gar nicht erst anlaufen. Was bis hierher
    # gefunden wurde, wird trotzdem gespeichert -- dafuer ist bereits bezahlt,
    # und es wegzuwerfen waere die zweite Verschwendung nach der ersten.
    if search_is_cancelled(search["id"]):
        _store_people_pairs(
            search, ws, pairs,
            transport_field="apollo_id",
            summary_of=lambda _w: None,
        )
        raise SearchCancelled(search["id"])
    if not pairs:
        if skipped and skipped[0]:
            # Wichtige Unterscheidung: hier sind die Filter NICHT schuld. Apollo
            # hat geliefert, es war nur alles schon im Bestand. Die
            # Ursachensuche unten wuerde stattdessen einen Filter beschuldigen
            # und den Nutzer dazu bringen, eine funktionierende Suche
            # umzubauen.
            _note(
                search["id"],
                f"Apollo hat {skipped[0]} Treffer geliefert, aber alle gehören zu Firmen, "
                "die du schon in der Liste hast. Es wurden keine Credits verbraucht. "
                "Für neue Leads hilft ein anderer Filter — etwa ein weiteres Land, "
                "andere Positionen oder ein zusätzliches Marktsegment.",
            )
            return
        # "Fertig, 0 Leads" ohne Begruendung ist die frustrierendste Auskunft,
        # die diese Suche geben kann -- der Nutzer sieht sechs Filter und weiss
        # nicht, welcher schuld war. Die Ursachensuche kostet keine Credits und
        # laeuft nur hier, auf dem Null-Pfad.
        _note(search["id"], apollo.explain_empty_result(filters, api_key))
        return

    # Entdopplung, Sperrliste und Schreiben stehen seit dem Prospeo-Einbau in
    # _store_people_pairs -- der Ablauf ist fuer beide Personen-Wege
    # identisch. Was Apollo-spezifisch bleibt, steht hier:
    #
    # Firmenbeschreibungen kommen bei Apollo aus einem eigenen Aufruf. Ohne
    # sie faellt personalize auf den Website-Text zurueck, und den geben die
    # wenigsten Shops her: bei einer echten Supplement-Suche antworteten alle
    # geprueften Seiten mit HTTP 429 auf unseren Crawler, am Ende hatten 10
    # von 45 Firmen eine Zeile. Ueber Apollos Firmen-Endpunkt waren es 35 von
    # 35 -- und er kostet keine Credits, weil Apollo nur Exporte abrechnet.
    #
    # ERST FILTERN, DANN BEZAHLEN. Angereichert werden nur die Firmen, die
    # auch in der Datenbank landen -- nicht alles, was Apollo geliefert hat.
    # Vorher lief der Aufruf ueber saemtliche Treffer, und die Dubletten und
    # Sperrlisten-Firmen flogen erst danach raus: an einem echten Konto 61
    # gekaufte Firmendatensaetze fuer 55 gespeicherte Firmen (siehe
    # _surviving_pairs).
    surviving = _surviving_pairs(ws, pairs)
    websites = sorted(surviving[0])
    # fetch_company_facts statt fetch_company_summaries: derselbe Aufruf,
    # aber er gibt zusaetzlich das alexa_ranking heraus, das bis 2026-08-05
    # weggeworfen wurde (Migration 0079).
    #
    # Der Aufruf KOSTET Credits -- 1 je Firma. Bis 2026-08-05 stand in
    # apollo.py das Gegenteil, und deshalb wurde er nie verbucht. Eine
    # Apollo-Suche kostet damit rund doppelt so viel, wie die Kostenseite
    # bisher auswies: einmal fuer die Adressen, einmal fuer die Firmendaten.
    facts = apollo.fetch_company_facts(
        [domain_of(w) or "" for w in websites],
        api_key,
        on_charge=lambda n: usage.record(
            ws, "apollo", "organizations/bulk_enrich", n, "credits", search_id=search["id"]
        ),
    )

    companies, _contacts = _store_people_pairs(
        search,
        ws,
        pairs,
        transport_field="apollo_id",  # nur Transportfeld fuer bulk_match
        summary_of=lambda w: (facts.get(domain_of(w) or "") or {}).get("summary"),
        rank_of=lambda w: (
            (facts.get(domain_of(w) or "") or {}).get("traffic_rank"),
            "apollo_alexa",
        ),
        # Derselbe Filterlauf, der oben ueber die Anreicherung entschieden
        # hat. Ein zweiter Durchlauf koennte inzwischen anders ausfallen --
        # etwa weil eine parallele Suche dieselbe Firma gerade angelegt hat --
        # und dann waeren Credits fuer Daten bezahlt, die niemand speichert.
        surviving=surviving,
    )
    if companies == 0:
        # Hier ist die Ursache bekannt und die Filter sind unschuldig: Apollo
        # hat geliefert, aber alles war schon bekannt oder gesperrt. Das ist
        # eine ganz andere Auskunft als "Filter zu eng" -- und ein Hinweis, dass
        # hier Credits fuer Leads ausgegeben wurden, die danach wegfielen.
        _note(
            search["id"],
            f"Apollo hat {len(pairs)} Personen geliefert, aber alle gehören zu Firmen, die "
            "bereits in deiner Liste stehen oder auf der Sperrliste sind. Für neue Leads "
            "hilft nur ein anderer Filter, etwa ein weiteres Land oder andere Positionen.",
        )


def run_prospeo(search: dict, ws: str) -> None:
    """Prospeo-Modus: Personensuche, Anreicherung, speichern.

    Aufbau wie run_apollo -- mit drei Unterschieden, die aus Prospeos API
    folgen:

      1. Die SUCHE kostet Credits (1 je 25 Treffer). Bei Apollo ist sie
         gratis. Deshalb werden hier ZWEI Verbrauchszeilen geschrieben, eine
         je Kostenart -- sonst liesse sich in der Kostenansicht nicht mehr
         auseinanderhalten, wofuer das Kontingent draufging.
      2. Die Firmenbeschreibung kommt je Treffer mit, es braucht also keinen
         zweiten Aufruf.
      3. Ein 403 heisst hier meist nicht "kein Zugang", sondern "dieser
         Filter braucht einen hoeheren Tarif" (Technologie ab Starter,
         Website-Traffic ab Pro). ProspeoPlanError traegt diesen Unterschied.
    """
    api_key = get_api_key(ws, "prospeo")
    already_today = prospeo_leads_today(ws)
    remaining_today = prospeo.PROSPEO_MAX_PER_DAY - already_today
    if remaining_today <= 0:
        raise prospeo.ProspeoDailyCapReached(
            f"Tageskontingent erreicht: {already_today} Prospeo-Leads in den letzten "
            f"24 Stunden (Grenze {prospeo.PROSPEO_MAX_PER_DAY}). Die Suche laeuft "
            "automatisch weiter, sobald wieder Kontingent frei ist."
        )
    wanted = min(search["max_results"], remaining_today)
    filters = search.get("filters") or {}

    # Zwei Kostenarten, zwei Zeilen. Der Betrag bleibt leer: was ein Credit in
    # Euro wert ist, haengt am gebuchten Tarif und liesse sich hier nur
    # unterstellen (siehe worker/usage.py und die Kostenseite).
    pairs = prospeo.collect_people(
        filters,
        api_key,
        wanted,
        on_search_charge=lambda n: usage.record(
            ws, "prospeo", "search-person", n, "credits", search_id=search["id"]
        ),
        on_enrich_charge=lambda n: usage.record(
            ws, "prospeo", "bulk-enrich-person", n, "credits", search_id=search["id"]
        ),
    )
    if not pairs:
        # "Fertig, 0 Leads" ohne Begruendung ist die frustrierendste Auskunft,
        # die diese Suche geben kann. Die Ursachensuche kostet je Versuch eine
        # Suchseite und laeuft nur hier, auf dem Null-Pfad.
        _note(search["id"], prospeo.explain_empty_result(filters, api_key))
        return

    # Prospeo liefert die Beschreibung je Treffer mit -- kein zweiter Aufruf.
    summaries = {
        p["business"]["website"]: p.get("company_summary")
        for p in pairs
        if p["business"].get("website")
    }

    companies, _contacts = _store_people_pairs(
        search,
        ws,
        pairs,
        transport_field="prospeo_id",  # nur Transportfeld fuer bulk-enrich
        summary_of=summaries.get,
    )
    if companies == 0:
        _note(
            search["id"],
            f"Prospeo hat {len(pairs)} Personen geliefert, aber alle gehören zu Firmen, die "
            "bereits in deiner Liste stehen oder auf der Sperrliste sind. Für neue Leads "
            "hilft nur ein anderer Filter, etwa ein weiteres Land oder andere Positionen.",
        )


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
    # note wird aus demselben Grund zurueckgesetzt wie error: sonst stuende
    # nach einem erfolgreichen zweiten Versuch noch die Erklaerung des ersten
    # ("keine Treffer, Technologie-Filter schuld") an einer Suche, die gerade
    # Leads geliefert hat.
    sb().table("searches").update({"status": "running", "error": None, "note": None}).eq(
        "id", search_id
    ).execute()
    source = search.get("source", "maps")
    try:
        if source == "corporate":
            run_corporate(search, ws)
            _finish(search_id, ws, auto_enrich, source)
            return
        if source == "apollo":
            run_apollo(search, ws)
            _finish(search_id, ws, auto_enrich, source)
            return
        if source == "prospeo":
            run_prospeo(search, ws)
            _finish(search_id, ws, auto_enrich, source)
            return
        api_key = get_api_key(ws, "google_maps")
        loc = geocode(search["location"], api_key)
        skip = businesses_to_skip(ws)
        known = {b["place_id"] for b in skip if b.get("place_id")}
        # Zweiter Schluessel neben der place_id, seit das Archiv mitspielt
        # (Migration 0095): eine endgueltig geloeschte Liste hinterlaesst keine
        # place_id, nur die Domain. Ohne diese Menge faende dieselbe
        # Maps-Suche die bereits angeschriebene Firma erneut.
        #
        # Bewusst NUR die Archiv-Eintraege: Google Places liefert jede Filiale
        # als eigene place_id mit derselben Firmen-Website. Wuerde hier gegen
        # alle bekannten Domains gesperrt, verschwaende die zweite Suche einer
        # Kette alle Filialen bis auf eine.
        known_domains = _domains([b for b in skip if b.get("from_archive")])
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
                if d and (d in blocked_domains or d in known_domains):
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
    if source in ("apollo", "prospeo"):
        # Beide Personen-Wege haben Firma UND Kontakt schon geliefert -- weder
        # find_decisionmaker (OpenAI-Kosten) noch hunt_persons (Hunter-Credits)
        # haetten hier etwas beizutragen. Personalisiert werden muss aber
        # trotzdem, sonst geht die Kampagne ohne Icebreaker raus.
        #
        # Unterschied zwischen den beiden: Apollo liefert keine
        # company_summary, dort ist der Website-Text die Basis. Prospeo
        # liefert sie mit (Beschreibung, Technik, Branche), der Aufhaenger
        # wird dadurch spezifischer. personalize.py faellt bei fehlender
        # summary ohnehin auf die Website zurueck -- der Zweig ist deshalb
        # fuer beide derselbe.
        for b in (
            sb()
            .table("businesses")
            .select("id")
            .eq("search_id", search_id)
            .eq("decisionmaker_status", "found")
            .execute()
            .data
            or []
        ):
            enqueue(ws, "personalize", {"business_id": b["id"]})
        return
    # Genau EINE Adressquelle pro Suchweg. Vorher liefen bei Maps beide
    # (KI-Websuche UND Hunter), was denselben Kontakt zweimal bezahlte: einmal
    # mit OpenAI-Kosten, einmal mit einem Hunter-Credit.
    #
    #   maps       Google Places hat keine Adressen -> KI-Websuche
    #              (find_decisionmaker). Kein Hunter, keine Credits.
    #   corporate  Die Firma kam aus Hunters Discover -> die Adresse holt
    #              derselbe Anbieter (hunt_persons). Kostet einen Credit pro
    #              gefundener Adresse, dafuer ist sie geprueft statt geraten.
    #
    # Folge fuer Corporate, die man kennen muss: ohne find_decisionmaker gibt es
    # dort keine company_summary. personalize faellt dann auf den Website-Text
    # zurueck -- genauso wie im Apollo-Modus, siehe oben. Corporate-Firmen haben
    # immer eine Website (sie stammt aus Hunters Domain, siehe run_corporate),
    # der Fallback greift also verlaesslich.
    #
    # Weil hunt_persons dadurch der einzige Schritt in seinem Modus ist, setzt
    # es dort auch decisionmaker_status (siehe pipelines/hunt_persons.py). Wer
    # hunt_persons je wieder fuer Maps aktiviert, muss das mitbedenken: dann
    # schreiben zwei Jobs dasselbe Feld.
    use_hunter = source == "corporate"
    for b in (
        sb()
        .table("businesses")
        .select("id,website")
        .eq("search_id", search_id)
        .eq("decisionmaker_status", "pending")
        .execute()
        .data
    ):
        if use_hunter:
            if b.get("website"):
                enqueue(ws, "hunt_persons", {"business_id": b["id"]})
        else:
            enqueue(ws, "find_decisionmaker", {"business_id": b["id"]})
        # personalize funktioniert auch ohne Website (Basis: company_summary aus
        # find_decisionmaker); wartet ueber NotReadyYet + Queue-Retry, falls die
        # Recherche noch laeuft.
        enqueue(ws, "personalize", {"business_id": b["id"]})
