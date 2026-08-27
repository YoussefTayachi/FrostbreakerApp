"""Die zweite Beobachtung einer nicht erreichbaren Website.

Gepruefte Frage: unter welchen Bedingungen darf aus "nicht erreichbar" der
Satz "eure Seite laedt gar nicht" werden, und unter welchen nicht. Die
Fehlerrichtung ist ueberall dieselbe: im Zweifel kein Befund.
"""
import httpx
import pytest
import respx

from tests.test_check_website import HTML, fake_sb
from worker import website_fetch
from worker.pipelines import confirm_unreachable

CONTROL = website_fetch.CONTROL_URL


def job_for(business_id: str = "b-1") -> dict:
    return {"workspace_id": "ws-1", "payload": {"business_id": business_id}}


def row(**over) -> dict:
    r = {
        "id": "b-1",
        "website": "https://weg.de/",
        "website_audit_status": "unreachable",
        "website_audit": {
            "checked_url": "https://weg.de/",
            "findings": [],
            "unreachable_kind": "dns",
            "unreachable_first_seen_at": "2026-08-27T10:00:00+00:00",
            "unreachable_confirmed_at": None,
        },
    }
    r.update(over)
    return r


def setup(monkeypatch, biz: dict) -> tuple[list[dict], list[tuple]]:
    writes: list[dict] = []
    jobs: list[tuple] = []
    monkeypatch.setattr(confirm_unreachable, "sb", fake_sb(biz, writes))
    monkeypatch.setattr(
        confirm_unreachable, "enqueue", lambda ws, t, p, **k: jobs.append((ws, t, p))
    )
    return writes, jobs


def fetch_raises(monkeypatch, exc: BaseException) -> None:
    """Den Abruf scheitern lassen, ohne den Umweg ueber respx.

    Noetig, wo es auf die Ursachenkette ankommt: respx ueberschreibt beim
    Ausloesen eines side_effect das __cause__ der Ausnahme mit seinem eigenen
    SideEffectError, und dann prueft der Test die Textabsicherung von
    classify_failure statt der Typerkennung. Die Typerkennung selbst haengt in
    tests/test_check_website.py, dort ohne respx.
    """

    def boom(_url: str):
        raise exc

    monkeypatch.setattr(confirm_unreachable, "inspect_page", boom)


def mock_control(up: bool = True) -> None:
    if up:
        respx.get(CONTROL).mock(return_value=httpx.Response(200, html="<html></html>"))
    else:
        respx.get(CONTROL).mock(side_effect=httpx.ConnectError("auch das Netz ist weg"))


# ── Der Befund entsteht ────────────────────────────────────────────────────


@respx.mock
def test_zweimal_dasselbe_ergibt_den_befund(monkeypatch):
    writes, jobs = setup(monkeypatch, row())
    respx.get("https://weg.de/").mock(side_effect=httpx.ConnectError("getaddrinfo failed"))
    mock_control(up=True)

    confirm_unreachable.run(job_for())

    audit = writes[0]["website_audit"]
    assert writes[0]["website_audit_status"] == "unreachable"
    assert [f["code"] for f in audit["findings"]] == ["site_unreachable"]
    assert audit["unreachable_confirmed_at"]
    # Die erste Beobachtung bleibt erhalten: ohne sie waere der Befund von
    # aussen nicht mehr als zweifach belegt erkennbar.
    assert audit["unreachable_first_seen_at"] == "2026-08-27T10:00:00+00:00"
    # Der Befundsatz muss nachtraeglich angestossen werden: der urspruengliche
    # write_website_finding-Job lief laengst und fand eine leere Liste.
    assert jobs == [("ws-1", "write_website_finding", {"business_id": "b-1"})]


@respx.mock
def test_die_fehlerart_darf_zwischen_den_beobachtungen_wechseln(monkeypatch):
    """Erst kein DNS-Eintrag, jetzt bricht der Handschlag ab: beides ist
    dauerhaft, und beides heisst fuer den Besucher dasselbe. Ein exakter
    Gleichstand der Fehlerart waere Erbsenzaehlerei."""
    import ssl

    writes, _ = setup(monkeypatch, row())
    fehler = httpx.ConnectError("handshake")
    fehler.__cause__ = ssl.SSLEOFError("EOF")
    fetch_raises(monkeypatch, fehler)
    mock_control(up=True)

    confirm_unreachable.run(job_for())

    audit = writes[0]["website_audit"]
    assert [f["code"] for f in audit["findings"]] == ["site_unreachable"]
    assert audit["unreachable_kind"] == "tls"


# ── Der Befund entsteht NICHT ──────────────────────────────────────────────


@respx.mock
def test_ohne_gegenprobe_kein_befund(monkeypatch):
    """Der teuerste denkbare Fehlalarm: faellt auf der Replik der Resolver
    aus, scheitern beide Beobachtungen, und eine ganze Liste bekaeme den
    Befund. Dann wird gar nichts geschrieben."""
    writes, jobs = setup(monkeypatch, row())
    respx.get("https://weg.de/").mock(side_effect=httpx.ConnectError("getaddrinfo failed"))
    mock_control(up=False)

    confirm_unreachable.run(job_for())

    assert writes == []
    assert jobs == []


@respx.mock
def test_ein_zeitablauf_beim_zweiten_mal_ergibt_keinen_befund(monkeypatch):
    """Die beiden Beobachtungen sagen nicht dasselbe. Das reicht nicht fuer
    die staerkste Aussage des Katalogs."""
    writes, jobs = setup(monkeypatch, row())
    respx.get("https://weg.de/").mock(side_effect=httpx.ConnectTimeout("zu langsam"))

    confirm_unreachable.run(job_for())

    assert writes[0]["website_audit"]["findings"] == []
    assert writes[0]["website_audit"]["unreachable_kind"] == "timeout"
    assert jobs == []


@respx.mock
def test_eine_wieder_erreichbare_seite_bekommt_ihren_echten_befund(monkeypatch):
    """Der stillschweigend haeufigere Gewinn: der erste Fehlschlag war ein
    Aussetzer, und der Lead bleibt jetzt nicht mit einer Leerstelle stehen."""
    writes, jobs = setup(monkeypatch, row())
    respx.get("https://weg.de/").mock(
        return_value=httpx.Response(200, html=HTML, headers={"content-type": "text/html"})
    )
    respx.get("http://weg.de/").mock(
        return_value=httpx.Response(301, headers={"location": "https://weg.de/"})
    )

    confirm_unreachable.run(job_for())

    assert writes[0]["website_audit_status"] == "ok"
    assert writes[0]["website_audit"]["findings"] == []
    assert jobs == [("ws-1", "write_website_finding", {"business_id": "b-1"})]


def test_ein_kaputtes_zertifikat_beim_zweiten_mal_ist_sein_eigener_befund(monkeypatch):
    import ssl

    writes, jobs = setup(monkeypatch, row())
    fehler = httpx.ConnectError("cert")
    fehler.__cause__ = ssl.SSLCertVerificationError("certificate verify failed: expired")
    fetch_raises(monkeypatch, fehler)

    confirm_unreachable.run(job_for())

    assert writes[0]["website_audit_status"] == "ok"  # ok heisst geprueft
    assert [f["code"] for f in writes[0]["website_audit"]["findings"]] == ["ssl_broken"]
    assert jobs == [("ws-1", "write_website_finding", {"business_id": "b-1"})]


# ── Absicherung gegen doppelte Zustellung ──────────────────────────────────


def test_bestaetigt_nicht_zweimal(monkeypatch):
    biz = row(
        website_audit={
            "checked_url": "https://weg.de/",
            "findings": [{"code": "site_unreachable", "evidence": None}],
            "unreachable_kind": "dns",
            "unreachable_confirmed_at": "2026-08-27T10:30:00+00:00",
        }
    )
    writes, jobs = setup(monkeypatch, biz)
    confirm_unreachable.run(job_for())  # ohne respx: jeder Abruf floege auf
    assert writes == []
    assert jobs == []


def test_ruehrt_nichts_an_wenn_der_status_nicht_mehr_unreachable_ist(monkeypatch):
    """Jemand hat die Firma zwischenzeitlich neu pruefen lassen. Deren
    Ergebnis gilt, nicht die alte Beobachtung."""
    writes, jobs = setup(monkeypatch, row(website_audit_status="ok", website_audit={"findings": []}))
    confirm_unreachable.run(job_for())
    assert writes == []
    assert jobs == []


def test_ueberspringt_geloeschte_listen(monkeypatch):
    biz = row(searches={"deleted_at": "2026-08-01T00:00:00+00:00"})
    writes, jobs = setup(monkeypatch, biz)
    confirm_unreachable.run(job_for())
    assert writes == []
    assert jobs == []


def test_scheitert_nicht_wenn_der_befundsatz_nicht_eingereiht_werden_kann(monkeypatch):
    """Der Befund steht schon in der Datenbank. Ein Fehler beim Einreihen darf
    diesen Job nicht scheitern lassen, sonst wiederholt die Queue den Abruf."""
    writes: list[dict] = []
    monkeypatch.setattr(confirm_unreachable, "sb", fake_sb(row(), writes))

    def boom(*_a, **_k):
        raise RuntimeError("jobs_type_check")

    monkeypatch.setattr(confirm_unreachable, "enqueue", boom)
    with respx.mock:
        respx.get("https://weg.de/").mock(side_effect=httpx.ConnectError("getaddrinfo failed"))
        mock_control(up=True)
        confirm_unreachable.run(job_for())  # darf nicht werfen
    assert [f["code"] for f in writes[0]["website_audit"]["findings"]] == ["site_unreachable"]


def test_kein_abruf_ohne_brauchbare_adresse(monkeypatch):
    writes, jobs = setup(monkeypatch, row(website="mailto:info@weg.de"))
    confirm_unreachable.run(job_for())
    assert writes == []
    assert jobs == []


# ── Der Katalog haengt daran ───────────────────────────────────────────────


def test_der_befund_hat_tatsache_und_folge():
    """Ohne beides steigt website_finding.finding_context mit einer Warnung
    aus, und der teuerste Aufhaenger waere still verloren."""
    from worker import website_audit

    assert website_audit.FACT_DE["site_unreachable"]
    assert website_audit.CONSEQUENCE_DE["site_unreachable"]


def test_der_job_ist_im_dispatcher_eingetragen():
    """Ohne Eintrag wirft main.py 'Unbekannter Job-Typ' und die Queue
    wiederholt den Job bis max_attempts."""
    from worker import main

    assert main.HANDLERS["confirm_website_unreachable"] is confirm_unreachable.run


def test_der_jobtyp_steht_in_der_migration():
    """Fehlt er in der CHECK-Constraint, laesst er sich gar nicht einreihen."""
    from pathlib import Path

    sql = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "0106_site_unreachable.sql"
    assert "confirm_website_unreachable" in sql.read_text(encoding="utf-8")


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__])
