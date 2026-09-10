"""Was bei einem Verbindungsabriss zu PostgREST passiert (kein Netz, keine DB).

Anlass ist die Stoerung vom 2026-09-10: vierzehn Jobs quer durch sechs Typen
sind binnen Sekunden mit "Server disconnected" gescheitert, waehrend die
Edge-Logs derselben Minute ausschliesslich 2xx zeigen. Beschrieben in
worker/db.py und worker/queue.py::enqueue_many.
"""
import httpx
import pytest

from worker import db, queue


def _lauf(monkeypatch, methode: str, fehler: int) -> tuple[int, bool]:
    """Eine Anfrage durch die echte Schleife aus db.py schicken.

    `fehler` sagt, wie viele Anfragen abreissen, bevor der Unterbau
    antwortet. Ersetzt wird httpx.HTTPTransport.handle_request, also genau
    die Zeile, die unter der Schleife den Socket benutzt -- so laeuft der
    Mechanismus aus db.py selbst und keine Nachbildung davon.

    Rueckgabe: wie oft der Unterbau gefragt wurde, und ob es geklappt hat.
    """
    gezaehlt = {"n": 0}

    def unterbau(_self, request: httpx.Request) -> httpx.Response:
        gezaehlt["n"] += 1
        if gezaehlt["n"] <= fehler:
            raise httpx.RemoteProtocolError("Server disconnected", request=request)
        return httpx.Response(200, request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", unterbau)
    monkeypatch.setattr(db.time, "sleep", lambda _s: None)

    transport = db._AbrissfesterTransport()
    request = httpx.Request(methode, "https://example.supabase.co/rest/v1/jobs")
    try:
        transport.handle_request(request)
        return gezaehlt["n"], True
    except httpx.RemoteProtocolError:
        return gezaehlt["n"], False


def test_lesen_wird_nach_einem_abriss_wiederholt(monkeypatch):
    versuche, geklappt = _lauf(monkeypatch, "GET", fehler=1)
    assert geklappt
    assert versuche == 2


def test_schreiben_wird_nie_wiederholt(monkeypatch):
    # Ein wiederholtes POST koennte denselben Job ein zweites Mal einreihen
    # und damit fremde API-Credits ein zweites Mal ausgeben. Ob der Server
    # die abgerissene Anfrage ausgefuehrt hat, ist von hier aus nicht zu
    # sehen. Zustaendig ist der Queue-Retry, nicht die HTTP-Schicht.
    versuche, geklappt = _lauf(monkeypatch, "POST", fehler=1)
    assert not geklappt
    assert versuche == 1


def test_lesen_gibt_nach_drei_versuchen_auf(monkeypatch):
    versuche, geklappt = _lauf(monkeypatch, "GET", fehler=99)
    assert not geklappt
    assert versuche == db.LESE_VERSUCHE


def test_enqueue_many_schreibt_einen_einzigen_insert(monkeypatch):
    eingefuegt: list = []

    class Recorder:
        def table(self, name):
            assert name == "jobs"
            return self

        def insert(self, rows):
            eingefuegt.append(rows)
            return self

        def execute(self):
            return type("R", (), {"data": None})()

    monkeypatch.setattr(queue, "sb", lambda: Recorder())
    queue.enqueue_many("ws-1", "check_website", [{"business_id": f"b-{i}"} for i in range(60)])
    assert len(eingefuegt) == 1, "60 Firmen, ein Netzaufruf"
    assert len(eingefuegt[0]) == 60
    assert eingefuegt[0][0] == {
        "workspace_id": "ws-1",
        "type": "check_website",
        "payload": {"business_id": "b-0"},
    }
    assert "run_at" not in eingefuegt[0][0]


def test_enqueue_many_ohne_kandidaten_fasst_die_datenbank_nicht_an(monkeypatch):
    monkeypatch.setattr(queue, "sb", lambda: pytest.fail("kein Aufruf ohne Zeilen"))
    queue.enqueue_many("ws-1", "check_website", [])


def test_enqueue_many_setzt_run_at_bei_verzoegerung(monkeypatch):
    eingefuegt: list = []

    class Recorder:
        def table(self, _n):
            return self

        def insert(self, rows):
            eingefuegt.append(rows)
            return self

        def execute(self):
            return type("R", (), {"data": None})()

    monkeypatch.setattr(queue, "sb", lambda: Recorder())
    queue.enqueue_many("ws-1", "personalize", [{"business_id": "b-1"}], delay_s=3600)
    assert "run_at" in eingefuegt[0][0]
