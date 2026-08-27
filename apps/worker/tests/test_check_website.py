"""Der check_website-Job und alles, was um ihn herum haengt:
Abruf-Hilfen (website_fetch), das Einreihen in get_businesses und der Nachweis,
dass der Befund NICHT mehr im Icebreaker landet.

Was der Befund stattdessen wird, steht in tests/test_website_finding.py.
"""
from datetime import datetime, timezone

import httpx
import pytest
import respx

from worker import website_fetch
from worker.pipelines import check_website, get_businesses, personalize

# Eine ansonsten einwandfreie Seite: hier wird geprueft, was check_website mit
# einem Befund MACHT, nicht welche Befunde es gibt. Deshalb muss sie alle
# Pruefungen ausser der gerade gemeinten bestehen, sonst misst der Test
# nebenbei den Katalog mit. Am 2026-08-27 um og:image, h1 und einen
# Telefonlink ergaenzt, als vier Pruefungen dazukamen.
HTML = (
    '<html><head><meta name="viewport" content="width=device-width">'
    '<meta name="description" content="Da steht was.">'
    '<meta property="og:image" content="https://muster.de/vorschau.jpg"></head>'
    "<body><h1>Muster</h1>"
    '<p>Telefon: <a href="tel:+495611234567">0561 1234567</a></p>'
    "<footer>&copy; 2026 Muster</footer></body></html>"
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


# ── classify_failure ───────────────────────────────────────────────────────


def _wrapped(inner: BaseException) -> httpx.HTTPError:
    """Wie httpx es liefert: der echte Fehler steckt in der Ursachenkette."""
    outer = httpx.ConnectError("Verbindung fehlgeschlagen")
    outer.__cause__ = inner
    return outer


def test_classify_findet_das_zertifikat_in_der_ursachenkette():
    import ssl

    error = _wrapped(ssl.SSLCertVerificationError("certificate verify failed: expired"))
    assert website_fetch.classify_failure(error) == website_fetch.CERT


def test_classify_trennt_den_tls_abbruch_vom_zertifikat():
    """Der Fall richardwilding.net, gemessen am 2026-08-27: der Server bricht
    den Handschlag ab, ein Zertifikat sieht der Browser dabei nie. Als 'cert'
    gewertet haette die Mail ein kaputtes Zertifikat behauptet, das es gar
    nicht gibt."""
    import ssl

    assert website_fetch.classify_failure(_wrapped(ssl.SSLEOFError("EOF"))) == website_fetch.TLS
    assert website_fetch.classify_failure(_wrapped(ssl.SSLError("UNSUPPORTED_PROTOCOL"))) == website_fetch.TLS


def test_classify_erkennt_die_uebrigen_arten():
    import socket

    assert website_fetch.classify_failure(_wrapped(socket.gaierror(11001, "getaddrinfo failed"))) == website_fetch.DNS
    assert website_fetch.classify_failure(_wrapped(ConnectionRefusedError(111, "refused"))) == website_fetch.REFUSED
    assert website_fetch.classify_failure(httpx.ConnectTimeout("zu langsam")) == website_fetch.TIMEOUT
    status = httpx.HTTPStatusError(
        "403", request=httpx.Request("GET", "https://a.de"), response=httpx.Response(403)
    )
    assert website_fetch.classify_failure(status) == website_fetch.HTTP


def test_classify_kommt_auch_ohne_typen_durch_den_text():
    """Absicherung dagegen, dass eine spaetere httpx-Fassung anders verpackt."""
    assert website_fetch.classify_failure(httpx.ConnectError("getaddrinfo failed")) == website_fetch.DNS
    assert website_fetch.classify_failure(httpx.HTTPError("irgendwas Neues")) == website_fetch.OTHER


def test_nur_dauerhafte_arten_duerfen_zu_einem_befund_werden():
    """timeout, http und other fehlen mit Absicht: alle drei haben eine
    harmlose Lesart, in der der Server laeuft."""
    assert website_fetch.DURABLE_FAILURE_KINDS == ("dns", "refused", "tls")


@respx.mock
def test_own_network_is_up_ist_false_wenn_die_gegenprobe_schweigt():
    respx.get(website_fetch.CONTROL_URL).mock(side_effect=httpx.ConnectError("nope"))
    assert website_fetch.own_network_is_up() is False


@respx.mock
def test_own_network_is_up_ist_true_wenn_die_gegenprobe_antwortet():
    respx.get(website_fetch.CONTROL_URL).mock(return_value=httpx.Response(200, html="<html></html>"))
    assert website_fetch.own_network_is_up() is True


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
    monkeypatch.setattr(check_website, "enqueue", lambda *a, **k: None)
    respx.get("https://weg.de/").mock(side_effect=httpx.ConnectError("getaddrinfo failed"))
    check_website.run(job_for())  # darf nicht werfen
    assert writes[0]["website_audit_status"] == "unreachable"
    # Noch KEIN Befund: eine einzelne gescheiterte Anfrage kann ein Aussetzer
    # sein. Bestaetigt wird sie im verzoegerten zweiten Job.
    assert writes[0]["website_audit"]["findings"] == []
    assert writes[0]["website_audit"]["unreachable_kind"] == "dns"
    assert writes[0]["website_audit"]["unreachable_first_seen_at"]


@respx.mock
def test_run_reiht_die_bestaetigung_verzoegert_ein(monkeypatch):
    """Der Unterschied zum Retry: einmal, spaeter, und ohne dass der Job
    scheitert."""
    jobs: list[tuple] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://weg.de/"}, [])
    )
    monkeypatch.setattr(
        check_website, "enqueue", lambda ws, t, p, delay_s=0: jobs.append((ws, t, p, delay_s))
    )
    respx.get("https://weg.de/").mock(side_effect=httpx.ConnectError("getaddrinfo failed"))
    check_website.run(job_for())
    assert jobs == [
        ("ws-1", "confirm_website_unreachable", {"business_id": "b-1"}, check_website.CONFIRM_DELAY_S)
    ]
    assert check_website.CONFIRM_DELAY_S >= 1800


@respx.mock
def test_run_reiht_bei_einem_zeitablauf_keine_bestaetigung_ein(monkeypatch):
    """Das ist der Kern der Retry-Sturm-Sorge: nur der Zeitablauf kostet die
    vollen 20 Sekunden, und genau er bekommt keine zweite Beobachtung. Die
    dauerhaften Arten scheitern gemessen in unter fuenf Sekunden."""
    jobs: list[tuple] = []
    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://lahm.de/"}, writes)
    )
    monkeypatch.setattr(check_website, "enqueue", lambda *a, **k: jobs.append(a))
    respx.get("https://lahm.de/").mock(side_effect=httpx.ConnectTimeout("zu langsam"))
    check_website.run(job_for())
    assert jobs == []
    assert writes[0]["website_audit"]["unreachable_kind"] == "timeout"
    assert writes[0]["website_audit"]["findings"] == []


@respx.mock
def test_run_scheitert_nicht_wenn_die_bestaetigung_nicht_eingereiht_werden_kann(monkeypatch):
    """Fehlt der Jobtyp noch in der CHECK-Constraint (Migration 0106 nicht
    angewandt), darf der Job daran nicht scheitern: die Queue wuerde ihn
    wiederholen und denselben Abruf erneut ausfuehren."""
    writes: list[dict] = []
    monkeypatch.setattr(
        check_website, "sb", fake_sb({"id": "b-1", "website": "https://weg.de/"}, writes)
    )

    def boom(*_a, **_k):
        raise RuntimeError("jobs_type_check")

    monkeypatch.setattr(check_website, "enqueue", boom)
    respx.get("https://weg.de/").mock(side_effect=httpx.ConnectError("getaddrinfo failed"))
    check_website.run(job_for())  # darf nicht werfen
    assert writes[0]["website_audit_status"] == "unreachable"


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
    assert kinds == ["update", "in_", "enqueue", "enqueue", "enqueue", "enqueue"]
    assert calls[0][1] == {"website_audit_status": "pending"}
    assert calls[1][1] == ["b-1", "b-4"]  # ohne Website kein Job
    assert [c[2] for c in calls[2:]] == ["b-1", "b-4", "b-1", "b-4"]
    # ERST alle Pruefungen, DANN alle Befundsaetze: verschraenkt eingereiht
    # traefe jeder Befundsatz-Job seine eigene Pruefung noch laufend an.
    assert [c[1] for c in calls[2:]] == [
        "check_website",
        "check_website",
        "write_website_finding",
        "write_website_finding",
    ]


def test_queue_website_audits_ruehrt_nichts_an_wenn_niemand_eine_website_hat(monkeypatch):
    monkeypatch.setattr(
        get_businesses, "sb", lambda: pytest.fail("kein Update ohne Kandidaten")
    )
    monkeypatch.setattr(get_businesses, "enqueue", lambda *a: pytest.fail("kein Job"))
    get_businesses._queue_website_audits("ws-1", [{"id": "b-1", "website": None}])


# ── Der Rueckbau: der Befund geht NICHT in den Icebreaker ──────────────────
#
# Bis zum 2026-08-24 haengte personalize.build_context den ranghoechsten
# Befund als Zusatzsignal an den Kontext (audit_hint) und wartete dafuer auf
# den Website-Check. Beides ist entfallen; der Befund hat seit Migration 0103
# einen eigenen Job (tests/test_website_finding.py). Diese Tests halten den
# Rueckbau fest, damit ihn niemand versehentlich rueckgaengig macht.


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


def test_icebreaker_bekommt_den_befund_nicht_mehr():
    context = personalize.build_context(business(), "company_summary")
    assert "Nicht sicher" not in context  # CONSEQUENCE_DE von no_https
    assert "HTTPS" not in context
    assert context == "Malerbetrieb aus Kassel."


def test_pain_point_hint_wirkt_wieder_neben_einem_befund():
    """Er war zwischenzeitlich vom Befund verdraengt. Jetzt ist er wieder das
    einzige Zusatzsignal des Icebreakers."""
    context = personalize.build_context(business(rating=2.1), "company_summary")
    assert "Google-Bewertung" in context


def test_icebreaker_wartet_nicht_mehr_auf_den_check():
    """Der laufende Check darf den Icebreaker nicht mehr aufhalten: er braucht
    ihn nicht, und jedes Warten waere ein verschenkter Queue-Versuch."""
    biz = business(website_audit_status="pending", website_audit={})
    assert personalize.build_context(biz, "company_summary") == "Malerbetrieb aus Kassel."


def test_audit_hint_gibt_es_nicht_mehr():
    assert not hasattr(personalize, "audit_hint")
    assert not hasattr(personalize, "audit_pending")
