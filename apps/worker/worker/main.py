"""Worker-Entrypoint: pollt public.jobs und dispatcht an Pipelines.

Instantly-Polling (Kampagnen-Analytics + mailbox-weiter Inbox-Sync) laeuft NICHT
mehr hier -- das war frueher poll_instantly.py, ist aber seit der Migration auf
apps/web/app/api/cron/instantly-sync/route.ts umgezogen (von Supabase pg_cron
alle 5 Minuten aufgerufen, siehe Migration 0041). Grund: dieser Worker laeuft nur,
wenn ihn jemand lokal startet -- fuer einen "alle 5 Minuten nachschauen"-Trigger
ist das der falsche Mechanismus. Die verbleibenden Pipelines hier (Leadsuche)
brauchen weiterhin einen laufenden Worker, das ist unveraendert.
"""
import logging
import time
from datetime import datetime, timedelta, timezone

from worker import queue
from worker.db import sb
from worker.pipelines import find_decisionmaker, get_businesses, hunt_persons, personalize

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

HANDLERS = {
    "get_businesses": get_businesses.run,
    "find_decisionmaker": find_decisionmaker.run,
    "hunt_persons": hunt_persons.run,
    "personalize": personalize.run,
    # Phase 3 (interne Sende-Engine): send_batch, poll_inbox -- bewusst nicht gebaut,
    # siehe Differenzierungs-Plan Punkt 0: Instantly bleibt Sende-Infrastruktur.
}

POLL_INTERVAL_S = 5
SCHEDULE_INTERVALS = {
    "daily": timedelta(days=1),
    "weekly": timedelta(weeks=1),
    "biweekly": timedelta(weeks=2),
}


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


def main() -> None:
    log.info("Worker gestartet (%s)", queue.WORKER_ID)
    last_schedule_check = 0.0
    while True:
        if time.monotonic() - last_schedule_check > 60:
            last_schedule_check = time.monotonic()
            try:
                process_due_schedules()
            except Exception:  # noqa: BLE001
                log.exception("Abo-Scheduler fehlgeschlagen")
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
