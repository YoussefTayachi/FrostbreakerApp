"""Unit-Tests fuer die reinen Apollo-Funktionen (kein Netz, keine DB)."""
import pytest

from worker.pipelines.apollo import (
    APOLLO_EMPLOYEE_RANGES,
    APOLLO_MAX_PER_SEARCH,
    APOLLO_SENIORITIES,
    DECISIONMAKER_SENIORITIES,
    PER_PAGE,
    _employee_range,
    build_people_search_body,
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
    assert body["q_organization_domains"] == "example.com"
    assert body["page"] == 3


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
