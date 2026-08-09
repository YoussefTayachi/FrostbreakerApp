"""Postgres-basierte Job-Queue (public.jobs).

claim_job() nutzt die DB-Funktion claim_job(p_worker) mit FOR UPDATE SKIP LOCKED,
damit mehrere Worker-Instanzen konfliktfrei parallel laufen können.
"""
import logging
import os
import socket
from datetime import datetime, timedelta, timezone

from worker.db import sb
from worker.provider_errors import classify_error, provider_from_error

log = logging.getLogger("worker.queue")

WORKER_ID = socket.gethostname()

# Welche Fassung laeuft hier gerade? Railway setzt den Commit selbst; lokal
# bleibt das Feld leer. Steht im Dashboard neben dem Lebenszeichen und
# beantwortet die Frage "ist mein Deployment ueberhaupt angekommen", ohne
# dafuer ins Railway-Dashboard wechseln zu muessen.
WORKER_VERSION = (os.getenv("RAILWAY_GIT_COMMIT_SHA") or "")[:7] or None


def ping() -> None:
    """Lebenszeichen setzen (Migration 0058).

    Der Worker ist von aussen unsichtbar -- kein Port, keine Oberflaeche.
    Faellt er aus, werden Jobs weiter eingereiht und nur nicht mehr abgeholt;
    in der App sieht eine gestartete Suche dann exakt so aus wie eine
    laufende. Dieser Aufruf ist die einzige Stelle, an der er von sich hoeren
    laesst.

    Fehler werden hier bewusst NICHT gefangen: der Aufrufer in main.py
    entscheidet, was ein fehlgeschlagener Herzschlag bedeutet -- ein Worker
    soll nicht sterben, weil er sich nicht melden konnte.
    """
    sb().rpc("worker_ping", {"p_worker": WORKER_ID, "p_version": WORKER_VERSION}).execute()


def claim_job() -> dict | None:
    rows = sb().rpc("claim_job", {"p_worker": WORKER_ID}).execute().data or []
    return rows[0] if rows else None


def complete_job(job_id: str) -> None:
    sb().table("jobs").update({"status": "completed"}).eq("id", job_id).execute()


def cancel_job(job_id: str) -> None:
    """Der Nutzer hat abgebrochen -- kein Fehler, also auch kein Retry.

    Bewusst nicht ueber fail_job: das reiht mit Backoff erneut ein, und ein
    abgebrochener Suchlauf, der von selbst wieder anlaeuft, waere die teuerste
    denkbare Auslegung von "Abbrechen" (Migration 0086).
    """
    sb().table("jobs").update({"status": "cancelled"}).eq("id", job_id).execute()


# Wie lange ein Job zurueckgestellt wird, wenn beim Anbieter das Guthaben alle
# ist. Eine Stunde, weil niemand ein Konto binnen Minuten auflaedt -- und weil
# der Job bis dahin nichts anderes tut, als denselben Fehler zu erzeugen.
OUT_OF_CREDIT_DELAY_S = 3600


def fail_job(job: dict, error: str) -> None:
    """Retry mit quadratischem Backoff bis max_attempts, danach endgültig failed.

    Sonderfall aufgebrauchtes Guthaben: Wiederholen ist zwecklos, bis ein
    Mensch das Konto auflaedt. Der Job wird deshalb lange zurueckgestellt und
    der verbrauchte Versuch zurueckgegeben -- sonst faellt er in den Zustand
    'failed', obwohl an ihm selbst nichts falsch war.

    Genau das ist am 2026-08-03 passiert: 128 Jobs (88 personalize, 40
    find_decisionmaker) haben ihre Versuche gegen ein leeres OpenAI-Konto
    aufgebraucht und galten danach als endgueltig gescheitert. Nach dem
    Auffuellen haette man sie von Hand neu einreihen muessen -- wenn man
    ueberhaupt gemerkt haette, dass es sie gibt.
    """
    kind = classify_error(error)

    if kind == "out_of_credit":
        provider = provider_from_error(error, job.get("type"))
        if provider:
            try:
                sb().rpc(
                    "record_provider_alert",
                    {
                        "p_workspace_id": job["workspace_id"],
                        "p_provider": provider,
                        "p_message": error[:2000],
                    },
                ).execute()
            except Exception:
                # Der Alarm ist wichtig, aber nicht wichtiger als das saubere
                # Zurueckstellen des Jobs darunter.
                log.warning("Anbieter-Alarm konnte nicht gesetzt werden", exc_info=True)

        run_at = datetime.now(timezone.utc) + timedelta(seconds=OUT_OF_CREDIT_DELAY_S)
        sb().table("jobs").update(
            {
                "status": "pending",
                "last_error": error[:2000],
                "run_at": run_at.isoformat(),
                # Versuch zurueckgeben: claim_job() zaehlt beim Abholen hoch,
                # und dieser Abruf war kein Fehlversuch des Jobs.
                "attempts": max(job["attempts"] - 1, 0),
            }
        ).eq("id", job["id"]).execute()
        return

    if job["attempts"] >= job["max_attempts"]:
        patch = {"status": "failed", "last_error": error[:2000]}
    else:
        delay_s = 60 * job["attempts"] ** 2
        run_at = datetime.now(timezone.utc) + timedelta(seconds=delay_s)
        patch = {"status": "pending", "last_error": error[:2000], "run_at": run_at.isoformat()}
    sb().table("jobs").update(patch).eq("id", job["id"]).execute()


def clear_provider_alert(workspace_id: str, provider: str) -> None:
    """Alarm aufloesen, wenn dieser Anbieter wieder antwortet.

    Damit muss niemand eine Warnung wegklicken, nachdem er das Guthaben
    aufgeladen hat -- sie verschwindet beim naechsten geglueckten Job von
    selbst. Eine Meldung, die man von Hand wegraeumen muss, steht sonst
    wochenlang herum und wird genauso ignoriert wie eine, die nie kam.
    """
    sb().rpc(
        "resolve_provider_alert", {"p_workspace_id": workspace_id, "p_provider": provider}
    ).execute()


def enqueue(workspace_id: str, job_type: str, payload: dict | None = None) -> None:
    sb().table("jobs").insert(
        {"workspace_id": workspace_id, "type": job_type, "payload": payload or {}}
    ).execute()
