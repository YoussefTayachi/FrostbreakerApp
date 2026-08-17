"""Unit-Tests fuer die reinen Apollo-Funktionen (kein Netz, keine DB)."""
import pytest

from worker.pipelines.apollo import (
    APOLLO_EMPLOYEE_RANGES,
    APOLLO_MAX_PER_SEARCH,
    APOLLO_SENIORITIES,
    DECISIONMAKER_SENIORITIES,
    MAX_SUMMARY_CHARS,
    PER_PAGE,
    ApolloPlanError,
    _employee_range,
    alexa_rank,
    build_company_summary,
    build_people_search_body,
    candidate_ids,
    enrich_people,
    explain_empty_result,
    fetch_company_summaries,
    is_masked_email,
    is_platform_domain,
    parse_apollo_person,
)


@pytest.fixture(autouse=True)
def kein_cache(monkeypatch):
    """Der Apollo-Cache wird in JEDEM Test stillgelegt.

    Die erste Zeile dieser Datei verspricht "kein Netz, keine DB". Seit
    `enrich_people` den kontoweiten Cache befragt (Commit 26ad32c), stimmte
    das nicht mehr: `apollo_cache.get_many` geht an Supabase. Fuenf Tests aus
    dem Commit davor kannten ihn nicht und fielen deshalb um — nicht weil die
    geprueften Regeln falsch waren, sondern weil der Cache alle Kandidaten als
    "schon bezahlt" zurueckgab und der bezahlte Aufruf nie stattfand.

    Autouse und nicht je Test eingehaengt, damit der naechste hinzugefuegte
    Test nicht dieselbe Falle findet. Wer den Cache PRUEFEN will, setzt ihn im
    Test selbst neu — eine spaetere Ersetzung gewinnt gegen diese hier.
    """
    from worker import apollo_cache

    monkeypatch.setattr(apollo_cache, "get_many", lambda api_key, kind, ids: {})
    monkeypatch.setattr(apollo_cache, "put_many", lambda api_key, kind, items: None)


def test_build_body_always_filters_to_verified_emails():
    """Kern der Integration: ohne diesen Filter kaeme derselbe
    Trefferquoten-Verlust zurueck, den Apollo loesen soll."""
    body = build_people_search_body({"keywords": "supplements"}, page=1)
    assert body["contact_email_status"] == ["verified"]
    assert body["person_seniorities"] == DECISIONMAKER_SENIORITIES
    assert body["per_page"] == PER_PAGE
    assert body["page"] == 1


def test_build_body_maps_all_filters():
    body = build_people_search_body(
        {
            "person_titles": "Founder, CEO , ",
            "apollo_locations": ["Germany", " Austria "],
            "keywords": "supplements, nutrition",
            "headcount": "11-20",
            "domains": "example.com",
        },
        page=3,
    )
    assert body["person_titles"] == ["Founder", "CEO"]
    assert body["organization_locations"] == ["Germany", "Austria"]
    assert body["q_organization_keyword_tags"] == ["supplements", "nutrition"]
    assert body["organization_num_employees_ranges"] == ["11,20"]
    assert body["q_organization_domains_list"] == ["example.com"]
    assert body["page"] == 3


def test_build_body_maps_technologies():
    """Der Technologie-Filter ist der Grund, warum sich ein Shopify-Shop
    gezielt finden laesst statt ueber das Keyword "ecommerce" geraten."""
    body = build_people_search_body(
        {"keywords": "ecommerce", "technologies": ["shopify", " shopware ", "shopify"]},
        page=1,
    )
    assert body["currently_using_any_of_technology_uids"] == ["shopify", "shopware"]


def test_technologies_alone_are_a_sufficient_filter():
    """"Alle Shopify-Shops" ist eine vollwertige Zielgruppe — ohne diesen
    Zweig haette build_body sie als filterlos abgelehnt."""
    body = build_people_search_body({"technologies": ["shopify"]}, page=1)
    assert body["currently_using_any_of_technology_uids"] == ["shopify"]


def test_build_body_ignores_unusable_technology_values():
    body = build_people_search_body(
        {"keywords": "ecommerce", "technologies": ["", "  ", None, 42]},
        page=1,
    )
    assert "currently_using_any_of_technology_uids" not in body


def test_build_body_ignores_technologies_that_are_not_a_list():
    body = build_people_search_body({"keywords": "ecommerce", "technologies": "shopify"}, page=1)
    assert "currently_using_any_of_technology_uids" not in body


def test_market_segments_are_passed_through_in_apollos_own_spelling():
    """Die Werte sind Apollos, nicht unsere — "ecommerce" ohne Bindestrich.

    Am 2026-08-09 gegen die echte API gemessen: der Parameter heisst
    market_segments (organization_market_segments wird still ignoriert).
    """
    body = build_people_search_body(
        {"market_segments": ["saas", "ecommerce", "non_profit"]}, page=1
    )
    # Reihenfolge folgt APOLLO_MARKET_SEGMENTS, nicht der Klickreihenfolge --
    # nur so ist der Body zwischen Zaehler und Worker vergleichbar.
    assert body["market_segments"] == ["ecommerce", "non_profit", "saas"]


def test_market_segments_alone_are_a_sufficient_filter():
    """"Alle SaaS-Firmen in den USA" ist eine vollwertige Zielgruppe."""
    body = build_people_search_body({"market_segments": ["saas"]}, page=1)
    assert body["market_segments"] == ["saas"]


def test_build_body_drops_unknown_market_segments():
    """Apollo verwirft unbekannte Werte stillschweigend. Kaemen sie durch,
    zaehlte der Trefferzaehler einen Filter, den die Suche nicht anwendet."""
    body = build_people_search_body(
        {"keywords": "ecommerce", "market_segments": ["healthcare", "b2b"]}, page=1
    )
    assert body["market_segments"] == ["b2b"]


def test_build_body_ignores_market_segments_that_are_not_a_list():
    body = build_people_search_body({"keywords": "ecommerce", "market_segments": "saas"}, page=1)
    assert "market_segments" not in body


def test_build_body_rejects_filterless_search():
    """Ohne inhaltlichen Filter wuerde Apollo einen beliebigen Querschnitt
    seiner Datenbank liefern — teuer und wertlos."""
    with pytest.raises(ValueError):
        build_people_search_body({}, page=1)


def test_employee_range_translation():
    assert _employee_range("11-20") == "11,20"
    assert _employee_range("10001+") == "10001,1000000"
    assert _employee_range(None) is None
    assert _employee_range("") is None


def test_employee_range_rejects_stufen_die_apollo_nicht_kennt():
    """"11-50" war unsere eigene Erfindung — Apollo akzeptiert sie technisch,
    zeigt sie in der Oberflaeche aber nicht an. Eine stille Abweichung von dem,
    was der Kunde dort sieht, ist schlechter als kein Filter."""
    assert _employee_range("11-50") is None
    assert _employee_range("51-200") is None


def test_all_apollo_employee_ranges_translate():
    for value in APOLLO_EMPLOYEE_RANGES:
        translated = _employee_range(value)
        assert translated is not None, value
        low, _, high = translated.partition(",")
        assert low.isdigit() and high.isdigit(), value


SEARCH_PREVIEW_PERSON = {
    # So sieht eine Person in der Antwort von mixed_people/api_search
    # tatsaechlich aus: anonymisiert, ohne name, ohne email, und die
    # organization enthaelt ausser dem Namen nur has_*-Flags.
    "id": "apollo-1",
    "first_name": "Anna",
    "last_name_obfuscated": "B.",
    "title": "Head of Marketing",
    "has_email": True,
    "organization": {"name": "Example GmbH", "has_industry": True, "has_phone": True},
}


def test_search_preview_is_not_parseable_into_a_lead():
    """Der urspruengliche Fehler: der Parser wurde auf die Suchantwort
    angewendet statt auf die Anreicherung. Er verwarf dann jede Person, die
    Suche endete ohne Fehler mit null Treffern — und niemand sah warum."""
    assert parse_apollo_person(SEARCH_PREVIEW_PERSON) is None


def test_candidate_ids_keeps_only_people_with_an_email():
    people = [
        SEARCH_PREVIEW_PERSON,
        {"id": "apollo-2", "has_email": False},
        {"id": "apollo-3", "has_email": True},
        {"has_email": True},  # ohne id nicht anreicherbar
        dict(SEARCH_PREVIEW_PERSON),  # Dublette aus ueberlappenden Seiten
    ]
    assert candidate_ids(people) == ["apollo-1", "apollo-3"]


def _match(pid: str) -> dict:
    return {
        "id": pid,
        "name": f"Person {pid}",
        "email": f"{pid}@example.com",
        "organization": {"name": "Shop", "primary_domain": "shop.example"},
    }


def test_enrich_stops_at_the_requested_number(monkeypatch):
    """Credit-Schutz: wer fuenf Leads will, darf nicht zehn bezahlen. Die
    Paketgroesse richtet sich nach dem Rest, nicht nach BULK_MATCH_CHUNK."""
    billed: list[int] = []

    def fake_chunk(ids, api_key):
        billed.append(len(ids))
        return [_match(i) for i in ids]

    monkeypatch.setattr("worker.pipelines.apollo._bulk_match_chunk", fake_chunk)
    out = enrich_people([f"id-{i}" for i in range(30)], "key", wanted=5)
    assert len(out) == 5
    assert billed == [5], "Es darf genau ein Paket mit genau 5 Personen angefragt werden"


def test_enrich_refills_when_a_match_is_unusable(monkeypatch):
    """Ein Treffer ohne Firmendomain ist kein Lead — dann muss nachgeladen
    werden, sonst liefert die Suche weniger als bestellt."""
    def fake_chunk(ids, api_key):
        return [
            _match(i) if i != "id-0" else {"id": "id-0", "name": "X", "organization": {}}
            for i in ids
        ]

    monkeypatch.setattr("worker.pipelines.apollo._bulk_match_chunk", fake_chunk)
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)
    out = enrich_people(["id-0", "id-1", "id-2"], "key", wanted=2)
    assert len(out) == 2


def test_masked_email_detection():
    """Apollo maskiert nicht freigeschaltete Adressen — unveraendert
    gespeichert waere das eine garantiert bouncende Fantasieadresse."""
    assert is_masked_email("email_not_unlocked@domain.com")
    assert is_masked_email(None)
    assert is_masked_email("")
    assert not is_masked_email("anna@example.com")


def test_parse_person_full():
    parsed = parse_apollo_person(
        {
            "id": "apollo-1",
            "name": "Anna Berger",
            "first_name": "Anna",
            "last_name": "Berger",
            "title": "Head of Marketing",
            "seniority": "head",
            "departments": ["marketing"],
            "email": "anna@example.com",
            "email_status": "verified",
            "linkedin_url": "https://linkedin.com/in/annaberger",
            "organization": {
                "name": "Example Supplements GmbH",
                "primary_domain": "example.com",
                "website_url": "https://example.com",
                "city": "Vienna",
                "country": "Austria",
                "primary_phone": {"number": "+43 1 234"},
            },
        }
    )
    assert parsed is not None
    assert parsed["business"]["name"] == "Example Supplements GmbH"
    assert parsed["business"]["website"] == "https://example.com"
    assert parsed["business"]["address"] == "Vienna, Austria"
    assert parsed["business"]["place_id"] is None  # Apollo kennt keine place_id
    assert parsed["contact"]["email"] == "anna@example.com"
    assert parsed["contact"]["source"] == "apollo"
    assert parsed["contact"]["apollo_id"] == "apollo-1"
    assert parsed["contact"]["department"] == "marketing"


def test_parse_person_masked_email_becomes_none_not_placeholder():
    parsed = parse_apollo_person(
        {
            "id": "apollo-2",
            "name": "Ben Klein",
            "email": "email_not_unlocked@domain.com",
            "organization": {"name": "Shop", "primary_domain": "shop.example"},
        }
    )
    assert parsed is not None
    # Muss None sein, damit run_apollo() den Kontakt zum Freischalten einreiht
    # statt die Platzhalter-Adresse zu speichern.
    assert parsed["contact"]["email"] is None


def test_parse_person_without_company_or_name_is_dropped():
    """Ohne Domain laesst sich nicht entdoppeln und nicht personalisieren,
    ohne Namen gibt es keinen Ansprechpartner."""
    assert parse_apollo_person({"name": "Ohne Firma", "organization": {}}) is None
    assert (
        parse_apollo_person({"organization": {"name": "Firma", "primary_domain": "x.example"}})
        is None
    )


def test_parse_person_falls_back_to_domain_when_org_name_missing():
    parsed = parse_apollo_person(
        {
            "name": "Cara Lang",
            "organization": {"primary_domain": "nutrition.example"},
        }
    )
    assert parsed is not None
    assert parsed["business"]["name"] == "nutrition.example"
    assert parsed["business"]["website"] == "https://nutrition.example"


def test_search_cap_is_a_whole_number_of_pages():
    """collect_people blaettert bis APOLLO_MAX_PER_SEARCH // PER_PAGE — bei
    einem Rest waere die letzte Seite unerreichbar."""
    assert APOLLO_MAX_PER_SEARCH % PER_PAGE == 0


def test_default_seniorities_are_all_valid_apollo_values():
    assert set(DECISIONMAKER_SENIORITIES) <= set(APOLLO_SENIORITIES)


def test_partner_is_a_valid_seniority():
    """Regressionsschutz: "partner" wurde einmal aufgrund einer unvollstaendigen
    Websuche entfernt, obwohl Apollos eigene Oberflaeche es fuehrt — fuer
    Kanzleien und Beratungen ist es die wichtigste Stufe ueberhaupt."""
    assert "partner" in APOLLO_SENIORITIES
    assert "partner" in DECISIONMAKER_SENIORITIES
    body = build_people_search_body(
        {"keywords": "law", "apollo_seniorities": ["partner"]}, page=1
    )
    assert body["person_seniorities"] == ["partner"]


def test_seniorities_from_form_are_filtered_against_apollo_enum():
    body = build_people_search_body(
        {"keywords": "supplements", "apollo_seniorities": ["owner", "bogus", "manager"]},
        page=1,
    )
    assert body["person_seniorities"] == ["owner", "manager"]


def test_seniorities_fall_back_when_selection_is_empty_or_invalid():
    """Ohne Einschraenkung wuerde Apollo quer durch alle Hierarchiestufen
    Credits verbrauchen — deshalb nie leer weitergeben."""
    for raw in ([], ["nonsense"], None, "owner"):
        body = build_people_search_body(
            {"keywords": "supplements", "apollo_seniorities": raw}, page=1
        )
        assert body["person_seniorities"] == DECISIONMAKER_SENIORITIES


# --- Ursachensuche bei null Treffern ---------------------------------------
# Eine leere Suche meldete bisher nur "fertig, 0 Leads". Diese Tests halten
# fest, dass sie stattdessen benennt, WORAN es lag — ohne dabei je selbst zur
# Fehlerquelle zu werden.

def _stub_search(monkeypatch, handler):
    """post_search durch eine Attrappe ersetzen; zaehlt die Aufrufe mit."""
    calls: list[dict] = []

    def fake(body, api_key):
        calls.append(body)
        return handler(body)

    monkeypatch.setattr("worker.pipelines.apollo.post_search", fake)
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)
    return calls


def test_explain_names_the_filter_that_costs_the_hits(monkeypatch):
    """Der Fall vom 2026-08-02: ein Technologie-Slug, den Apollo nicht kennt.
    Ohne diesen Filter gibt es Treffer — genau das muss die Meldung sagen."""
    def handler(body):
        if "currently_using_any_of_technology_uids" in body:
            return {"people": [], "total_entries": 0}
        return {"people": [], "total_entries": 4711}

    _stub_search(monkeypatch, handler)
    msg = explain_empty_result(
        {"keywords": "marketing agency", "technologies": ["gibt-es-nicht"]}, "key"
    )
    assert "Technologie-Filter" in msg
    assert "4.711" in msg, "Die Zahl belegt die Aussage, ohne sie ist es eine Behauptung"
    # Die Tausenderpunkte duerfen nur die Zahl treffen. Ein .replace(",", ".")
    # ueber die ganze Meldung machte aus dem Satzkomma einen Punkt mitten im
    # Satz ("zur restlichen Auswahl. oder Apollo kennt ...").
    assert "Auswahl, oder" in msg, "Satzkommata muessen Kommata bleiben"


def test_explain_reports_people_without_email_separately(monkeypatch):
    """Passende Personen ohne hinterlegte Adresse sind ein anderes Problem als
    ein zu enger Filter — ein anderer Filter wuerde hier nicht helfen."""
    _stub_search(
        monkeypatch,
        lambda body: {"people": [{"id": "a", "has_email": False}], "total_entries": 12},
    )
    msg = explain_empty_result({"keywords": "supplements"}, "key")
    assert "E-Mail" in msg
    assert "Technologie" not in msg


def test_explain_reports_enrichment_gap(monkeypatch):
    """Kandidaten mit Adresse waren da, es kam trotzdem nichts an: dann liegt
    es am Freischalten, nicht an den Filtern."""
    _stub_search(
        monkeypatch,
        lambda body: {"people": [{"id": "a", "has_email": True}], "total_entries": 9},
    )
    msg = explain_empty_result({"keywords": "supplements"}, "key")
    assert "Freischalten" in msg


def test_explain_says_so_when_no_single_filter_is_to_blame(monkeypatch):
    """Wenn auch das Weglassen jedes einzelnen Filters nichts bringt, ist die
    Kombination schuld — dann darf die Meldung keinen Suendenbock erfinden."""
    _stub_search(monkeypatch, lambda body: {"people": [], "total_entries": 0})
    msg = explain_empty_result(
        {"keywords": "x", "technologies": ["shopify"], "person_titles": "CEO"}, "key"
    )
    assert "Kombination" in msg


def test_explain_never_raises_and_never_costs_the_search(monkeypatch):
    """Die Diagnose ist eine Zusatzauskunft. Faellt sie aus, darf die Suche
    nicht nachtraeglich zum Fehler werden."""
    def boom(body, api_key):
        raise RuntimeError("Apollo weg")

    monkeypatch.setattr("worker.pipelines.apollo.post_search", boom)
    msg = explain_empty_result({"keywords": "x"}, "key")
    assert "nicht ermitteln" in msg


def test_explain_passes_a_plan_error_through(monkeypatch):
    """Ein gesperrter Plan ist keine "zu enge Suche" — diese Unterscheidung
    darf die Diagnose nicht verschlucken."""
    def blocked(body, api_key):
        raise ApolloPlanError("Free-Plan")

    monkeypatch.setattr("worker.pipelines.apollo.post_search", blocked)
    with pytest.raises(ApolloPlanError):
        explain_empty_result({"keywords": "x"}, "key")


def test_body_accepts_a_smaller_page_size_for_counting():
    """Zaehlen und Diagnose brauchen nur total_entries — per_page=1 spart die
    ganze Uebertragung, muss aber sonst denselben Body ergeben."""
    counting = build_people_search_body({"keywords": "x"}, page=1, per_page=1)
    full = build_people_search_body({"keywords": "x"}, page=1)
    assert counting["per_page"] == 1
    assert full["per_page"] == PER_PAGE
    assert {k: v for k, v in counting.items() if k != "per_page"} == {
        k: v for k, v in full.items() if k != "per_page"
    }


# --- Firmenbeschreibung aus Apollo -----------------------------------------
# Apollos Personensuche liefert im organization-Objekt nur den Namen und
# has_*-Flags. Ohne die Beschreibung aus organizations/bulk_enrich faellt
# personalize auf den Website-Text zurueck — und den blocken die meisten
# Shops (gemessen: 12 von 12 Seiten mit HTTP 429).

def test_summary_combines_description_keywords_and_industry():
    """Beschreibung UND Stichwoerter: die eine liefert den Selbstanspruch,
    die anderen die konkreten Aufhaenger fuer eine Eroeffnungszeile."""
    text = build_company_summary({
        "short_description": "We make clean sports nutrition for athletes who read labels." * 2,
        "keywords": ["dietary supplements", "d2c", "collagen peptides"],
        "industry": "health, wellness & fitness",
    })
    assert "clean sports nutrition" in text
    assert "collagen peptides" in text
    assert "health, wellness & fitness" in text


def test_summary_is_dropped_when_too_thin():
    """Aus zwei Worten soll die KI keinen Satz erfinden — lieber nichts
    liefern und personalize den Website-Fallback ueberlassen."""
    assert build_company_summary({"short_description": "Supplements."}) is None
    assert build_company_summary({"keywords": ["d2c"]}) is None
    assert build_company_summary({}) is None
    assert build_company_summary(None) is None


def test_summary_is_capped():
    """Lange Texte kosten bei jedem einzelnen Lead OpenAI-Tokens."""
    text = build_company_summary({"short_description": "x" * 9000})
    assert len(text) <= MAX_SUMMARY_CHARS + 100


def test_company_summaries_are_keyed_by_domain(monkeypatch):
    def fake(domains, api_key):
        return {d: {"short_description": f"Beschreibung fuer {d}. " * 6} for d in domains}

    monkeypatch.setattr("worker.pipelines.apollo._bulk_enrich_chunk", fake)
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)
    out = fetch_company_summaries(["A.com", " b.com "], "key")
    assert set(out) == {"a.com", "b.com"}, "Domains muessen normalisiert sein"


def test_company_summaries_survive_a_failing_chunk(monkeypatch):
    """Eine fehlende Beschreibung ist eine Zusatzinfo, kein Arbeitsschritt --
    sie darf die Suche nicht kippen."""
    calls = {"n": 0}

    def fake(domains, api_key):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("Apollo weg")
        return {d: {"short_description": "Beschreibung. " * 10} for d in domains}

    monkeypatch.setattr("worker.pipelines.apollo._bulk_enrich_chunk", fake)
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)
    out = fetch_company_summaries([f"shop{i}.com" for i in range(15)], "key")
    assert len(out) == 5, "Das zweite Paket muss trotz Fehler im ersten ankommen"


def test_company_summaries_pass_a_plan_error_through(monkeypatch):
    def blocked(domains, api_key):
        raise ApolloPlanError("Free-Plan")

    monkeypatch.setattr("worker.pipelines.apollo._bulk_enrich_chunk", blocked)
    with pytest.raises(ApolloPlanError):
        fetch_company_summaries(["a.com"], "key")


class TestAlexaRank:
    """Apollos alexa_ranking als Groessenanhaltspunkt (Migration 0079).

    Am 2026-08-05 an echten Domains geprueft — die Rangfolge passt:
    shopify.com 134, thredup.com 19 072, mtailor.com 633 392.

    Der Endpunkt (organizations/bulk_enrich) wird von run_apollo ohnehin bei
    jeder Suche aufgerufen und kostet keine Credits. Das Feld wurde bis dahin
    nur weggeworfen.
    """

    def test_nimmt_einen_positiven_rang(self):
        assert alexa_rank({"alexa_ranking": 134}) == 134

    def test_nimmt_auch_eine_zahl_als_zeichenkette(self):
        assert alexa_rank({"alexa_ranking": "19072"}) == 19072

    def test_fehlender_rang_ist_none_nicht_null(self):
        """Kein Rang heisst "unbekannt", nicht "unbeliebt". Eine 0 wuerde in
        der Sortierung als der groesste Laden der Welt erscheinen."""
        assert alexa_rank({"alexa_ranking": None}) is None
        assert alexa_rank({}) is None

    def test_verwirft_null_und_negative_werte(self):
        assert alexa_rank({"alexa_ranking": 0}) is None
        assert alexa_rank({"alexa_ranking": -5}) is None

    def test_verwirft_wahrheitswerte(self):
        """bool ist in Python ein int — ohne die ausdrueckliche Pruefung
        wuerde True zu Rang 1 und die Firma zur groessten im Bestand."""
        assert alexa_rank({"alexa_ranking": True}) is None
        assert alexa_rank({"alexa_ranking": False}) is None

    def test_verwirft_unbrauchbaren_text(self):
        assert alexa_rank({"alexa_ranking": "k.A."}) is None

    def test_kommt_mit_kaputtem_objekt_zurecht(self):
        assert alexa_rank(None) is None
        assert alexa_rank("nope") is None


class TestPlattformDomains:
    """Hinter facebook.com steht keine einzelne Firma.

    Am 2026-08-05 im Bestand gefunden: ein polnisches Restaurant mit
    facebook.com als "Website" bekam Facebooks Rang 13, zwei Kieler Friseure
    mit instagram.com-Profilen Instagrams Rang 19.

    Der Rang war dabei das kleinere Uebel — die BESCHREIBUNG waere schlimmer
    gewesen: sie fliesst in den Aufhaenger.
    """

    def test_erkennt_soziale_netzwerke(self):
        assert is_platform_domain("facebook.com")
        assert is_platform_domain("instagram.com")
        assert is_platform_domain("linkedin.com")

    def test_erkennt_unterdomains(self):
        """Sonst muesste die Liste hunderte Laendervarianten enthalten."""
        assert is_platform_domain("de-de.facebook.com")
        assert is_platform_domain("shop.wixsite.com")

    def test_ignoriert_www(self):
        assert is_platform_domain("www.instagram.com")

    def test_echte_firmendomains_bleiben_drin(self):
        assert not is_platform_domain("mtailor.com")
        assert not is_platform_domain("charite.de")
        # Knifflig: enthaelt "amazon", ist aber eine eigene Firma.
        assert not is_platform_domain("amazonas-shop.de")

    def test_kommt_mit_leer_zurecht(self):
        assert not is_platform_domain(None)
        assert not is_platform_domain("")


# ─────────────────────────────────────────────────────────────────────────
# Bekannte Firmen VOR dem Anreichern aussortieren (2026-08-09)
#
# Anlass: eine echte Suche lieferte eine Person, reicherte sie an (2 Credits)
# und verwarf sie danach als Dublette. Null Leads, obwohl Apollo fuer dieselben
# Filter hunderte weitere Treffer hatte.
# ─────────────────────────────────────────────────────────────────────────


def test_normalize_company_ignoriert_rechtsform_und_zeichen():
    from worker.pipelines.apollo import normalize_company

    # Genau der Fall, der beim ersten Anlauf danebenging: ohne vorheriges
    # Entfernen der Punkte wurde "B.V." zu "b v" und traf "BV" nicht.
    assert normalize_company("Acme B.V.") == normalize_company("Acme BV")
    assert normalize_company("Acme B.V.") == normalize_company("acme")
    assert normalize_company("Müller & Sohn GmbH") == "müller & sohn"
    assert normalize_company(None) == ""
    assert normalize_company("   ") == ""


def test_normalize_company_wirft_verschiedene_firmen_nicht_zusammen():
    """Der gefaehrliche Fehler waere ein zu grober Vergleich: ein echter neuer
    Lead duerfte nicht als Dublette gelten."""
    from worker.pipelines.apollo import normalize_company

    assert normalize_company("Acme Digital") != normalize_company("Acme Logistics")
    assert normalize_company("Picqer") != normalize_company("Picqr")


def test_candidate_pairs_liefert_firmenname_aus_der_vorschau():
    from worker.pipelines.apollo import candidate_pairs

    people = [
        {"id": "a", "has_email": True, "organization": {"name": "Acme B.V."}},
        {"id": "b", "has_email": False, "organization": {"name": "Ohne Adresse"}},
        {"id": "c", "has_email": True},  # Vorschau ohne organization
    ]
    assert candidate_pairs(people) == [("a", "acme"), ("c", "")]


def _fake_search(pages: dict[int, list[dict]], calls: list[int]):
    def search_people(_filters, _key, page):
        calls.append(page)
        return pages.get(page, [])

    return search_people


def test_collect_people_blaettert_weiter_statt_bei_dubletten_aufzugeben(monkeypatch):
    """DER gemeldete Fall: Seite 1 enthaelt nur eine bereits bekannte Firma.

    Vorher endete die Suche damit — mit zwei verbrauchten Credits und null
    Leads. Jetzt muss Seite 2 geholt und die neue Firma angereichert werden.
    """
    from worker.pipelines import apollo

    calls: list[int] = []
    pages = {
        1: [{"id": "alt", "has_email": True, "organization": {"name": "Bekannt BV"}}]
        + [{"id": f"f{i}", "has_email": False} for i in range(99)],
        2: [{"id": "neu", "has_email": True, "organization": {"name": "Frisch GmbH"}}],
    }
    monkeypatch.setattr(apollo, "search_people", _fake_search(pages, calls))
    enriched: list[list[str]] = []
    monkeypatch.setattr(
        apollo, "enrich_people",
        lambda ids, key, capped, on_charge=None, should_stop=None: enriched.append(list(ids)) or [{"x": 1}],
    )
    monkeypatch.setattr(apollo.time, "sleep", lambda _s: None)

    apollo.collect_people({}, "key", 1, known_companies={"bekannt"})

    assert calls == [1, 2], "Seite 2 muss geholt werden"
    # Entscheidend: die bekannte Firma taucht in der bezahlten Stufe NICHT auf.
    assert enriched == [["neu"]]


def test_collect_people_reichert_bekannte_firmen_gar_nicht_erst_an(monkeypatch):
    """Sind ALLE Treffer bekannt, darf kein einziger Credit fliessen."""
    from worker.pipelines import apollo

    calls: list[int] = []
    pages = {1: [{"id": "alt", "has_email": True, "organization": {"name": "Bekannt BV"}}]}
    monkeypatch.setattr(apollo, "search_people", _fake_search(pages, calls))

    def fail(*_a, **_k):
        raise AssertionError("enrich_people darf hier nicht aufgerufen werden")

    monkeypatch.setattr(apollo, "enrich_people", fail)
    monkeypatch.setattr(apollo.time, "sleep", lambda _s: None)

    assert apollo.collect_people({}, "key", 5, known_companies={"bekannt"}) == []


def test_collect_people_ohne_bestand_verhaelt_sich_wie_bisher(monkeypatch):
    """Ohne known_companies darf sich nichts aendern — der Parameter ist
    optional, und Prospeo/aeltere Aufrufer geben ihn nicht mit."""
    from worker.pipelines import apollo

    pages = {1: [{"id": "a", "has_email": True, "organization": {"name": "Bekannt BV"}}]}
    monkeypatch.setattr(apollo, "search_people", _fake_search(pages, []))
    enriched: list[list[str]] = []
    monkeypatch.setattr(
        apollo, "enrich_people",
        lambda ids, key, capped, on_charge=None, should_stop=None: enriched.append(list(ids)) or [{"x": 1}],
    )
    monkeypatch.setattr(apollo.time, "sleep", lambda _s: None)

    apollo.collect_people({}, "key", 1)
    assert enriched == [["a"]]


# ─────────────────────────────────────────────────────────────────────────
# Suche abbrechen (Migration 0086)
#
# Der Zweck ist ausschliesslich, Credits zu sparen. Deshalb pruefen die Tests
# nicht "wurde abgebrochen", sondern "wie viele Pakete wurden noch bezahlt".
# ─────────────────────────────────────────────────────────────────────────


def test_abbruch_stoppt_vor_dem_naechsten_bezahlten_paket(monkeypatch):
    """100 angeforderte Leads, Abbruch nach dem ersten Paket.

    Ohne Prueffpunkt liefen alle zehn Pakete durch (100 Credits). Erwartet
    wird genau ein bezahltes Paket — das laufende laesst sich nicht
    zurueckholen, alle weiteren schon.
    """
    billed: list[int] = []
    stop = {"now": False}

    def fake_chunk(ids, api_key):
        billed.append(len(ids))
        stop["now"] = True  # waehrend des ersten Pakets bricht der Nutzer ab
        return [_match(i) for i in ids]

    monkeypatch.setattr("worker.pipelines.apollo._bulk_match_chunk", fake_chunk)
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)

    out = enrich_people(
        [f"p{i}" for i in range(100)], "key", 100, should_stop=lambda: stop["now"]
    )
    assert billed == [10], f"nur das laufende Paket darf bezahlt werden, war: {billed}"
    assert len(out) == 10, "was bezahlt wurde, wird auch behalten"


def test_ohne_abbruch_laeuft_alles_durch(monkeypatch):
    """Die Gegenprobe: der Prueffpunkt darf im Normalfall nichts kuerzen."""
    billed: list[int] = []
    monkeypatch.setattr(
        "worker.pipelines.apollo._bulk_match_chunk",
        lambda ids, api_key: billed.append(len(ids)) or [_match(i) for i in ids],
    )
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)

    enrich_people([f"p{i}" for i in range(25)], "key", 25, should_stop=lambda: False)
    assert sum(billed) == 25


def test_abbruch_behaelt_was_bereits_bezahlt_wurde(monkeypatch):
    """Bezahlte Leads wegzuwerfen waere die zweite Verschwendung nach der
    ersten — der Nutzer wollte die Suche stoppen, nicht sein Guthaben."""
    monkeypatch.setattr(
        "worker.pipelines.apollo._bulk_match_chunk",
        lambda ids, api_key: [_match(i) for i in ids],
    )
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)

    calls = {"n": 0}

    def stop_after_two() -> bool:
        calls["n"] += 1
        return calls["n"] > 2

    out = enrich_people([f"p{i}" for i in range(50)], "key", 50, should_stop=stop_after_two)
    assert len(out) == 20, "zwei Pakete a 10 wurden bezahlt und bleiben erhalten"


# ─────────────────────────────────────────────────────────────────────────
# Apollo-Cache (Migration 0087)
#
# Zweck: dieselbe Person nie zweimal bezahlen — und den Lead trotzdem
# ausliefern. Die Tests messen deshalb beides: was noch gekauft wurde UND was
# beim Aufrufer ankommt.
# ─────────────────────────────────────────────────────────────────────────


def _cache_stub(monkeypatch, vorhanden: dict[str, dict]):
    """Cache durch ein Dictionary ersetzen. Gibt das Ablage-Protokoll zurueck."""
    from worker import apollo_cache

    abgelegt: dict[str, dict] = {}
    monkeypatch.setattr(
        apollo_cache, "get_many",
        lambda key, kind, ids: {i: vorhanden[i] for i in ids if i in vorhanden},
    )
    monkeypatch.setattr(apollo_cache, "put_many", lambda key, kind, items: abgelegt.update(items))
    return abgelegt


def test_bekannte_person_kostet_nichts_und_kommt_trotzdem(monkeypatch):
    """Der Kern: ein Cache-Treffer heisst "gratis", nicht "Lead weg"."""
    _cache_stub(monkeypatch, {"p1": _match("p1")})

    def fail(*_a, **_k):
        raise AssertionError("bulk_match darf fuer eine bekannte Person nicht laufen")

    monkeypatch.setattr("worker.pipelines.apollo._bulk_match_chunk", fail)
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)

    out = enrich_people(["p1"], "key", 1)
    assert len(out) == 1, "der Lead muss trotzdem ankommen"


def test_nur_die_unbekannten_kosten_credits(monkeypatch):
    """Gemischter Fall -- der Normalfall bei ueberlappenden Suchen."""
    _cache_stub(monkeypatch, {"p1": _match("p1"), "p2": _match("p2")})
    gekauft: list[str] = []

    def fake_chunk(ids, api_key):
        gekauft.extend(ids)
        return [_match(i) for i in ids]

    monkeypatch.setattr("worker.pipelines.apollo._bulk_match_chunk", fake_chunk)
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)

    out = enrich_people(["p1", "p2", "p3", "p4"], "key", 4)
    assert sorted(gekauft) == ["p3", "p4"], f"nur die neuen duerfen gekauft werden, war: {gekauft}"
    assert len(out) == 4, "alle vier Leads muessen ankommen"


def test_frisch_gekaufte_landen_im_cache(monkeypatch):
    """Ohne diesen Schritt waere der Cache immer leer und spart nie etwas."""
    abgelegt = _cache_stub(monkeypatch, {})
    monkeypatch.setattr(
        "worker.pipelines.apollo._bulk_match_chunk",
        lambda ids, api_key: [_match(i) for i in ids],
    )
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)

    enrich_people(["p1", "p2"], "key", 2)
    assert sorted(abgelegt) == ["p1", "p2"]


def test_cache_fehler_verhindert_die_suche_nicht(monkeypatch):
    """Der Cache darf Kosten senken, aber niemals eine Suche blockieren."""
    from worker import apollo_cache

    def boom(*_a, **_k):
        raise RuntimeError("Datenbank weg")

    monkeypatch.setattr(apollo_cache, "get_many", boom)
    monkeypatch.setattr(apollo_cache, "put_many", boom)
    monkeypatch.setattr(
        "worker.pipelines.apollo._bulk_match_chunk",
        lambda ids, api_key: [_match(i) for i in ids],
    )
    monkeypatch.setattr("worker.pipelines.apollo.time.sleep", lambda _s: None)

    with pytest.raises(RuntimeError):
        enrich_people(["p1"], "key", 1)
    # Hinweis: get_many faengt in der echten Fassung selbst ab (siehe dort);
    # dieser Test sichert nur, dass die Ausnahme nicht stillschweigend zu
    # einem leeren Ergebnis wird.


def test_fingerprint_gibt_den_schluessel_nicht_preis():
    from worker.apollo_cache import fingerprint

    fp = fingerprint("geheimer-apollo-key")
    assert "geheimer" not in fp
    assert len(fp) == 64
    assert fingerprint("a") != fingerprint("b")


def test_veralteter_eintrag_gilt_nicht_mehr():
    """Eine Adresse von vor einem Jahr gratis auszuliefern waere billig und
    falsch — sie bounct und beschaedigt die Absender-Reputation."""
    from datetime import datetime, timedelta, timezone

    from worker.apollo_cache import MAX_AGE_DAYS, _fresh_enough

    jung = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS - 1)
    alt = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS + 1)
    assert _fresh_enough(jung.isoformat()) is True
    assert _fresh_enough(alt.isoformat()) is False
    assert _fresh_enough(None) is False
    assert _fresh_enough("kein datum") is False
