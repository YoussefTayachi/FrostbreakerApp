"""Pipeline 7: der Website-Check ein zweites Mal, im echten Browser.

Laeuft NACH check_website und schreibt nach businesses.website_audit_browser
(Migration 0107). Kein Modellaufruf, kein Fremd-Guthaben: der Job kostet eine
Browsersitzung, keine Token.

WARUM ZWEI STUFEN UND NICHT EINE

Der HTML-Check und der Browser scheitern unterschiedlich, und das ist kein
Nachteil, sondern der Grund fuer beide. Gemessen am 2026-08-30 an 38 echten
Leads waren 3 Seiten per rohem HTTP nicht abrufbar und im Browser problemlos.
In die andere Richtung gilt dasselbe: ein Headless-Chromium traegt einen
Fingerabdruck, den Bot-Abwehr erkennt, ein schlichter Abruf nicht. Wer eine
der beiden Stufen streicht, verliert die Faelle, die nur sie sieht.

Die eigentliche Arbeit macht der Browser aber woanders: er WIDERLEGT. Ein
falsches "kein h1" aus rohem HTML gewinnt sonst weiter, obwohl das Element im
gerenderten DOM steht (website_audit.invalidate_with_browser).

EINE WAND IST KEIN MANGEL

Steht ein Consent-Dialog, eine Anmeldung oder eine Bot-Pruefung davor, ist der
Status `inconclusive`. Daraus entsteht nie ein Befund. Einem Inhaber zu
schreiben, seine Seite sei leer, weil ein Cookie-Banner davor stand, ist genau
die erfundene Behauptung, gegen die der ganze Katalog geschrieben ist.

KEIN RETRY-STURM

Wie bei check_website: eine nicht messbare Seite ist ein ERGEBNIS und kein
Fehler. Der Job schreibt seinen Status und gilt als erledigt. Sonst wiederholt
die Queue ihn mit Backoff und wartet jedes Mal denselben Zeitablauf ab.
"""
import logging
import threading
from datetime import datetime, timezone

from worker import website_browser
from worker.db import sb
from worker.queue import enqueue

log = logging.getLogger("worker.browser_check")

# Wohin die Screenshots gehen. Lokal, weil sie nur ein Beleg fuer den
# Menschen sind, der einen Befund gegenliest; sie verlassen den Rechner nicht
# und gehen in keine Mail.
SCREENSHOT_DIR = "out/browser-check"

# Wie lange ein Screenshot liegen bleibt. Ein Beleg zu einem Befund, der
# laengst neu gemessen wurde, ist kein Beleg mehr, und 4365 Leads mal zwei
# Bilder sind Gigabytes.
SCREENSHOT_KEEP_DAYS = 14

# Ein Pool je FADEN, nicht mehr je Prozess. Ein Chromium-Kaltstart kostet
# rund eine Sekunde und damit mehr als die halbe Messung; ihn je Job zu
# zahlen halbiert den Durchsatz. Der Pool ersetzt den Prozess von selbst
# nach N Jobs, damit kein Speicher zusammenlaeuft.
#
# THREAD-LOKAL SEIT WORKER_CONCURRENCY (main.py): Playwrights synchrone API
# gehoert dem Faden, der sie gestartet hat, ein geteilter Browser ueber
# Faeden hinweg stuerzt mit "greenlet switch to a different thread" ab.
# backfill_browser.py macht es aus demselben Grund genauso (ein Pool je
# Arbeiterfaden).
_lokal = threading.local()


def pool() -> website_browser.BrowserPool:
    p = getattr(_lokal, "pool", None)
    if p is None:
        p = website_browser.BrowserPool()
        _lokal.pool = p
    return p


def aufraeumen(verzeichnis: str = SCREENSHOT_DIR, tage: int = SCREENSHOT_KEEP_DAYS) -> int:
    """Alte Screenshots loeschen. Gibt zurueck, wie viele es waren.

    Laeuft beim ersten Job eines Prozesses, nicht als eigener Dienst: ein
    Aufraeumen, das einen Zeitplan braucht, wird beim naechsten Rechnerwechsel
    vergessen.
    """
    import time
    from pathlib import Path

    ordner = Path(verzeichnis)
    if not ordner.is_dir():
        return 0
    grenze = time.time() - tage * 86400
    weg = 0
    for datei in ordner.glob("*.png"):
        try:
            if datei.stat().st_mtime < grenze:
                datei.unlink()
                weg += 1
        except OSError:
            continue
    return weg


_aufgeraeumt = False


# Zustaende, nach denen nichts mehr kommt. Gegenstueck zu
# website_finding.BROWSER_TERMINAL.
TERMINAL = ("completed", "inconclusive", "skipped", "failed")


def run(job: dict) -> None:
    global _aufgeraeumt
    business_id = job["payload"]["business_id"]
    force = bool(job["payload"].get("force"))
    biz = (
        sb()
        .table("businesses")
        .select("id, website, website_audit_browser_status")
        .eq("id", business_id)
        .single()
        .execute()
        .data
    ) or {}

    # Schon gemessen heisst gemessen. Dieselbe Absicherung wie in
    # check_website gegen eine zweite Zustellung desselben Jobs (Neustart
    # der Replik, Zeitueberschreitung in claim_job). Ohne sie wird die
    # fremde Seite ein zweites Mal geladen, und schlimmer: eine spaet
    # eintreffende alte Messung ueberschreibt eine neue, nachdem
    # website_finding seinen Satz laengst geschrieben hat. Gefunden bei der
    # Diff-Inspektion am 2026-08-30.
    if biz.get("website_audit_browser_status") in TERMINAL and not force:
        # Auch die zweite Zustellung muss den Nachtrag pruefen. Gefunden am
        # 2026-08-31 (Remodel Authority): der erste Lauf schrieb die Messung
        # und starb im Redeploy, die Rueckholung stellte den Job erneut zu,
        # dieser Schutz kehrte um, und der markierte Satz blieb ohne
        # force-Nachtrag stehen. Der Nachtrag selbst ist doppelt gesichert
        # (Marker plus offener-Job-Pruefung), ein zweites Einreihen hier ist
        # also billig, ein fehlendes dauerhaft.
        _reihe_nachtrag_ein(job, business_id)
        return

    url = (biz.get("website") or "").strip()
    if not url:
        _schreibe(business_id, {"status": "skipped", "reason": "keine Adresse hinterlegt"})
        _reihe_nachtrag_ein(job, business_id)
        return

    if not _aufgeraeumt:
        try:
            anzahl = aufraeumen()
            if anzahl:
                log.info("%s alte Screenshots geloescht", anzahl)
        except Exception as e:  # Aufraeumen darf nie einen Job kosten
            log.warning("Aufraeumen ging nicht: %s", e)
        _aufgeraeumt = True

    messung = website_browser.measure(
        url,
        pool=pool(),
        screenshot_dir=SCREENSHOT_DIR,
        # Der Schluessel ist die Lead-Kennung und nicht die Domain: zwei Leads
        # koennen dieselbe Website haben, und dann ueberschreibt der eine den
        # Beleg des anderen.
        screenshot_name=str(business_id),
    )
    _schreibe(business_id, messung.as_dict())
    log.info("browser_check %s: %s in %sms", business_id, messung.status, messung.duration_ms)
    _reihe_nachtrag_ein(job, business_id)


def _reihe_nachtrag_ein(job: dict, business_id: str) -> None:
    """Nach der Messung den Befundsatz nachziehen, falls noetig (Migration 0109).

    Zwei Faelle, beide aus dem Lauf vom 2026-08-31:

      1. website_finding_pending_rewrite: der Satz wurde vor dieser Messung
         aus dem rohen HTML geschrieben (Vier-Minuten-Deckel in
         website_finding.AUDIT_WAIT_LIMIT). Dann force, damit der
         Idempotenz-Schutz ihn nicht stehen laesst. 139 von 240 Leads waren
         an dem Tag in diesem Zustand und mussten von Hand nachgezogen
         werden.
      2. Noch KEIN Satz da: der write_website_finding-Job kann seine drei
         Versuche gegen "Website-Check laeuft noch" aufgebraucht haben,
         waehrend diese Messung in der Schlange stand. Ohne Nachtrag bekaeme
         der Lead nie einen Satz. Ohne force, und billig: existiert doch
         schon einer, endet der Job an seinem Schutz, gibt es nichts zu
         sagen, endet er ohne Modellaufruf.

    Der Nachtrag wird bewusst NACH dem Schreiben der Messung eingereiht
    (gleiche Begruendung wie in check_website._reihe_browser_ein): sonst
    kann der Nachtrag-Job laufen, bevor die Messung in der Datenbank steht,
    und wartet erneut auf sie.

    Scheitert das Einreihen, faellt dieser Job in den Queue-Retry und misst
    beim naechsten Versuch NICHT neu (TERMINAL-Schutz in run), reiht aber
    den Nachtrag erneut ein. Deshalb kein eigenes Abfangen hier.
    """
    zeile = (
        sb()
        .table("businesses")
        .select("website_finding, website_finding_pending_rewrite")
        .eq("id", business_id)
        .single()
        .execute()
        .data
    ) or {}
    nachschreiben = bool(zeile.get("website_finding_pending_rewrite"))
    fehlt = not (zeile.get("website_finding") or "").strip()
    if not (nachschreiben or fehlt):
        return
    # Ohne force nur einreihen, wenn nicht ohnehin noch ein Befund-Job auf
    # diese Firma wartet. Gemessen beim Probelauf am 2026-08-31 (Tucson, 10
    # Leads): Original- und Nachtrag-Job liefen fuer eine von fuenf Firmen
    # gleichzeitig, beide schrieben einen Satz und beide reihten die
    # Recherche ein, also 6 Recherche-Jobs fuer 5 Firmen. Mit mehreren
    # Faeden je Replik (WORKER_CONCURRENCY) wuerde dieses Rennen haeufiger.
    # Beim force-Nachtrag gilt die Pruefung nicht: der wartende Original-Job
    # endet an seinem Idempotenz-Schutz, sobald der Satz existiert, und
    # wuerde den markierten Satz nie neu schreiben.
    if fehlt and not nachschreiben and _offener_befundjob(business_id):
        return
    enqueue(
        job["workspace_id"],
        "write_website_finding",
        {"business_id": business_id, "force": nachschreiben},
    )


def _offener_befundjob(business_id: str) -> bool:
    """Wartet oder laeuft schon ein write_website_finding-Job fuer diese Firma?

    Die Abfrage holt die offenen Befund-Jobs (selten mehr als eine Handvoll)
    und prueft die Firma in Python: auf jobs.payload gibt es keinen Index,
    und ein Filter auf dem JSONB-Feld waere ein Sequential Scan je Messung.
    Bei einem Fehler wird im Zweifel eingereiht: ein doppelter Job endet am
    Idempotenz-Schutz, ein fehlender laesst den Lead ohne Satz.
    """
    try:
        rows = (
            sb()
            .table("jobs")
            .select("payload")
            .eq("type", "write_website_finding")
            .in_("status", ["pending", "running"])
            .execute()
            .data
        ) or []
    except Exception:
        return False
    return any((r.get("payload") or {}).get("business_id") == business_id for r in rows)


def _schreibe(business_id: str, messung: dict) -> None:
    """Die Messung in ihre eigene Spalte, mit Status und Zeitpunkt.

    Der Status steht zusaetzlich flach daneben, obwohl er auch im JSONB
    steckt: danach wird gefiltert, und ein Index auf einem JSONB-Feld ist
    teurer als eine Spalte.
    """
    sb().table("businesses").update(
        {
            "website_audit_browser": messung,
            "website_audit_browser_status": messung.get("status"),
            "website_audit_browser_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", business_id).execute()
