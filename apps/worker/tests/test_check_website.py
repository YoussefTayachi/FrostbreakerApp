"""Der check_website-Job und alles, was um ihn herum haengt:
Abruf-Hilfen (website_fetch), das Einreihen in get_businesses und der Weg des
Befunds in den personalize-Kontext.
"""
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from worker import website_fetch
from worker.pipelines import check_website, get_businesses, personalize

HTML = (
    '<html><head><meta name="viewport" content="width=device-width">'
    '<meta name="description" content="Da steht was."></head>'
    "<body><footer>&copy; 2026 Muster</footer></body></html>"
)


class FakeTable:
    """Genug Supabase-Nachbau fuer select().eq().single().execute() und
    update().eq().execute(). Merkt sich, was geschrieben wurde."""

    def __init__(self, row: dict, writes: list[dict]):
        self._row = row
        self._writes = writes
        self._pending: dict | None = None

    def select(self, *_a, **_k):
        return self

    def update(self, payload: dict):
        self._pending = payload
        return self

    def eq(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def single(self):
        return self

    def execute(self):
        if self._pending is not None:
            self._writes.append(self._pending)
            self._pending = None
            return type("R", (), {"data": None})()
        return type("R", (), {"data": self._row})()


def fake_sb(row: dict, writes: list[dict]):
    class FakeSb:
        def table(self, *_a, **_k):
            return FakeTable(row, writes)

    return lambda: FakeSb()


# ── website_fetch ──────────────────────────────────────────────────────────


def test_normalize_url_ergaenzt_das_schema():
    assert website_fetch.normalize_url("muster.de") == "https://muster.de"
    assert website_fetch.normalize_url(" https://muster.de/ ") == "https://muster.de/"


def test_normalize_url_verwirft_was_kein_http_ist():
    assert website_fetch.normalize_url(None) is None
    assert website_fetch.normalize_url("") is None
    assert website_fetch.normalize_url("mailto:info@muster.de") is None
    assert website_fetch.normalize_url("ftp://muster.de") is None


def test_http_variant():
    assert website_fetch.http_variant("https://muster.de/pfad") == "http://muster.de/pfad"


@respx.mock
def test_fetch_page_liefert_rohes_html_und_die_endgueltige_adresse():
    respx.get("https://muster.de/").mock(
        return_value=httpx.Response(200, html=HTML, headers={"content-type": "text/html"})
    )
    page = website_fetch.fetch_page("https://muster.de/")
    assert page.html == HTML
    assert page.final_url == "https://muster.de/"
    assert page.page_bytes == len(HTML.encode())
    assert "text/html" in page.content_type


@respx.mock
def test_redirects_to_https_erkennt_die_weiterleitung():
    respx.get("http://muster.de/").mock(
        return_value=httpx.Response(301, headers={"location": "https://muster.de/"})
    )
    assert website_fetch.redirects_to_https("https://muster.de/") is True


@respx.mock
def test_redirects_to_https_ist_false_wenn_http_einfach_antwortet():
    respx.get("http://muster.de/").mock(return_value=httpx.Response(200, html=HTML))
    assert website_fetch.redirects_to_https("https://muster.de/") is False


@respx.mock
def test_redirects_to_https_ist_false_bei_weiterleitung_die_http_behaelt():
    respx.get("http://muster.de/").mock(
        return_value=httpx.Response(302, headers={"location": "/start"})
    )
    assert website_fetch.redirects_to_https("https://muster.de/") is False


@respx.mock
def test_redirects_to_https_ist_none_wenn_port_80_nicht_antwortet():
    """Nicht erreichbar ist hier KEIN Mangel: die Seite ist dann nur ueber
    https zu haben, und das ist genau richtig."""
    respx.get("http://muster.de/").mock(side_effect=httpx.ConnectError("nope"))
    assert website_fetch.redirects_to_https("https://muster.de/") is None


def test_is_ssl_error_findet_das_zertifikat_in_der_ursachenkette():
    import ssl

    inner = ssl.SSLCertVerificationError("certificate has expired")
    outer = httpx.ConnectError("Verbindung fehlgeschlagen")
    outer.__cause__ = inner
    assert website_fetch.is_ssl_error(outer) is True


def test_is_ssl_error_ist_false_bei_einem_normalen_netzfehler():
    assert website_fetch.is_ssl_error(httpx.ConnectError("getaddrinfo failed")) is False
    assert website_fetch.is_ssl_error(httpx.ConnectTimeout("zu langsam")) is False


# ── Der Job ────────────────────────────────────────────────────────────────


def job_for(business_id: str = "b-1") -> dict:
    return {"workspace_id": "ws-1", "payload": {"business_id": business_id}}


@respx.mock
def test_run_schreibt_den_befund_und_status_ok(monkeypatch):
    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://muster.de/"}, writes)
    )
    respx.get("https://muster.de/").mock(
        return_value=httpx.Response(200, html=HTML, headers={"content-type": "text/html"})
    )
    respx.get("http://muster.de/").mock(
        return_value=httpx.Response(301, headers={"location": "https://muster.de/"})
    )
    check_website.run(job_for())
    assert len(writes) == 1
    assert writes[0]["website_audit_status"] == "ok"
    assert writes[0]["website_audit"]["checked_url"] == "https://muster.de/"
    assert writes[0]["website_audit"]["findings"] == []
    assert writes[0]["website_audit_at"]


@respx.mock
def test_run_kostet_hoechstens_zwei_abrufe(monkeypatch):
    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://muster.de/"}, writes)
    )
    main = respx.get("https://muster.de/").mock(
        return_value=httpx.Response(200, html=HTML, headers={"content-type": "text/html"})
    )
    probe = respx.get("http://muster.de/").mock(
        return_value=httpx.Response(301, headers={"location": "https://muster.de/"})
    )
    check_website.run(job_for())
    assert main.call_count == 1
    assert probe.call_count == 1


@respx.mock
def test_run_spart_die_zweite_anfrage_wenn_die_seite_ohnehin_http_ist(monkeypatch):
    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "http://muster.de/"}, writes)
    )
    main = respx.get("http://muster.de/").mock(
        return_value=httpx.Response(200, html=HTML, headers={"content-type": "text/html"})
    )
    check_website.run(job_for())
    assert main.call_count == 1  # keine Probe: das Ergebnis steht schon fest
    assert [f["code"] for f in writes[0]["website_audit"]["findings"]] == ["no_https"]


@respx.mock
def test_run_meldet_eine_tote_domain_als_unreachable_ohne_zu_scheitern(monkeypatch):
    """Kein Retry-Sturm: der Job gilt als erledigt, sonst versucht die Queue
    denselben Zeitablauf mehrfach."""
    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://weg.de/"}, writes)
    )
    respx.get("https://weg.de/").mock(side_effect=httpx.ConnectError("getaddrinfo failed"))
    check_website.run(job_for())  # darf nicht werfen
    assert writes[0]["website_audit_status"] == "unreachable"
    assert writes[0]["website_audit"]["findings"] == []


@respx.mock
def test_run_macht_aus_einem_kaputten_zertifikat_einen_befund(monkeypatch):
    import ssl

    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://alt.de/"}, writes)
    )
    error = httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate has expired")
    error.__cause__ = ssl.SSLCertVerificationError("certificate has expired")
    respx.get("https://alt.de/").mock(side_effect=error)
    check_website.run(job_for())
    assert writes[0]["website_audit_status"] == "ok"  # ok heisst geprueft
    assert [f["code"] for f in writes[0]["website_audit"]["findings"]] == ["ssl_broken"]


@respx.mock
def test_run_ueberspringt_was_kein_html_ist(monkeypatch):
    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://muster.de/f.pdf"}, writes)
    )
    respx.get("https://muster.de/f.pdf").mock(
        return_value=httpx.Response(200, content=b"%PDF-1.4", headers={"content-type": "application/pdf"})
    )
    check_website.run(job_for())
    assert writes[0]["website_audit_status"] == "skipped"


def test_run_ueberspringt_leads_ohne_website(monkeypatch):
    writes: list[dict] = []
    monkeypatch.setattr(check_website, "sb", fake_sb({"id": "b-1", "website": None}, writes))
    check_website.run(job_for())
    assert writes[0]["website_audit_status"] == "skipped"


def test_run_prueft_nicht_zweimal(monkeypatch):
    writes: list[dict] = []
    row = {"id": "b-1", "website": "https://muster.de/", "website_audit_status": "ok"}
    monkeypatch.setattr(check_website, "sb", fake_sb(row, writes))
    check_website.run(job_for())  # ohne respx: jeder Abruf wuerde hier auffliegen
    assert writes == []


def test_run_ueberspringt_geloeschte_listen(monkeypatch):
    writes: list[dict] = []
    row = {
        "id": "b-1",
        "website": "https://muster.de/",
        "searches": {"deleted_at": "2026-08-01T00:00:00+00:00"},
    }
    monkeypatch.setattr(check_website, "sb", fake_sb(row, writes))
    check_website.run(job_for())
    # Endstatus statt 'pending', sonst wartet personalize bis zum Zeitdeckel.
    assert writes[0]["website_audit_status"] == "skipped"


# ── Einreihen in get_businesses ────────────────────────────────────────────


def test_queue_website_audits_setzt_pending_vor_dem_einreihen(monkeypatch):
    calls: list[tuple] = []

    class Recorder:
        def table(self, *_a):
            return self

        def update(self, payload):
            calls.append(("update", payload))
            return self

        def in_(self, _col, ids):
            calls.append(("in_", ids))
            return self

        def execute(self):
            return type("R", (), {"data": None})()

    monkeypatch.setattr(get_businesses, "sb", lambda: Recorder())
    monkeypatch.setattr(
        get_businesses, "enqueue", lambda ws, t, p: calls.append(("enqueue", t, p["business_id"]))
    )
    get_businesses._queue_website_audits(
        "ws-1",
        [
            {"id": "b-1", "website": "https://a.de"},
            {"id": "b-2", "website": None},
            {"id": "b-3", "website": "  "},
            {"id": "b-4", "website": "https://b.de"},
        ],
    )
    kinds = [c[0] for c in calls]
    assert kinds == ["update", "in_", "enqueue", "enqueue"]
    assert calls[0][1] == {"website_audit_status": "pending"}
    assert calls[1][1] == ["b-1", "b-4"]  # ohne Website kein Job
    assert [c[2] for c in calls[2:]] == ["b-1", "b-4"]


def test_queue_website_audits_ruehrt_nichts_an_wenn_niemand_eine_website_hat(monkeypatch):
    monkeypatch.setattr(
        get_businesses, "sb", lambda: pytest.fail("kein Update ohne Kandidaten")
    )
    monkeypatch.setattr(get_businesses, "enqueue", lambda *a: pytest.fail("kein Job"))
    get_businesses._queue_website_audits("ws-1", [{"id": "b-1", "website": None}])


# ── Der Weg in den Icebreaker ──────────────────────────────────────────────


def business(**over) -> dict:
    row = {
        "name": "Muster GmbH",
        "website": "https://muster.de",
        "company_summary": "Malerbetrieb aus Kassel.",
        "decisionmaker_status": "found",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "website_audit_status": "ok",
        "website_audit": {
            "findings": [
                {"code": "site_builder", "evidence": "Wix.com Website Builder"},
                {"code": "no_https", "evidence": "http://muster.de/"},
            ]
        },
    }
    row.update(over)
    return row


def test_audit_hint_nennt_tatsache_folge_und_beleg():
    hint = personalize.audit_hint(business())
    assert hint.startswith("Zusatzsignal: ")
    assert "HTTPS" in hint  # der ranghoechste Befund, nicht der erste in der Liste
    assert "http://muster.de/" in hint
    assert "Nicht sicher" in hint
    assert "Wix" not in hint  # genau EIN Befund, nie eine Liste


def test_audit_hint_ohne_befund_ist_none():
    assert personalize.audit_hint(business(website_audit={"findings": []})) is None
    assert personalize.audit_hint(business(website_audit={})) is None


def test_befund_ersetzt_den_pain_point_hint():
    """Der Befund ist spezifischer und nachpruefbar; beides zusammen waere eine
    Maengelliste."""
    biz = business(rating=2.1)
    context = personalize.build_context(biz, "company_summary")
    assert "Nicht sicher" in context
    assert "Google-Bewertung" not in context


def test_ohne_befund_bleibt_der_pain_point_hint_unberuehrt():
    biz = business(rating=2.1, website_audit={}, website_audit_status=None)
    context = personalize.build_context(biz, "company_summary")
    assert "Google-Bewertung" in context


def test_personalize_wartet_auf_den_laufenden_check():
    biz = business(website_audit_status="pending", website_audit={})
    with pytest.raises(personalize.NotReadyYet):
        personalize.build_context(biz, "company_summary")


def test_personalize_wartet_nicht_ewig():
    """Stirbt der check_website-Job, muss der Icebreaker trotzdem entstehen.
    Lieber ohne Aufhaenger als eine Liste, die stehen bleibt."""
    alt = datetime.now(timezone.utc) - personalize.AUDIT_WAIT_LIMIT - timedelta(minutes=1)
    biz = business(
        website_audit_status="pending", website_audit={}, created_at=alt.isoformat()
    )
    assert personalize.build_context(biz, "company_summary") == "Malerbetrieb aus Kassel."


def test_personalize_wartet_nicht_wenn_niemand_prueft():
    """Status null bei vorhandener Website (alte Zeilen, von Hand angelegte
    Firmen): es ist kein Job unterwegs, also gibt es nichts zu erwarten."""
    biz = business(website_audit_status=None, website_audit={})
    assert personalize.build_context(biz, "company_summary") == "Malerbetrieb aus Kassel."
