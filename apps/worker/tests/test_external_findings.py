from worker.pipelines.external_findings import (
    check_quote,
    finding_problem,
    is_claude_mode,
    quote_on_page,
    quote_probe,
)


def test_schalter():
    assert is_claude_mode({"person_findings_mode": "claude"})
    assert not is_claude_mode({})
    assert not is_claude_mode(None)


def test_zitat_auf_der_seite_trotz_anderer_zeichen():
    seite = "<p>We started Yak9 because \u201cdogs deserve   real food\u201d, not fillers.</p>"
    assert quote_on_page('We started Yak9 because "dogs deserve real food"', seite)
    assert not quote_on_page("We started Yak9 to sell cheap snacks", seite)


def test_probe_schneidet_am_wort():
    probe = quote_probe("a " * 100)
    assert len(probe) <= 60
    assert not probe.endswith(" ")


def test_linkedin_und_leeres_zitat_werden_nicht_geladen():
    assert check_quote("https://www.linkedin.com/posts/x", "hello") == "linkedin"
    assert check_quote("https://example.com", "") == "no_quote"


def test_firmenseite_darf_claude_liefern_aber_nicht_privat():
    kontakt = {"linkedin": None, "_business_name": "Acme"}
    gut = {
        "angle": "company",
        "claim": "Acme sells freeze-dried dog treats",
        "source_kind": "company_site",
    }
    assert finding_problem(gut, kontakt) is None
    leer = {**gut, "claim": " "}
    assert finding_problem(leer, kontakt) == "claim_empty"


def test_befund_modus_der_suche_geht_vor(monkeypatch):
    from worker.pipelines import person_finding as pf

    def kein_db_zugriff():
        raise AssertionError("Suche hat einen Modus, der Workspace darf nicht gefragt werden")

    monkeypatch.setattr(pf, "sb", kein_db_zugriff)
    assert (
        pf.findings_mode("ws", {"searches": {"filters": {"person_findings_mode": "claude"}}})
        == "claude"
    )
    assert (
        pf.findings_mode("ws", {"searches": {"filters": {"person_findings_mode": "openai"}}})
        == "openai"
    )


def test_duenne_seite_ist_nicht_pruefbar(monkeypatch):
    import httpx

    from worker.pipelines import external_findings as ef

    class Antwort:
        status_code = 200
        text = "<html><body><div id=app></div> loading </body></html>"

    monkeypatch.setattr(httpx, "get", lambda *a, **k: Antwort())
    monkeypatch.setattr(ef.time, "sleep", lambda s: None)
    assert ef.check_quote("https://example.com", "a quote that is not there") == "thin_page"

    class Voll:
        status_code = 200
        text = "<p>" + "word " * 700 + "</p>"

    monkeypatch.setattr(httpx, "get", lambda *a, **k: Voll())
    assert ef.check_quote("https://example.com", "a quote that is not there") == "not_found"
