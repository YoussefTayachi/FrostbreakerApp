"""Pipeline 7: die zweite Beobachtung einer nicht erreichbaren Website.

Macht aus "war vorhin nicht erreichbar" entweder den Befund site_unreachable
oder gar nichts. Eingereiht wird dieser Job ausschliesslich von
pipelines/check_website.py, und zwar verzoegert (CONFIRM_DELAY_S, eine halbe
Stunde) und nur fuer die dauerhaften Fehlerarten.

WARUM ES DIESEN JOB GIBT

"Eure Seite laedt gar nicht" ist der staerkste Aufhaenger, den dieser Katalog
kennt, und der einzige, den ein einzelner Netzaussetzer erfinden kann. Alle
anderen Befunde stehen im HTML: die Jahreszahl im Fussbereich ist morgen
dieselbe, das fehlende viewport-Tag auch. Unerreichbarkeit ist dagegen eine
Aussage ueber EINEN Moment, und aus einem Moment darf keine Tatsachenbehauptung
in einer Kaltmail werden.

Belegt am 2026-08-27: von 24 Bau-Leads waren zwei nicht erreichbar
(richardwilding.net, www.leanbuild.co.uk). Der von Hand geschriebene Befund fuer
richardwilding.net war der beste im ganzen Satz. Genau diese Ausbeute holt
dieser Job, ohne dafuer zu raten.

DREI SPERREN, NICHT EINE

Ein Befund entsteht nur, wenn alle drei zugleich offen sind. Sie fangen
verschiedene Fehlalarme ab und ersetzen einander nicht:

  1. Die Fehlerart muss dauerhaft sein, in BEIDEN Beobachtungen
     (website_fetch.DURABLE_FAILURE_KINDS). Ein Zeitablauf und eine 403 sind
     keine Unerreichbarkeit: dort laeuft der Server.
  2. Zwei Beobachtungen im Abstand einer halben Stunde. Faengt den Aussetzer
     ab, der genau in den Suchlauf faellt.
  3. Die Gegenprobe auf das eigene Netz (website_fetch.own_network_is_up).
     Faengt den Fall ab, in dem nicht die Lead-Website kaputt ist, sondern
     diese Replik. Ohne sie bekaeme bei einem Resolver-Ausfall auf Railway
     eine ganze Liste denselben Befund, und zwar bei beiden Beobachtungen.

DIE FEHLERRICHTUNG IST IMMER DIESELBE

Ist etwas unklar, entsteht KEIN Befund. Der Lead bleibt dann so stehen, wie er
vor dem 2026-08-27 ohnehin gestanden haette: Status 'unreachable', leere
Befundliste, kein Satz. Ein verpasster Aufhaenger kostet nichts, ein erfundener
kostet die Antwort.

WAS ER AUSSERDEM EINSAMMELT

War der erste Fehlschlag tatsaechlich ein Aussetzer, ist die Seite jetzt da.
Dann wird sie ganz normal ausgewertet und der Lead bekommt seine echten
Befunde, statt mit einer Leerstelle stehen zu bleiben. Diese Richtung ist
stillschweigend der haeufigere Gewinn: sie repariert Leads, die vorher
niemandem aufgefallen waeren.
"""
import logging
from datetime import datetime, timezone

import httpx

from worker import website_audit, website_fetch
from worker.db import sb
from worker.pipelines.check_website import inspect_page
from worker.queue import enqueue
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted

log = logging.getLogger("worker.confirm_unreachable")


def _write(business_id: str, status: str, audit: dict | None = None) -> None:
    """Ergebnis festhalten. Wortgleich zu check_website._write.

    Bewusst nicht importiert, sondern eigenstaendig: die beiden Jobs schreiben
    dieselben drei Spalten, aber sie sind nicht dasselbe Ereignis, und
    website_audit_at soll den Zeitpunkt DIESER Beobachtung tragen.
    """
    sb().table("businesses").update(
        {
            "website_audit": audit or {},
            "website_audit_status": status,
            "website_audit_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", business_id).execute()


def _first_seen(biz: dict) -> str | None:
    """Wann der erste Fehlschlag beobachtet wurde, laut gespeichertem Befund."""
    audit = biz.get("website_audit")
    return (audit or {}).get("unreachable_first_seen_at") if isinstance(audit, dict) else None


def run(job: dict) -> None:
    ws = job["workspace_id"]
    business_id = job["payload"]["business_id"]
    biz = (
        sb()
        .table("businesses")
        .select(BUSINESS_WITH_SEARCH)
        .eq("id", business_id)
        .single()
        .execute()
        .data
    )

    # Nur bestaetigen, was noch zu bestaetigen ist. Steht der Status nicht mehr
    # auf 'unreachable', hat jemand die Firma zwischenzeitlich neu pruefen
    # lassen (force) und das Ergebnis dieser Pruefung gilt. Steht der Befund
    # schon drin, ist dieser Job ein zweites Mal zugestellt worden (Neustart
    # der Replik, Zeitueberschreitung in claim_job).
    if biz.get("website_audit_status") != "unreachable":
        return
    if website_audit.top_finding(biz.get("website_audit")):
        return
    if search_is_deleted(biz):
        return  # Liste im Papierkorb: kein Abruf fuer einen unsichtbaren Lead

    url = website_fetch.normalize_url(biz.get("website"))
    if not url:
        return

    try:
        status, audit = inspect_page(url)
    except httpx.HTTPError as exc:
        kind = website_fetch.classify_failure(exc)
        if kind == website_fetch.CERT:
            # Zwischen den beiden Beobachtungen hat sich das Bild geaendert:
            # jetzt antwortet der Server und sein Zertifikat ist kaputt. Das
            # ist ein eigener, im Browser sichtbarer Befund und keine
            # Unerreichbarkeit.
            _write(business_id, "ok", website_audit.ssl_broken(url))
            _requeue_finding(ws, business_id)
            return

        if kind not in website_fetch.DURABLE_FAILURE_KINDS:
            # Beim ersten Mal dauerhaft, jetzt ein Zeitablauf oder eine
            # Fehlerseite: die beiden Beobachtungen sagen nicht dasselbe. Das
            # reicht nicht fuer den staerksten Satz des Katalogs.
            log.info("Website %s scheitert jetzt anders (%s), kein Befund", url, kind)
            _write(business_id, "unreachable", website_audit.unreachable(url, kind=kind))
            return

        if not website_fetch.own_network_is_up():
            # Nicht die Lead-Website ist das Problem, sondern womoeglich diese
            # Replik. Der bisherige Stand bleibt unangetastet stehen, damit
            # eine spaetere Pruefung von Hand noch dieselbe Ausgangslage
            # vorfindet.
            log.warning("Gegenprobe fehlgeschlagen, kein Befund fuer %s", url)
            return

        log.info("Website %s auch beim zweiten Mal nicht erreichbar (%s)", url, kind)
        _write(
            business_id,
            "unreachable",
            website_audit.unreachable(
                url,
                kind=kind,
                first_seen_at=_first_seen(biz),
                confirmed_at=datetime.now(timezone.utc).isoformat(),
            ),
        )
        _requeue_finding(ws, business_id)
        return

    # Die Seite ist wieder da. Der erste Fehlschlag war ein Aussetzer, und der
    # Lead bekommt jetzt seine echten Befunde.
    log.info("Website %s ist wieder erreichbar, Befund neu erhoben", url)
    _write(business_id, status, audit)
    _requeue_finding(ws, business_id)


def _requeue_finding(ws: str, business_id: str) -> None:
    """Den Befundsatz nachtraeglich anstossen.

    Der write_website_finding-Job dieses Leads ist laengst gelaufen: er lief
    Minuten nach der Suche, fand eine leere Befundliste und stieg vor dem
    Modellaufruf aus (website_finding.run). Ohne diesen zweiten Job bliebe der
    frisch bestaetigte Befund also ein Eintrag in der Oberflaeche und wuerde
    nie zu dem Satz, der in die Mail geht.

    OHNE force. Der Job steigt weiterhin selbst aus, wenn inzwischen ein Satz
    dasteht; ihn zu ueberschreiben waere ein zweiter bezahlter OpenAI-Aufruf
    fuer ein Ergebnis, das schon da ist.
    """
    try:
        enqueue(ws, "write_website_finding", {"business_id": business_id})
    except Exception:
        # Der Befund selbst steht schon in der Datenbank. Scheitert nur das
        # Einreihen, darf dieser Job nicht scheitern: die Queue wuerde ihn
        # wiederholen und dabei denselben Abruf noch einmal ausfuehren.
        log.warning("Befundsatz konnte nicht eingereiht werden", exc_info=True)
