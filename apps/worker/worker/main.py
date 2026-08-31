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
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from worker import queue
from worker.db import sb
from worker.pipelines import (
    browser_check,
    check_website,
    confirm_unreachable,
    find_decisionmaker,
    get_businesses,
    hunt_persons,
    personalize,
    website_finding,
)
from worker.search_state import SearchCancelled

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("worker")

HANDLERS = {
    "get_businesses": get_businesses.run,
    # Die zweite Stufe des Website-Checks. Eigener Jobtyp aus demselben
    # Grund wie check_website: sie dauert Sekunden statt Millisekunden
    # und darf die Abarbeitung einer Liste nicht aufhalten.
    "browser_check": browser_check.run,
    "find_decisionmaker": find_decisionmaker.run,
    "hunt_persons": hunt_persons.run,
    # WARUM DER WEBSITE-CHECK EIN EIGENER JOB IST
    #
    # Er haette an drei bestehende Jobs angehaengt werden koennen, und alle
    # drei waeren schlechter:
    #
    #   find_decisionmaker  laeuft nur im Maps-Weg. Bei corporate, apollo und
    #                       prospeo gaebe es dann gar keinen Befund, also
    #                       ausgerechnet dort nicht, wo keine company_summary
    #                       entsteht und der Aufhaenger am duennsten ist.
    #   get_businesses      hiesse 300 Website-Abrufe nacheinander in EINEM
    #                       Job. Der scheitert am 217. und wiederholt beim
    #                       Retry die ganze Suche, und bis dahin haengt eine
    #                       von zwei Repliken minutenlang an fremden Servern.
    #   personalize         zu spaet: der Befund soll in der Leadliste stehen,
    #                       BEVOR personalisiert wird.
    #
    # Der Preis ist ein zusaetzlicher Job pro Lead. Vertretbar, weil dieser
    # Job der billigste der ganzen Queue ist: ein HTTP-GET mit Zeitlimit,
    # kein Fremd-Credit, kein Modellaufruf.
    "check_website": check_website.run,
    # WARUM DIE BESTAETIGUNG EIN EIGENER JOB IST UND KEIN RETRY
    #
    # Sie sieht aus wie ein zweiter Versuch und ist das Gegenteil davon. Ein
    # Retry laeuft ueber queue.fail_job, gilt als Fehlschlag, wiederholt sich
    # bis max_attempts und belegt dabei sofort wieder eine Replik. Dieser Job
    # laeuft EINMAL, eine halbe Stunde spaeter, und nur fuer die Fehlerarten,
    # die gemessen in unter fuenf Sekunden scheitern.
    #
    # Der Unterschied ist nicht kosmetisch: aus zwei getrennten Beobachtungen
    # darf eine Tatsachenbehauptung in einer Kaltmail werden, aus einer nicht.
    # Die ausfuehrliche Begruendung steht im Docstring von
    # pipelines/confirm_unreachable.py.
    "confirm_website_unreachable": confirm_unreachable.run,
    "personalize": personalize.run,
    # WARUM DER BEFUNDSATZ EIN EIGENER JOB IST UND KEIN ZWEITER AUFRUF IN
    # personalize
    #
    # Beide Wege kosten dasselbe Geld: einen zusaetzlichen OpenAI-Aufruf pro
    # Lead mit Befund. Der Unterschied liegt im Retry, und der entscheidet.
    #
    # Ein zweiter Aufruf innerhalb von personalize haette genau zwei moegliche
    # Formen, und beide sind kaputt:
    #
    #   Erst Icebreaker schreiben, dann Befundsatz. Scheitert der zweite
    #   Aufruf, faellt der ganze Job auf 'failed'. Beim Retry greift ganz oben
    #   die Abkuerzung "personalization ist schon da, also fertig": der Job
    #   kehrt sofort um, der Befundsatz wird NIE geschrieben, und niemand
    #   sieht einen Fehler.
    #
    #   Beides am Ende in EINEM Update schreiben. Scheitert der zweite Aufruf,
    #   ist auch der Icebreaker nicht gespeichert, und der Retry erzeugt ihn
    #   ein zweites Mal. Das ist genau der Fehler, wegen dem mehrere Commits
    #   in der Historie existieren: fremde API-Credits doppelt verbraucht,
    #   weil ein Fehlschlag einen bereits bezahlten Aufruf mitreisst.
    #
    # Als eigener Job hat jeder der beiden Texte sein eigenes Feld, seine
    # eigene Abkuerzung gegen doppelte Zustellung und seinen eigenen Retry.
    # Ein Fehlschlag auf der einen Seite laesst die andere unberuehrt.
    #
    # Der Preis ist ein Job pro Lead mehr. Er faellt kaum ins Gewicht: Leads
    # ohne Befund (keine Website, Seite tot, keine Pruefung schlaegt an)
    # beenden ihn ohne Modellaufruf und ohne Schreibvorgang.
    #
    # Die Wartelogik auf den check_website-Job teilt er sich NICHT mit
    # personalize, sondern hat sie geerbt: sie ist mit dem Rueckbau des
    # Icebreaker-Zusatzsignals von personalize.py nach website_finding.py
    # gewandert, weil nur noch dieser Job auf den Befund angewiesen ist.
    "write_website_finding": website_finding.run,
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


# WIE VIELE JOBS EINE REPLIK GLEICHZEITIG BEARBEITET
#
# Fast jeder Job hier ist Warten auf fremde Server (OpenAI-Websuche 50 bis 60
# Sekunden, Browser-Messung 6 bis 30 Sekunden, HTTP-Abrufe), kein Rechnen.
# Ein Prozess, der einen Job nach dem anderen abarbeitet, steht also die
# meiste Zeit. Gemessen am 2026-08-31: 240 Firmen brauchten auf 2 Repliken
# rund 2,5 Stunden Wanduhr bei ~25 Minuten reiner Browser-Arbeit.
#
# Voreinstellung 1 = exakt das alte Verhalten. Hochdrehen per Env auf
# Railway; 4 bis 6 ist der gemessene sinnvolle Bereich (backfill_browser
# lief mit 4 parallelen Messungen bei ~11 s je Seite). Jeder Faden haelt
# seinen eigenen Chromium (siehe browser_check.pool, thread-lokal), der
# RAM-Bedarf waechst also mit.
WORKER_CONCURRENCY = max(1, int(os.getenv("WORKER_CONCURRENCY", "1") or "1"))

# WELCHE JOBTYPEN DIESE REPLIK FAEHRT (Migration 0108)
#
# Leer = alle, wie bisher. Eine Replik mit
#   WORKER_JOB_TYPES=browser_check,check_website
# wird zur reinen Mess-Spur und laesst die Recherche fuer andere liegen.
# Wer Spuren einrichtet, muss ALLE Typen abdecken: ein Typ, den keine
# Replik faehrt, bleibt liegen, und die App zeigt nur eine haengende Suche.
WORKER_JOB_TYPES = [
    t.strip() for t in (os.getenv("WORKER_JOB_TYPES") or "").split(",") if t.strip()
] or None


def job_loop(name: str) -> None:
    """Ein Faden: Jobs holen und ausfuehren, bis der Prozess endet.

    Der Rumpf ist der bisherige Hauptloop, unveraendert bis auf zwei Dinge:
    der Herzschlag und der Abo-Scheduler wohnen jetzt in main() (einmal je
    Prozess statt einmal je Faden), und claim_job bekommt die Spur dieser
    Replik mit.
    """
    consecutive_poll_errors = 0
    while True:
        # Das Abholen selbst war frueher ungeschuetzt: ein einzelner
        # Netz-Schluckauf (DNS-Aussetzer, Supabase kurz nicht erreichbar)
        # hat den ganzen Prozess beendet. Real passiert:
        # "httpx.ConnectError: getaddrinfo failed", danach Worker tot.
        try:
            job = queue.claim_job(WORKER_JOB_TYPES)
            consecutive_poll_errors = 0
        except Exception:
            consecutive_poll_errors += 1
            # Backoff bis 60s, damit ein laengerer Ausfall nicht im
            # 5-Sekunden-Takt das Log flutet. Aufgeben ist keine Option,
            # der Faden soll sich von allein wieder fangen.
            delay = min(POLL_INTERVAL_S * 2 ** min(consecutive_poll_errors - 1, 4), 60)
            log.warning(
                "%s: Job-Abholung fehlgeschlagen (Versuch %s), neuer Versuch in %ss",
                name,
                consecutive_poll_errors,
                delay,
                exc_info=True,
            )
            time.sleep(delay)
            continue
        if job is None:
            time.sleep(POLL_INTERVAL_S)
            continue
        log.info("%s: Job %s (%s) gestartet", name, job["id"], job["type"])
        handler = HANDLERS.get(job["type"])
        try:
            if handler is None:
                raise ValueError(f"Unbekannter Job-Typ: {job['type']}")
            handler(job)
            queue.complete_job(job["id"])
            log.info("%s: Job %s abgeschlossen", name, job["id"])
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


def main() -> None:
    log.info(
        "Worker gestartet (%s, %s Faeden, Spur: %s)",
        queue.WORKER_ID,
        WORKER_CONCURRENCY,
        ",".join(WORKER_JOB_TYPES) if WORKER_JOB_TYPES else "alle",
    )
    # Die Arbeitsfaeden. Daemon, damit ein sterbender Hauptloop den Prozess
    # beendet und Railway neu startet, statt fuehrerlose Faeden weiterlaufen
    # zu lassen.
    faeden: dict[str, threading.Thread] = {}

    def starte(name: str) -> None:
        t = threading.Thread(target=job_loop, args=(name,), name=name, daemon=True)
        t.start()
        faeden[name] = t

    for i in range(WORKER_CONCURRENCY):
        starte(f"faden-{i + 1}")

    last_schedule_check = 0.0
    last_heartbeat = 0.0
    while True:
        # Vor allem anderen: gerade wenn die Warteschlange klemmt, ist die
        # Information "ich lebe noch" am wertvollsten.
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

        # Waechter ueber die Faeden: job_loop faengt alles, ein toter Faden
        # heisst also, dass etwas Unerwartetes durchgeschlagen ist (zum
        # Beispiel ein MemoryError). Neu starten statt stillschweigend mit
        # weniger Kapazitaet weiterzulaufen.
        for name, t in list(faeden.items()):
            if not t.is_alive():
                log.error("%s ist gestorben, wird neu gestartet", name)
                starte(name)

        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
