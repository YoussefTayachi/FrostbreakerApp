"""Postgres-basierte Job-Queue (public.jobs).

claim_job() nutzt die DB-Funktion claim_job(p_worker) mit FOR UPDATE SKIP LOCKED,
damit mehrere Worker-Instanzen konfliktfrei parallel laufen können.
"""
import os
import socket
from datetime import datetime, timedelta, timezone

from worker.db import sb

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


def fail_job(job: dict, error: str) -> None:
    """Retry mit quadratischem Backoff bis max_attempts, danach endgültig failed."""
    if job["attempts"] >= job["max_attempts"]:
        patch = {"status": "failed", "last_error": error[:2000]}
    else:
        delay_s = 60 * job["attempts"] ** 2
        run_at = datetime.now(timezone.utc) + timedelta(seconds=delay_s)
        patch = {"status": "pending", "last_error": error[:2000], "run_at": run_at.isoformat()}
    sb().table("jobs").update(patch).eq("id", job["id"]).execute()


def enqueue(workspace_id: str, job_type: str, payload: dict | None = None) -> None:
    sb().table("jobs").insert(
        {"workspace_id": workspace_id, "type": job_type, "payload": payload or {}}
    ).execute()
