"""Unit-Tests fuer die reinen Apollo-Funktionen (kein Netz, keine DB)."""
import pytest

from worker.pipelines.apollo import (
    APOLLO_EMPLOYEE_RANGES,
    APOLLO_MAX_PER_SEARCH,
    APOLLO_SENIORITIES,
    DECISIONMAKER_SENIORITIES,
    PER_PAGE,
    ApolloPlanError,
    _employee_range,
    build_people_search_body,
    candidate_ids,
    enrich_people,
    explain_empty_result,
    is_masked_email,
    parse_apollo_person,
)


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
    """"Alle Shopify-Shops" ist eine vollwertige Zielgruppe -- ohne diesen
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


def test_build_body_rejects_filterless_search():
    """Ohne inhaltlichen Filter wuerde Apollo einen beliebigen Querschnitt
    seiner Datenbank liefern -- teuer und wertlos."""
    with pytest.raises(ValueError):
        build_people_search_body({}, page=1)


def test_employee_range_translation():
    assert _employee_range("11-20") == "11,20"
    assert _employee_range("10001+") == "10001,1000000"
    assert _employee_range(None) is None
    assert _employee_range("") is None


def test_employee_range_rejects_stufen_die_apollo_nicht_kennt():
    """"11-50" war unsere eigene Erfindung -- Apollo akzeptiert sie technisch,
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
    Suche endete ohne Fehler mit null Treffern -- und niemand sah warum."""
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
    """Ein Treffer ohne Firmendomain ist kein Lead -- dann muss nachgeladen
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
    """Apollo maskiert nicht freigeschaltete Adressen -- unveraendert
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
    """collect_people blaettert bis APOLLO_MAX_PER_SEARCH // PER_PAGE -- bei
    einem Rest waere die letzte Seite unerreichbar."""
    assert APOLLO_MAX_PER_SEARCH % PER_PAGE == 0


def test_default_seniorities_are_all_valid_apollo_values():
    assert set(DECISIONMAKER_SENIORITIES) <= set(APOLLO_SENIORITIES)


def test_partner_is_a_valid_seniority():
    """Regressionsschutz: "partner" wurde einmal aufgrund einer unvollstaendigen
    Websuche entfernt, obwohl Apollos eigene Oberflaeche es fuehrt -- fuer
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
    Credits verbrauchen -- deshalb nie leer weitergeben."""
    for raw in ([], ["nonsense"], None, "owner"):
        body = build_people_search_body(
            {"keywords": "supplements", "apollo_seniorities": raw}, page=1
        )
        assert body["person_seniorities"] == DECISIONMAKER_SENIORITIES


# --- Ursachensuche bei null Treffern ---------------------------------------
# Eine leere Suche meldete bisher nur "fertig, 0 Leads". Diese Tests halten
# fest, dass sie stattdessen benennt, WORAN es lag -- ohne dabei je selbst zur
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
    Ohne diesen Filter gibt es Treffer -- genau das muss die Meldung sagen."""
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


def test_explain_reports_people_without_email_separately(monkeypatch):
    """Passende Personen ohne hinterlegte Adresse sind ein anderes Problem als
    ein zu enger Filter -- ein anderer Filter wuerde hier nicht helfen."""
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
    Kombination schuld -- dann darf die Meldung keinen Suendenbock erfinden."""
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
    """Ein gesperrter Plan ist keine "zu enge Suche" -- diese Unterscheidung
    darf die Diagnose nicht verschlucken."""
    def blocked(body, api_key):
        raise ApolloPlanError("Free-Plan")

    monkeypatch.setattr("worker.pipelines.apollo.post_search", blocked)
    with pytest.raises(ApolloPlanError):
        explain_empty_result({"keywords": "x"}, "key")


def test_body_accepts_a_smaller_page_size_for_counting():
    """Zaehlen und Diagnose brauchen nur total_entries -- per_page=1 spart die
    ganze Uebertragung, muss aber sonst denselben Body ergeben."""
    counting = build_people_search_body({"keywords": "x"}, page=1, per_page=1)
    full = build_people_search_body({"keywords": "x"}, page=1)
    assert counting["per_page"] == 1
    assert full["per_page"] == PER_PAGE
    assert {k: v for k, v in counting.items() if k != "per_page"} == {
        k: v for k, v in full.items() if k != "per_page"
    }
