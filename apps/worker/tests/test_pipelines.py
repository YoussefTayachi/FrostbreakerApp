"""Unit-Tests für die reinen Parse-Funktionen (kein Netz, keine DB)."""
from worker.pipelines.find_decisionmaker import parse_persons
from worker.pipelines.get_businesses import parse_place
from worker.pipelines.hunt_persons import extract_domain, parse_hunter_emails


def test_parse_place_full():
    p = {
        "id": "ChIJxyz",
        "displayName": {"text": "Hayes Spice", "languageCode": "en"},
        "formattedAddress": "55 Coldharbour Ln, Hayes UB3 3EE, UK",
        "nationalPhoneNumber": "07722 008595",
        "internationalPhoneNumber": "+44 7722 008595",
        "websiteUri": "https://hayesspice.co.uk/",
        "rating": 4.5,
        "priceLevel": "PRICE_LEVEL_MODERATE",
    }
    row = parse_place(p)
    assert row["place_id"] == "ChIJxyz"
    assert row["name"] == "Hayes Spice"
    assert row["website"] == "https://hayesspice.co.uk/"
    assert row["rating"] == 4.5


def test_parse_place_minimal():
    row = parse_place({"displayName": {"text": "X"}})
    assert row["name"] == "X"
    assert row["website"] is None
    assert row["place_id"] is None


def test_extract_domain():
    assert extract_domain("https://www.pheasant-restaurant.co.uk/") == "pheasant-restaurant.co.uk"
    assert extract_domain("http://yangs-asian.com/menu") == "yangs-asian.com"
    assert extract_domain("hautedolci.co.uk") == "hautedolci.co.uk"


def test_hunter_filters_invalid():
    # Realdaten-Struktur aus dem n8n-Pin: alle 'invalid' -> alles gefiltert
    payload = {
        "data": {
            "emails": [
                {
                    "value": "alli@hautedolci.co.uk",
                    "first_name": "Hamzah",
                    "last_name": "Alli",
                    "position": "Director of Development",
                    "seniority": "executive",
                    "department": "executive",
                    "confidence": 94,
                    "linkedin": "https://www.linkedin.com/in/hamzah-alli",
                    "twitter": None,
                    "verification": {"status": "invalid"},
                },
                {
                    "value": "ok@hautedolci.co.uk",
                    "first_name": "Adam",
                    "last_name": "Moosa",
                    "position": "Manager",
                    "seniority": "senior",
                    "department": "management",
                    "confidence": 94,
                    "linkedin": None,
                    "twitter": None,
                    "verification": {"status": "accept_all"},
                },
            ]
        }
    }
    rows = parse_hunter_emails(payload)
    assert len(rows) == 1
    assert rows[0]["email"] == "ok@hautedolci.co.uk"
    assert rows[0]["full_name"] == "Adam Moosa"
    assert rows[0]["source"] == "hunter"


def test_parse_persons_na_handling():
    data = {
        "company_name": "MoreYoga",
        "persons": [
            {
                "name": "Shamir Sidhu",
                "title": "owner",
                "email": "NA",
                "linkedin": "https://linkedin.com/in/shamir",
                "instagram": "NA",
                "twitter": "NA",
                "facebook": "NA",
            },
            {
                "name": "NA",
                "title": "NA",
                "email": "NA",
                "linkedin": "NA",
                "instagram": "NA",
                "twitter": "NA",
                "facebook": "NA",
            },
        ],
    }
    rows = parse_persons(data)
    assert len(rows) == 1
    assert rows[0]["first_name"] == "Shamir"
    assert rows[0]["last_name"] == "Sidhu"
    assert rows[0]["email"] is None
    assert rows[0]["linkedin"] == "https://linkedin.com/in/shamir"


def test_is_company_name():
    from worker.pipelines.find_decisionmaker import is_company_name

    assert is_company_name("Vilevi GmbH")
    assert is_company_name("S&P Global Co., Ltd.")
    assert is_company_name("S&P Restaurants Ltd.")
    assert is_company_name("ACME Holding")
    assert not is_company_name("Shamir Sidhu")
    assert not is_company_name("Renate Kornas")
    assert not is_company_name("Dr. Stefan Kudlacek")


def test_build_context_prefers_company_summary():
    from worker.pipelines.personalize import build_context

    biz = {"company_summary": "Kurze Firmenbeschreibung.", "website": None,
           "decisionmaker_status": "found"}
    assert build_context(biz, "company_summary") == "Kurze Firmenbeschreibung."


def test_build_context_waits_for_pending_research():
    from worker.pipelines.personalize import NotReadyYet, build_context

    biz = {"company_summary": None, "website": None, "decisionmaker_status": "running"}
    try:
        build_context(biz, "company_summary")
        assert False, "sollte NotReadyYet werfen"
    except NotReadyYet:
        pass


def test_build_context_no_retry_once_research_finished_without_summary():
    from worker.pipelines.personalize import build_context

    biz = {"company_summary": None, "website": None, "decisionmaker_status": "not_found"}
    assert build_context(biz, "company_summary") is None


def test_validate_word_count_and_banned_words():
    from worker.pipelines.personalize import validate

    ok = "Kurzer, praegnanter Satz mit klarem Fakt."
    assert validate(ok, max_words=22, banned_words=["Respekt"]) == []

    too_long = " ".join(["Wort"] * 30)
    problems = validate(too_long, max_words=22, banned_words=["Respekt"])
    assert any("zu lang" in p for p in problems)

    with_banned = "Das ist beeindruckend und voller Respekt."
    problems = validate(with_banned, max_words=22, banned_words=["Respekt"])
    assert any("verbotene" in p for p in problems)


def test_sanitize_banned_punctuation_replaces_em_dash():
    from worker.pipelines.personalize import sanitize_banned_punctuation, validate

    text = "blending tennis with culinary events—that's why I wanted to drop you a line."
    result = sanitize_banned_punctuation(text, ["—", "--", "-"])
    assert "—" not in result
    assert result == "blending tennis with culinary events, that's why I wanted to drop you a line."
    assert validate(result, max_words=99, banned_words=["—"]) == []


def test_sanitize_banned_punctuation_handles_double_before_single_hyphen():
    from worker.pipelines.personalize import sanitize_banned_punctuation

    text = "Wild Thing and Pasta e Basta--that's why I wanted to drop you a line."
    result = sanitize_banned_punctuation(text, ["-", "--"])
    assert "--" not in result
    assert " - " not in result


def test_sanitize_banned_punctuation_leaves_normal_words_alone():
    from worker.pipelines.personalize import sanitize_banned_punctuation

    text = "Das ist beeindruckend und voller Respekt."
    assert sanitize_banned_punctuation(text, ["Respekt", "beeindruckt"]) == text


def test_sanitize_banned_punctuation_noop_without_punctuation_entries():
    from worker.pipelines.personalize import sanitize_banned_punctuation

    text = "Ein ganz normaler Satz ohne Verstoss."
    assert sanitize_banned_punctuation(text, ["Respekt"]) == text


def test_load_agent_config_defaults(monkeypatch):
    from worker.pipelines import personalize

    class FakeResult:
        data = {}

    class FakeQuery:
        def select(self, *a, **k):
            return self

        def eq(self, *a, **k):
            return self

        def single(self):
            return self

        def execute(self):
            return FakeResult()

    class FakeSb:
        def table(self, *a, **k):
            return FakeQuery()

    monkeypatch.setattr(personalize, "sb", lambda: FakeSb())
    cfg = personalize.load_agent_config("ws-1")
    assert cfg["source"] == personalize.DEFAULT_SOURCE
    assert cfg["max_words"] == personalize.DEFAULT_MAX_WORDS
    assert cfg["banned_words"] == personalize.DEFAULT_BANNED_WORDS
    assert cfg["system_prompt"] == personalize.DEFAULT_PROMPT


def test_build_discover_body():
    from worker.pipelines.discover import build_discover_body

    body = build_discover_body(
        {"country": "AT", "city": "Vienna", "industry": "Insurance",
         "headcount": "11-50", "keywords": "makler, vorsorge"}
    )
    assert body["headquarters_location"] == {"include": [{"country": "AT", "city": "Vienna"}]}
    assert body["industry"] == {"include": ["Insurance"]}
    assert body["headcount"] == ["11-50"]
    assert body["keywords"] == {"include": ["makler", "vorsorge"], "match": "any"}

    minimal = build_discover_body({"country": "DE"})
    assert "industry" not in minimal

    import pytest
    with pytest.raises(ValueError):
        build_discover_body({})


def test_build_discover_body_includes_us_state():
    """Ohne Bundesstaat lehnt Hunter eine US-Stadt mit 400 ab."""
    from worker.pipelines.discover import build_discover_body

    body = build_discover_body({"country": "US", "state": "NY", "city": "New York"})
    assert body["headquarters_location"]["include"] == [
        {"country": "US", "state": "NY", "city": "New York"}
    ]


def test_build_discover_body_ignores_state_outside_us():
    """Hunters Schema kennt state nur fuer die USA -- bei einem anderen Land
    wuerde das Feld die Anfrage nur unnoetig angreifbar machen."""
    from worker.pipelines.discover import build_discover_body

    body = build_discover_body({"country": "DE", "state": "NY", "city": "Berlin"})
    assert body["headquarters_location"]["include"] == [{"country": "DE", "city": "Berlin"}]


def test_parse_discover_company():
    from worker.pipelines.discover import parse_discover_company

    row = parse_discover_company({"domain": "kotax.com", "organization": "KOTAX"})
    assert row == {"place_id": None, "name": "KOTAX", "website": "https://kotax.com"}
    assert parse_discover_company({})["website"] is None


def _http_error(status: int):
    import httpx

    request = httpx.Request("POST", "https://api.hunter.io/v2/discover")
    return httpx.HTTPStatusError(
        str(status), request=request, response=httpx.Response(status, request=request)
    )


def test_discover_is_retryable_skips_client_errors():
    from worker.pipelines.discover import _is_retryable

    assert _is_retryable(_http_error(400)) is False
    assert _is_retryable(_http_error(401)) is False


def test_discover_is_retryable_keeps_transient_errors():
    from worker.pipelines.discover import _is_retryable

    assert _is_retryable(_http_error(429)) is True
    assert _is_retryable(_http_error(500)) is True
    assert _is_retryable(TimeoutError("timed out")) is True


def test_discover_falls_back_to_first_page_when_offset_rejected(monkeypatch):
    """Kern der Regression: ein Plan ohne Pagination darf die Suche nicht killen."""
    from worker.pipelines import discover

    calls = []

    def fake_request(filters, api_key, offset):
        calls.append(offset)
        if offset:
            raise _http_error(400)
        return [{"domain": "example.com", "organization": "Example"}]

    monkeypatch.setattr(discover, "_discover_request", fake_request)
    result = discover.discover_companies({"country": "US"}, "key", offset=100)

    assert calls == [100, 0], "erst mit offset versuchen, dann ohne"
    assert len(result) == 1, "Ergebnis der ersten Seite statt einer Exception"


def test_discover_does_not_swallow_server_errors(monkeypatch):
    """Ein 500er ist kein Plan-Problem -- der darf nicht als 'kein Pagination-Recht'
    umgedeutet und mit einem zweiten Aufruf verschleiert werden."""
    import pytest

    from worker.pipelines import discover

    calls = []

    def fake_request(filters, api_key, offset):
        calls.append(offset)
        raise _http_error(500)

    monkeypatch.setattr(discover, "_discover_request", fake_request)
    with pytest.raises(Exception):
        discover.discover_companies({"country": "US"}, "key", offset=100)
    assert calls == [100], "kein Fallback-Versuch bei einem Serverfehler"


def test_discover_without_offset_makes_single_call(monkeypatch):
    from worker.pipelines import discover

    calls = []

    def fake_request(filters, api_key, offset):
        calls.append(offset)
        return []

    monkeypatch.setattr(discover, "_discover_request", fake_request)
    discover.discover_companies({"country": "US"}, "key", offset=0)
    assert calls == [0]


def test_matching_prior_search_ids():
    from worker.pipelines.get_businesses import matching_prior_search_ids

    filters = {"country": "US", "industry": "Marketing Services", "headcount": "1-10"}
    prior = [
        {"id": "s1", "filters": {"country": "US", "industry": "Marketing Services", "headcount": "1-10"}},
        {"id": "s2", "filters": {"country": "US", "industry": "Marketing Services", "headcount": "11-50"}},
        {"id": "s3", "filters": {"country": "US", "industry": "Marketing Services", "headcount": "1-10"}},
        {"id": "s4", "filters": None},
    ]
    assert matching_prior_search_ids(filters, prior) == ["s1", "s3"]


def test_matching_prior_search_ids_empty_filters_treated_as_dict():
    from worker.pipelines.get_businesses import matching_prior_search_ids

    prior = [{"id": "s1", "filters": None}, {"id": "s2", "filters": {}}]
    assert matching_prior_search_ids(None, prior) == ["s1", "s2"]
    assert matching_prior_search_ids({}, prior) == ["s1", "s2"]


def test_suppression_matching():
    from worker.suppression import domain_of, is_suppressed

    emails = {"chef@bestandskunde.de"}
    domains = {"kunde-gmbh.at"}
    assert domain_of("https://www.kunde-gmbh.at/impressum") == "kunde-gmbh.at"
    assert domain_of("info@kunde-gmbh.at") == "kunde-gmbh.at"
    assert is_suppressed(emails, domains, email="chef@bestandskunde.de")
    assert is_suppressed(emails, domains, email="neu@kunde-gmbh.at")
    assert is_suppressed(emails, domains, website="http://kunde-gmbh.at")
    assert not is_suppressed(emails, domains, email="jemand@anders.de")
    assert not is_suppressed(emails, domains, website="https://anders.de")

