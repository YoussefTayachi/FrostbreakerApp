"""Erst pruefen, dann freischalten: Domain-Wahl, Freischalt-Auswahl, Kandidaten."""

from worker import domains
from worker.pipelines import apollo, reveal_emails


def test_pick_domain_nur_bei_exaktem_namen():
    hits = [{"name": "FATCO Coupons", "domain": "fatcoupon.com"}]
    assert domains.pick_domain("FATCO", hits) is None
    hits = [{"name": "Philip B. Botanicals", "domain": "philipb.com"}]
    assert domains.pick_domain("Philip B Botanicals", hits) == "philipb.com"


def test_pick_domain_leer():
    assert domains.pick_domain("", [{"name": "", "domain": "x.com"}]) is None
    assert domains.pick_domain("Tatcha", []) is None


def _row(**kw):
    base = {
        "email": None,
        "custom": {"apollo_id": "a1", "reveal": "pending"},
        "person_finding_status": "found",
        "person_finding_needs_review": False,
    }
    return base | kw


def test_todo_nur_freigegebene_ohne_adresse():
    assert len(reveal_emails._todo([_row()])) == 1
    assert reveal_emails._todo([_row(email="x@y.com")]) == []
    assert reveal_emails._todo([_row(person_finding_status="none")]) == []
    assert reveal_emails._todo([_row(person_finding_needs_review=True)]) == []
    assert reveal_emails._todo([_row(custom={"apollo_id": "a1", "reveal": "done"})]) == []
    assert reveal_emails._todo([_row(custom={})]) == []


def test_same_company():
    assert reveal_emails._same_company("philipb.com", "https://philipb.com", None)
    assert reveal_emails._same_company("philipb.com", None, "melissa@philipb.com")
    assert not reveal_emails._same_company("philipb.com", "https://other.com", "a@other.com")
    assert not reveal_emails._same_company(None, "https://philipb.com", "a@philipb.com")


def test_preview_candidates_eine_person_je_firma(monkeypatch):
    people = [
        {"id": "p1", "has_email": True, "first_name": "A", "organization": {"name": "Acme"}},
        {"id": "p2", "has_email": True, "first_name": "B", "organization": {"name": "Acme"}},
        {"id": "p3", "has_email": False, "first_name": "C", "organization": {"name": "Beta"}},
        {"id": "p4", "has_email": True, "first_name": "D", "organization": {"name": "Known"}},
        {"id": "p5", "has_email": True, "first_name": "E", "organization": {"name": "Gamma"}},
    ]
    monkeypatch.setattr(apollo, "search_people", lambda f, k, page: people if page == 1 else [])
    out = apollo.preview_candidates({}, "key", 10, known_companies={"known"})
    assert [c["apollo_id"] for c in out] == ["p1", "p5"]
    assert out[0]["company"] == "Acme"
