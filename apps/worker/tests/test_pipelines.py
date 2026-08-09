"""Unit-Tests für die reinen Parse-Funktionen (kein Netz, keine DB)."""
from typing import ClassVar

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


def test_parse_persons_entdoppelt_gleiche_email():
    """Real aufgetreten: die KI lieferte in EINER Antwort zehnmal dieselbe
    Adresse fuer eine Firma -- alle zehn landeten als eigene Kontakte in der
    Liste und blaehten die Zaehler im Frontend auf."""
    data = {
        "persons": [
            {"name": "Saba Said", "title": "Founder", "email": "saba.said@innergroup.com",
             "phone": "NA", "linkedin": "NA", "instagram": "NA", "twitter": "NA", "facebook": "NA"},
            {"name": "Saba Said", "title": "CEO", "email": "SABA.SAID@innergroup.com",
             "phone": "NA", "linkedin": "NA", "instagram": "NA", "twitter": "NA", "facebook": "NA"},
            {"name": "Saba Said", "title": "Owner", "email": "saba.said@innergroup.com",
             "phone": "NA", "linkedin": "NA", "instagram": "NA", "twitter": "NA", "facebook": "NA"},
        ]
    }
    result = parse_persons(data)
    assert len(result) == 1, "gleiche Adresse (auch anders geschrieben) nur einmal"


def test_parse_persons_entdoppelt_namen_ohne_email():
    data = {
        "persons": [
            {"name": "Jane Doe", "title": "Head of Growth", "email": "NA",
             "phone": "NA", "linkedin": "NA", "instagram": "NA", "twitter": "NA", "facebook": "NA"},
            {"name": "Jane Doe", "title": "Growth Lead", "email": "NA",
             "phone": "NA", "linkedin": "NA", "instagram": "NA", "twitter": "NA", "facebook": "NA"},
        ]
    }
    assert len(parse_persons(data)) == 1


def test_parse_persons_behaelt_verschiedene_personen():
    """Die Entdopplung darf keine echten Kollegen verschlucken."""
    data = {
        "persons": [
            {"name": "Jane Doe", "title": "CEO", "email": "jane@x.com",
             "phone": "NA", "linkedin": "NA", "instagram": "NA", "twitter": "NA", "facebook": "NA"},
            {"name": "John Roe", "title": "CTO", "email": "john@x.com",
             "phone": "NA", "linkedin": "NA", "instagram": "NA", "twitter": "NA", "facebook": "NA"},
        ]
    }
    assert len(parse_persons(data)) == 2


def test_build_context_prefers_company_summary():
    # Website gesetzt (und keine schwache Bewertung), damit kein Pain-Point-
    # Signal angehaengt wird -- der Test soll ausschliesslich pruefen, dass die
    # Firmenbeschreibung als Kontext gewinnt.
    from worker.pipelines.personalize import build_context

    biz = {"company_summary": "Kurze Firmenbeschreibung.", "website": "https://example.com",
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
    """Ist die Recherche durch und hat nichts gefunden, darf build_context nicht
    weiter mit NotReadyYet auf Nachschub warten (sonst Retry-Spam).

    Ohne Website bleibt dabei bewusst das Pain-Point-Signal als Kontext uebrig
    -- "hat keine Website" ist ein Verkaufsargument, kein leerer Zustand (siehe
    pain_point_hint und das Playbook "Restaurants ohne Website")."""
    from worker.pipelines.personalize import build_context

    biz = {"company_summary": None, "website": None, "decisionmaker_status": "not_found"}
    context = build_context(biz, "company_summary")  # darf nicht werfen
    assert context is not None
    assert "keine auffindbare Website" in context


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


def test_sanitize_keeps_hyphens_inside_compound_words():
    """Real aufgetreten: "a two-decade foothold" wurde zu "a two, decade
    foothold" -- die Sanierung zerlegte echte Woerter."""
    from worker.pipelines.personalize import sanitize_banned_punctuation

    banned = ["—", "-", "--"]
    assert sanitize_banned_punctuation("a two-decade foothold", banned) == "a two-decade foothold"
    assert sanitize_banned_punctuation("values-driven marketing", banned) == "values-driven marketing"
    assert sanitize_banned_punctuation("an always-on sales system", banned) == "an always-on sales system"


def test_sanitize_still_replaces_dashes_between_clauses():
    """Der eigentliche Zweck darf dabei nicht verloren gehen."""
    from worker.pipelines.personalize import sanitize_banned_punctuation

    banned = ["—", "-", "--"]
    assert "—" not in sanitize_banned_punctuation("events—that's why I reached out", banned)
    # Bindestrich mit Leerzeichen ist ein Satztrenner, kein Wortbestandteil
    assert " - " not in sanitize_banned_punctuation("erster Teil - zweiter Teil", banned)
    assert "--" not in sanitize_banned_punctuation("Basta--that's why", banned)


def test_sanitize_mixed_case_hyphen_and_em_dash():
    """Beides im selben Satz: Wort-Bindestrich bleibt, Gedankenstrich geht."""
    from worker.pipelines.personalize import sanitize_banned_punctuation

    result = sanitize_banned_punctuation("a values-driven agency—that's why", ["—", "-"])
    assert "values-driven" in result
    assert "—" not in result


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
        data: ClassVar[dict] = {}

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


def test_build_discover_body_maps_technologies():
    """match=any ist entscheidend: Hunters Default ist "all", was bei mehreren
    Shopsystemen (Shopify UND Shopware zugleich) nie einen Treffer haette."""
    from worker.pipelines.discover import build_discover_body

    body = build_discover_body(
        {"country": "DE", "technologies": ["shopify", " shopware ", "shopify"]}
    )
    assert body["technology"] == {"include": ["shopify", "shopware"], "match": "any"}


def test_build_discover_body_technology_alone_is_enough():
    from worker.pipelines.discover import build_discover_body

    body = build_discover_body({"technologies": ["shopify"]})
    assert body["technology"]["include"] == ["shopify"]


def test_build_discover_body_ignores_unusable_technology_values():
    from worker.pipelines.discover import build_discover_body

    body = build_discover_body({"country": "DE", "technologies": ["", None, 7]})
    assert "technology" not in body


def test_discover_plan_error_only_when_technology_was_requested():
    """Hunter nennt nicht, welcher Filter zu hoch gegriffen war. Ohne
    Technologie-Filter darf deshalb keine Plan-Erklaerung erfunden werden --
    eine falsche Erklaerung ist schlechter als keine."""
    import httpx
    import pytest

    from worker.pipelines.discover import HunterPlanError, _raise_for_plan

    request = httpx.Request("POST", "https://api.hunter.io/v2/discover")
    client_error = httpx.HTTPStatusError(
        "400", request=request, response=httpx.Response(400, request=request)
    )

    with pytest.raises(HunterPlanError):
        _raise_for_plan(client_error, {"technologies": ["shopify"]})

    # Ohne Technologie-Filter bleibt der urspruengliche Fehler stehen.
    _raise_for_plan(client_error, {"country": "DE"})

    # Ein 429 ist transient, kein Plan-Problem.
    rate_limited = httpx.HTTPStatusError(
        "429", request=request, response=httpx.Response(429, request=request)
    )
    _raise_for_plan(rate_limited, {"technologies": ["shopify"]})


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
    import httpx
    import pytest

    from worker.pipelines import discover

    calls = []

    def fake_request(filters, api_key, offset):
        calls.append(offset)
        raise _http_error(500)

    monkeypatch.setattr(discover, "_discover_request", fake_request)
    # Bewusst der konkrete Typ: ein beliebiges Exception waere auch bei einem
    # Tippfehler im Test gruen und wuerde nichts beweisen.
    with pytest.raises(httpx.HTTPStatusError):
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



def test_validate_ignores_hyphens_inside_words():
    """Ein Bindestrich in einem zusammengesetzten Wort ist kein Verstoss.

    Sonst gilt jede Zeile mit "third-party" oder "NSF-certified" als
    fehlerhaft, sobald "-" auf der Verbotsliste steht -- gemessen an zwei
    echten Suchen waren so 66 von 69 Zeilen als pruefbeduerftig markiert, und
    jede loeste einen zweiten, ueberfluessigen OpenAI-Aufruf aus.
    """
    from worker.pipelines.personalize import validate

    banned = ["—", "–", "--", "-"]
    ok = "You run third-party tested, NSF-certified supplements out of Austin."
    assert validate(ok, max_words=99, banned_words=banned) == []


def test_validate_still_catches_separating_dashes():
    """Genau die Striche, die Satzteile abtrennen, sollen weiterhin auffallen."""
    from worker.pipelines.personalize import validate

    banned = ["—", "–", "--", "-"]
    for text in [
        "You scaled fast — that's why I wanted to reach out.",
        "You scaled fast -- that's why I wanted to reach out.",
        "You scaled fast - that's why I wanted to reach out.",
    ]:
        assert validate(text, max_words=99, banned_words=banned) != [], text


def test_validate_keeps_matching_normal_words():
    """Die Sonderbehandlung gilt nur fuer Satzzeichen, nicht fuer Woerter."""
    from worker.pipelines.personalize import validate

    assert validate("Ich bin beeindruckt.", max_words=99, banned_words=["beeindruckt"]) != []
    assert validate("Alles ruhig.", max_words=99, banned_words=["beeindruckt"]) == []


def test_constraint_block_nennt_die_wortgrenze():
    """Der eigentliche Fehler war, dass die Grenze nie im Prompt stand -- sie
    wurde nur hinterher geprueft. Gemessen: Median 24 Woerter bei Vorgabe 22,
    die auffaelligen lagen bei 33."""
    from worker.pipelines.personalize import constraint_block

    block = constraint_block(22, ["—", "-"])
    assert "Maximum 22 words" in block
    assert "Count them" in block


def test_constraint_block_listet_verbotene_zeichen():
    from worker.pipelines.personalize import constraint_block

    block = constraint_block(22, ["—", "--"])
    assert "— --" in block


def test_constraint_block_ohne_verbotene_zeichen():
    """Ohne Eintraege darf keine leere Verbotszeile im Prompt stehen -- eine
    Regel ohne Inhalt ist eine Einladung, sie sich auszudenken."""
    from worker.pipelines.personalize import constraint_block

    block = constraint_block(22, ["", "  "])
    assert "Never use these characters" not in block
    assert "Maximum 22 words" in block


def test_constraint_block_verbietet_das_abschreiben_der_beispiele():
    """An echten Daten endeten praktisch alle Aufhaenger mit derselben
    Wendung -- naemlich der ersten, die der Prompt als Beispiel nennt."""
    from worker.pipelines.personalize import constraint_block

    assert "NOT templates" in constraint_block(22, [])


def test_constraint_block_haengt_an_den_prompt_an_ohne_ihn_zu_verdraengen():
    from worker.pipelines.personalize import DEFAULT_PROMPT, constraint_block

    ganzer = DEFAULT_PROMPT + constraint_block(20, ["—"])
    assert ganzer.startswith(DEFAULT_PROMPT)
    assert "Maximum 20 words" in ganzer


# ─────────────────────────────────────────────────────────────────────────
# Sprache der Icebreaker (Migration 0083) und "neu erzeugen" (0084)
#
# Beide Fehler wurden am 2026-08-09 gemeldet: deutsche Aufhaenger trotz
# englisch eingestelltem Agenten, und ein wirkungsloser "neu erzeugen"-Knopf.
# ─────────────────────────────────────────────────────────────────────────


def test_constraint_block_schreibt_die_sprache_vor():
    """Die Sprache gehoert in den Block und nicht nur in den Prompt darueber.

    Sonst gilt sie fuer einen selbst geschriebenen Prompt nicht -- und die
    Einstellung im Workspace waere eine Zusage, die niemand einloest.
    """
    from worker.pipelines.personalize import constraint_block

    assert "Write the icebreaker in English" in constraint_block(22, [], "en")
    assert "Write the icebreaker in German" in constraint_block(22, [], "de")


def test_constraint_block_ist_ohne_sprachangabe_deutsch():
    """Rueckfall auf die bisherige Wirklichkeit: vor 0083 erzeugte der Worker
    ausnahmslos deutsche Texte."""
    from worker.pipelines.personalize import constraint_block

    assert "Write the icebreaker in German" in constraint_block(22, [])


def test_default_prompt_folgt_der_sprache():
    from worker.pipelines import personalize

    assert personalize.default_prompt("en") == personalize.DEFAULT_PROMPT_EN
    assert personalize.default_prompt("de") == personalize.DEFAULT_PROMPT_DE
    # Unbekannte Werte duerfen nicht zu einem leeren Prompt fuehren.
    assert personalize.default_prompt("fr") == personalize.DEFAULT_PROMPT_DE


def _fake_workspace_row(monkeypatch, row: dict):
    from worker.pipelines import personalize

    class FakeResult:
        data = row

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


def test_load_agent_config_nimmt_den_englischen_standard(monkeypatch):
    """DER gemeldete Fehler: personalization_prompt war bei allen acht
    Workspaces null, und der Worker setzte dafuer fest den deutschen Standard
    ein -- auch dort, wo die Oberflaeche den englischen anzeigte."""
    from worker.pipelines import personalize

    _fake_workspace_row(monkeypatch, {"personalization_language": "en"})
    cfg = personalize.load_agent_config("ws-1")
    assert cfg["language"] == "en"
    assert cfg["system_prompt"] == personalize.DEFAULT_PROMPT_EN


def test_load_agent_config_faellt_auf_deutsch_zurueck(monkeypatch):
    """Ohne gesetzte Sprache bleibt alles wie bisher -- sonst haette die
    Migration still die Sprache laufender Kampagnen umgestellt."""
    from worker.pipelines import personalize

    _fake_workspace_row(monkeypatch, {})
    cfg = personalize.load_agent_config("ws-1")
    assert cfg["language"] == "de"
    assert cfg["system_prompt"] == personalize.DEFAULT_PROMPT_DE


def test_load_agent_config_verwirft_unbekannte_sprache(monkeypatch):
    from worker.pipelines import personalize

    _fake_workspace_row(monkeypatch, {"personalization_language": "fr"})
    assert personalize.load_agent_config("ws-1")["language"] == "de"


def test_eigener_prompt_schlaegt_den_standard_aber_nicht_die_sprache(monkeypatch):
    """Wer selbst schreibt, bekommt seinen Text -- die Sprachvorgabe kommt
    trotzdem ueber den constraint_block dazu."""
    from worker.pipelines import personalize

    _fake_workspace_row(
        monkeypatch, {"personalization_prompt": "Schreib was Nettes.", "personalization_language": "en"}
    )
    cfg = personalize.load_agent_config("ws-1")
    assert cfg["system_prompt"] == "Schreib was Nettes."
    block = personalize.constraint_block(cfg["max_words"], cfg["banned_words"], cfg["language"])
    assert "Write the icebreaker in English" in block


def _run_with_existing_icebreaker(monkeypatch, payload: dict) -> list[str]:
    """run() mit einer Firma, die bereits einen Aufhaenger hat.

    Gibt zurueck, wie weit der Lauf gekommen ist. Die Spur ist
    search_is_deleted: es ist die naechste Anweisung nach der Abkuerzung, und
    es beendet den Lauf danach sofort -- also ohne OpenAI-Aufruf und ohne
    Schreibzugriff.
    """
    from worker.pipelines import personalize

    trace: list[str] = []

    class FakeResult:
        data = {"personalization": "Ein alter Aufhaenger.", "name": "Testfirma"}

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

    def spy(_biz):
        trace.append("kam_bis_search_is_deleted")
        return True  # danach steigt run() aus, ohne etwas zu kosten

    monkeypatch.setattr(personalize, "search_is_deleted", spy)
    personalize.run({"workspace_id": "ws-1", "payload": payload})
    return trace


def test_pipeline_job_ueberspringt_vorhandenen_aufhaenger(monkeypatch):
    """Der Schutz gegen doppeltes Bezahlen bleibt: kommt ein Pipeline-Job ein
    zweites Mal an (Neustart, wiederholte Zustellung), passiert nichts."""
    trace = _run_with_existing_icebreaker(monkeypatch, {"business_id": "b-1"})
    assert trace == []


def test_force_erzeugt_auch_bei_vorhandenem_aufhaenger_neu(monkeypatch):
    """DER gemeldete Fehler: "neu erzeugen" wird ausschliesslich auf Zeilen
    geklickt, die schon einen Text haben -- die Abkuerzung griff also immer.
    Der Job lief an, kehrte sofort um und galt als erledigt."""
    trace = _run_with_existing_icebreaker(monkeypatch, {"business_id": "b-1", "force": True})
    assert trace == ["kam_bis_search_is_deleted"]
