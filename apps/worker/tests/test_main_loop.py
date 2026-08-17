"""Der Poll-Loop darf einen Netzfehler ueberleben.

Real passiert: ein DNS-Aussetzer in queue.claim_job() ("httpx.ConnectError:
getaddrinfo failed") hat den kompletten Worker-Prozess beendet. Da der Job
davor schon auf 'running' stand, blieb er dort haengen. Genau das Muster,
das im Betrieb als "Worker-Container wechseln staendig" und "Jobs bleiben
liegen" sichtbar war.
"""
import pytest

from worker import main as worker_main


class _StopLoop(Exception):
    """Bricht die Endlosschleife im Test kontrolliert ab."""


def _run_loop_until(monkeypatch, claim_side_effects, max_sleeps=10):
    """Laesst main() laufen, bis claim_job durch ist, und sammelt die Sleeps."""
    calls = {"claim": 0}
    sleeps: list[float] = []

    def fake_claim():
        i = calls["claim"]
        calls["claim"] += 1
        if i >= len(claim_side_effects):
            raise _StopLoop
        outcome = claim_side_effects[i]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) > max_sleeps:
            raise _StopLoop

    monkeypatch.setattr(worker_main.queue, "claim_job", fake_claim)
    monkeypatch.setattr(worker_main.time, "sleep", fake_sleep)
    monkeypatch.setattr(worker_main, "process_due_schedules", lambda: None)
    # Der Herzschlag geht ueber das Netz. Ohne diese Attrappe schreiben die
    # Tests in die echte Datenbank; passiert genau so, nachweisbar an einer
    # Zeile mit dem Hostnamen des Entwicklungsrechners in worker_heartbeat.
    # Im Dashboard tauchte sie danach als toter Arbeitsprozess auf.
    monkeypatch.setattr(worker_main.queue, "ping", lambda: None)

    with pytest.raises(_StopLoop):
        worker_main.main()
    return calls, sleeps


def test_netzfehler_beim_abholen_beendet_den_worker_nicht(monkeypatch):
    import httpx

    calls, sleeps = _run_loop_until(
        monkeypatch,
        [httpx.ConnectError("getaddrinfo failed"), None, None],
    )
    # Nach dem Fehler wurde weiter gepollt statt abzustuerzen.
    assert calls["claim"] >= 3
    assert sleeps, "nach dem Fehler muss gewartet werden"


def test_wiederholte_fehler_warten_zunehmend_laenger(monkeypatch):
    import httpx

    err = httpx.ConnectError("boom")
    _, sleeps = _run_loop_until(monkeypatch, [err, err, err, err])
    # Backoff waechst, bleibt aber gedeckelt.
    assert sleeps[0] < sleeps[-1], f"kein Backoff erkennbar: {sleeps}"
    assert max(sleeps) <= 60


def test_fehler_beim_speichern_des_jobfehlers_beendet_den_worker_nicht(monkeypatch):
    """Auch fail_job() geht ueber das Netz; scheitert es, darf der Worker
    nicht mitsterben. Der Job faellt dann in die Zeitueberschreitung von
    claim_job() (Migration 0047) und wird spaeter neu eingereiht."""
    import httpx

    job = {"id": "job-1", "type": "get_businesses", "attempts": 1, "max_attempts": 3}

    def boom_handler(_job):
        raise RuntimeError("Job kaputt")

    def boom_fail_job(*_a, **_k):
        raise httpx.ConnectError("DB nicht erreichbar")

    monkeypatch.setitem(worker_main.HANDLERS, "get_businesses", boom_handler)
    monkeypatch.setattr(worker_main.queue, "fail_job", boom_fail_job)

    calls, _ = _run_loop_until(monkeypatch, [job, None])
    assert calls["claim"] >= 2, "Loop lief nach dem Doppelfehler weiter"
