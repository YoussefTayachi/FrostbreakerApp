"""Worker-Entrypoint: pollt public.jobs und dispatcht an Pipelines."""
import logging
import time
from datetime import datetime, timedelta, timezone

from worker import queue
from worker.db import sb
from worker.pipelines import find_decisionmaker, get_businesses, hunt_persons, personalize, poll_instantly

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

HANDLERS = {
    "get_businesses": get_businesses.run,
    "find_decisionmaker": find_decisionmaker.run,
    "hunt_persons": hunt_persons.run,
    "personalize": personalize.run,
    "poll_instantly": poll_instantly.run,
    "poll_instantly_inbox": poll_instantly.run_inbox,
    # Phase 3 (interne Sende-Engine): send_batch, poll_inbox -- bewusst nicht gebaut,
    # siehe Differenzierungs-Plan Punkt 0: Instantly bleibt Sende-Infrastruktur,
    # poll_instantly holt nur die Ergebnisse zurueck.
}

POLL_INTERVAL_S = 5
SCHEDULE_INTERVALS = {
    "daily": timedelta(days=1),
    "weekly": timedelta(weeks=1),
    "biweekly": timedelta(weeks=2),
}
INSTANTLY_POLL_INTERVAL = timedelta(minutes=5)


def process_due_schedules() -> None:
    """Lead-Abos: fällige wiederkehrende Suchen erneut anstoßen (füllt dieselbe Liste)."""
    now = datetime.now(timezone.utc).isoformat()
    due = (
        sb()
        .table("searches")
        .select("id,workspace_id,schedule")
        .neq("schedule", "none")
        .lte("next_run_at", now)
        .is_("deleted_at", "null")
        .execute()
        .data
    )
    for s in due:
        interval = SCHEDULE_INTERVALS.get(s["schedule"])
        if interval is None:
            continue
        next_run = datetime.now(timezone.utc) + interval
        sb().table("searches").update(
            {"next_run_at": next_run.isoformat(), "status": "pending"}
        ).eq("id", s["id"]).execute()
        queue.enqueue(s["workspace_id"], "get_businesses", {"search_id": s["id"]})
        log.info("Abo-Suche %s erneut eingeplant (%s)", s["id"], s["schedule"])


def process_due_instantly_polls() -> None:
    """Fuer jede Suche mit verknuepfter Instantly-Kampagne alle paar Minuten die
    Ergebnisse abholen (Analytics + neue Antworten). Bewusstes Polling statt
    Webhook, siehe Modul-Docstring in poll_instantly.py."""
    cutoff = (datetime.now(timezone.utc) - INSTANTLY_POLL_INTERVAL).isoformat()
    due = (
        sb()
        .table("searches")
        .select("id,workspace_id")
        .not_.is_("instantly_campaign_id", "null")
        .or_(f"instantly_last_polled_at.is.null,instantly_last_polled_at.lt.{cutoff}")
        .execute()
        .data
    )
    for s in due:
        queue.enqueue(s["workspace_id"], "poll_instantly", {"search_id": s["id"]})


def process_due_inbox_sync() -> None:
    """Mailbox-weiter Posteingang: ein Job pro Workspace mit hinterlegtem
    Instantly-Key, alle paar Minuten -- unabhaengig von process_due_instantly_polls()
    oben, das bleibt fuer die kampagnen-scoped Analytics zustaendig."""
    cutoff = (datetime.now(timezone.utc) - INSTANTLY_POLL_INTERVAL).isoformat()
    workspaces_with_key = (
        sb()
        .table("api_keys")
        .select("workspace_id")
        .eq("provider", "instantly")
        .execute()
        .data
    )
    due = (
        sb()
        .table("workspaces")
        .select("id")
        .in_("id", [w["workspace_id"] for w in workspaces_with_key])
        .or_(f"instantly_inbox_synced_at.is.null,instantly_inbox_synced_at.lt.{cutoff}")
        .execute()
        .data
    )
    for w in due:
        queue.enqueue(w["id"], "poll_instantly_inbox", {})


def main() -> None:
    log.info("Worker gestartet (%s)", queue.WORKER_ID)
    last_schedule_check = 0.0
    last_instantly_check = 0.0
    while True:
        if time.monotonic() - last_schedule_check > 60:
            last_schedule_check = time.monotonic()
            try:
                process_due_schedules()
            except Exception:  # noqa: BLE001
                log.exception("Abo-Scheduler fehlgeschlagen")
        if time.monotonic() - last_instantly_check > 60:
            last_instantly_check = time.monotonic()
            try:
                process_due_instantly_polls()
            except Exception:  # noqa: BLE001
                log.exception("Instantly-Poll-Scheduler fehlgeschlagen")
            try:
                process_due_inbox_sync()
            except Exception:
                log.exception("Inbox-Sync-Scheduler fehlgeschlagen")
        job = queue.claim_job()
        if job is None:
            time.sleep(POLL_INTERVAL_S)
            continue
        log.info("Job %s (%s) gestartet", job["id"], job["type"])
        handler = HANDLERS.get(job["type"])
        try:
            if handler is None:
                raise ValueError(f"Unbekannter Job-Typ: {job['type']}")
            handler(job)
            queue.complete_job(job["id"])
            log.info("Job %s abgeschlossen", job["id"])
        except Exception as exc:  # noqa: BLE001
            log.exception("Job %s fehlgeschlagen", job["id"])
            queue.fail_job(job, str(exc))


if __name__ == "__main__":
    main()
