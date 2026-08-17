"""Worker-Entrypoint: pollt public.jobs und dispatcht an Pipelines.

Instantly-Polling (Kampagnen-Analytics + mailbox-weiter Inbox-Sync) laeuft NICHT
mehr hier. Das war frueher poll_instantly.py, ist aber seit der Migration auf
apps/web/app/api/cron/instantly-sync/route.ts umgezogen (von Supabase pg_cron
alle 5 Minuten aufgerufen, siehe Migration 0041). Grund: dieser Worker laeuft nur,
wenn ihn jemand lokal startet, und fuer einen "alle 5 Minuten nachschauen"-Trigger
ist das der falsche Mechanismus. Die verbleibenden Pipelines hier (Leadsuche)
brauchen weiterhin einen laufenden Worker, das ist unveraendert.
"""
import logging
import time
from datetime import datetime, timedelta, timezone

from worker import queue
from worker.db import sb
from worker.pipelines import find_decisionmaker, get_businesses, hunt_persons, personalize
from worker.search_state import SearchCancelled

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

HANDLERS = {
    "get_businesses": get_businesses.run,
    "find_decisionmaker": find_decisionmaker.run,
    "hunt_persons": hunt_persons.run,
    "personalize": personalize.run,
    # Phase 3 (interne Sende-Engine): send_batch, poll_inbox, bewusst nicht gebaut,
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


# Wie oft der Worker von sich hoeren laesst. Deutlich seltener als der
# Poll-Takt (5s), weil jeder Herzschlag ein Netzaufruf ist und der Zustand
# sich zwischen zwei Sekunden nicht sinnvoll aendert. Muss zur Schwelle in
# worker_health() passen (2 Minuten); mit 30s bleibt Luft fuer ein paar
# verschluckte Aufrufe, bevor faelschlich Alarm gemeldet wird.
HEARTBEAT_INTERVAL_S = 30

# Welcher Anbieter gilt als "antwortet wieder", wenn dieser Job-Typ glueckt?
# Nur die eindeutigen Faelle. get_businesses fehlt bewusst, weil dort je nach
# Quelle der Suche Google Maps, Hunter oder Apollo zustaendig ist und ein
# falsch aufgeloester Alarm schlimmer waere als ein stehengebliebener.
# Spiegelt _JOB_TYPE_PROVIDERS in worker/provider_errors.py.
PROVIDER_BY_JOB_TYPE = {
    "find_decisionmaker": "openai",
    "personalize": "openai",
    "hunt_persons": "hunter",
}


def main() -> None:
    log.info("Worker gestartet (%s)", queue.WORKER_ID)
    last_schedule_check = 0.0
    last_heartbeat = 0.0
    consecutive_poll_errors = 0
    while True:
        # Vor allem anderen, auch vor dem Job-Abholen: gerade wenn die
        # Warteschlange klemmt, ist die Information "ich lebe noch" am
        # wertvollsten. Stuende der Herzschlag weiter unten, wuerde ein
        # haengender Job ihn mit verschlucken und wie ein toter Worker
        # aussehen.
        if time.monotonic() - last_heartbeat > HEARTBEAT_INTERVAL_S:
            last_heartbeat = time.monotonic()
            try:
                queue.ping()
            except Exception:
                # Ein misslungenes Lebenszeichen ist ein Anzeigeproblem, kein
                # Grund, die Arbeit einzustellen. Nur protokollieren.
                log.warning("Lebenszeichen konnte nicht gesetzt werden", exc_info=True)

        if time.monotonic() - last_schedule_check > 60:
            last_schedule_check = time.monotonic()
            try:
                process_due_schedules()
            except Exception:
                log.exception("Abo-Scheduler fehlgeschlagen")

        # Das Abholen selbst war bisher ungeschuetzt: ein einzelner
        # Netz-Schluckauf (DNS-Aussetzer, Supabase kurz nicht erreichbar,
        # Verbindungsabbruch) hat den ganzen Prozess beendet. Real passiert:
        # "httpx.ConnectError: getaddrinfo failed", danach Worker tot. Genau daher
        # ruehren die staendig wechselnden Worker-IDs und die Jobs, die auf
        # 'running' haengen blieben: nicht der Hoster hat die Container
        # ausgetauscht, der Worker ist schlicht abgestuerzt.
        try:
            job = queue.claim_job()
            consecutive_poll_errors = 0
        except Exception:
            consecutive_poll_errors += 1
            # Backoff bis 60s, damit ein laengerer Ausfall nicht im
            # 5-Sekunden-Takt das Log flutet. Aufgeben ist keine Option,
            # der Worker soll sich von allein wieder fangen.
            delay = min(POLL_INTERVAL_S * 2 ** min(consecutive_poll_errors - 1, 4), 60)
            log.warning(
                "Job-Abholung fehlgeschlagen (Versuch %s), neuer Versuch in %ss",
                consecutive_poll_errors,
                delay,
                exc_info=True,
            )
            time.sleep(delay)
            continue

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
            # Geglueckt heisst: der Anbieter antwortet wieder. Einen offenen
            # Guthaben-Alarm dafuer aufloesen, damit der Nutzer nichts
            # wegklicken muss (siehe queue.clear_provider_alert).
            provider = PROVIDER_BY_JOB_TYPE.get(job["type"])
            if provider:
                try:
                    queue.clear_provider_alert(job["workspace_id"], provider)
                except Exception:
                    log.warning("Anbieter-Alarm konnte nicht aufgeloest werden", exc_info=True)
        except SearchCancelled:
            # Vom Nutzer gewollt, kein Fehler. Muss VOR dem allgemeinen
            # except stehen, sonst landet der Abbruch in fail_job, und der
            # reiht mit Backoff erneut ein, laesst die Suche also von selbst
            # wieder anlaufen und weiter Credits verbrauchen.
            log.info("Job %s vom Nutzer abgebrochen", job["id"])
            try:
                queue.cancel_job(job["id"])
            except Exception:
                log.exception("Abbruch fuer Job %s konnte nicht gespeichert werden", job["id"])
        except Exception as exc:
            log.exception("Job %s fehlgeschlagen", job["id"])
            # Auch das Wegschreiben des Fehlers geht ueber das Netz. Scheitert
            # es, darf das den Worker nicht mitreissen. Der Job faellt dann
            # in die Zeitueberschreitung von claim_job() (Migration 0047) und
            # wird spaeter automatisch neu eingereiht.
            try:
                queue.fail_job(job, str(exc))
            except Exception:
                log.exception("Fehlerstatus fuer Job %s konnte nicht gespeichert werden", job["id"])


if __name__ == "__main__":
    main()
