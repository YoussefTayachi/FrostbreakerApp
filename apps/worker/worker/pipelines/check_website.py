"""Pipeline 5: Website-Check.

Holt die Website eines Leads und schreibt die harten Maengel nach
businesses.website_audit (Migration 0102). Kein Modellaufruf, kein
Fremd-Guthaben: der Job kostet hoechstens zwei HTTP-Abrufe (siehe
worker/website_fetch.py). Der Katalog und die gesamte Auswertung stehen in
worker/website_audit.py, das Netz in worker/website_fetch.py; hier steht nur
die Verdrahtung mit Queue und Datenbank.

KEIN RETRY-STURM

Eine nicht erreichbare Website ist ein ERGEBNIS und kein Fehler. Der Job
schreibt dann Status 'unreachable' und gilt als erledigt. Wuerde er stattdessen
scheitern, wuerde die Queue ihn mit Backoff bis zu max_attempts erneut
versuchen (queue.fail_job) und bei jedem Lauf denselben Zeitablauf von 20
Sekunden abwarten. Bei einer Suche mit 300 Firmen, von denen ein Teil tote
Domains hat, blockiert das eine Worker-Replik minutenlang fuer eine Antwort,
die sich nicht aendert.

Fehler schlagen deshalb nur dort durch, wo ein zweiter Versuch tatsaechlich
etwas aendern kann: beim Schreiben in die Datenbank.
"""
import logging
from datetime import datetime, timezone

import httpx

from worker import website_audit, website_fetch
from worker.db import sb
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted

log = logging.getLogger("worker.check_website")

# Nur diese Inhaltstypen werden ausgewertet. Hinter einer hinterlegten
# "Website" steckt gelegentlich ein PDF oder eine JSON-Antwort; die durch die
# HTML-Pruefungen zu schicken, ergaebe eine Liste von Befunden, die alle nur
# heissen "das ist kein HTML".
_HTML_CONTENT_TYPES = ("text/html", "application/xhtml")


def _write(business_id: str, status: str, audit: dict | None = None) -> None:
    """Ergebnis festhalten. Ein Job, ein Schreibvorgang."""
    sb().table("businesses").update(
        {
            "website_audit": audit or {},
            "website_audit_status": status,
            "website_audit_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", business_id).execute()


def run(job: dict) -> None:
    business_id = job["payload"]["business_id"]
    force = bool(job["payload"].get("force"))
    biz = (
        sb()
        .table("businesses")
        .select(BUSINESS_WITH_SEARCH)
        .eq("id", business_id)
        .single()
        .execute()
        .data
    )

    # Schon geprueft heisst geprueft. Dieselbe Absicherung wie in personalize
    # gegen eine zweite Zustellung desselben Jobs (Neustart der Replik,
    # Zeitueberschreitung in claim_job). Hier geht es nicht um Geld, sondern
    # um die fremde Website: sie soll nicht zweimal fuer dasselbe Ergebnis
    # abgerufen werden.
    if biz.get("website_audit_status") in ("ok", "unreachable", "skipped") and not force:
        return

    if search_is_deleted(biz):
        # Liste im Papierkorb. Kein Abruf mehr, aber trotzdem einen Endstatus
        # setzen: bliebe 'pending' stehen, wuerde write_website_finding fuer diese
        # Firma bis zum Zeitdeckel warten (siehe website_finding.audit_pending).
        _write(business_id, "skipped")
        return

    url = website_fetch.normalize_url(biz.get("website"))
    if not url:
        _write(business_id, "skipped")
        return

    try:
        page = website_fetch.fetch_page(url)
    except httpx.HTTPError as exc:
        if website_fetch.is_ssl_error(exc):
            # Ein kaputtes Zertifikat ist der staerkste Befund des Katalogs
            # und darf nicht als "unerreichbar" verschwinden: der Besucher
            # kommt genauso wenig auf die Seite, nur sieht er dabei eine
            # Warnung mit dem Namen der Firma darin.
            _write(business_id, "ok", website_audit.ssl_broken(url))
            return
        log.info("Website %s nicht erreichbar: %s", url, exc)
        _write(business_id, "unreachable", website_audit.unreachable(url))
        return

    if not any(t in page.content_type for t in _HTML_CONTENT_TYPES):
        log.info("Website %s liefert %s, kein HTML", url, page.content_type or "?")
        _write(business_id, "skipped")
        return

    # Die zweite (und letzte) Anfrage, und nur wenn sie etwas beantworten
    # kann: Lief der Hauptabruf ohnehin ueber http, steht das Ergebnis schon
    # fest und die Probe waere verschwendet.
    redirects = None
    if page.final_url.lower().startswith("https://"):
        redirects = website_fetch.redirects_to_https(page.final_url)

    audit = website_audit.analyze(
        page.html,
        checked_url=url,
        final_url=page.final_url,
        page_bytes=page.page_bytes,
        http_redirects_to_https=redirects,
    )
    # 'ok' heisst GEPRUEFT, nicht "alles gut": die Befunde stehen in
    # website_audit.findings, und die Liste darf voll sein.
    _write(business_id, "ok", audit)
