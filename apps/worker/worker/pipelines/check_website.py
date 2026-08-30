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

EINE ZWEITE BEOBACHTUNG IST TROTZDEM KEIN RETRY-STURM (2026-08-27)

Seit "eure Seite laedt gar nicht" ein Befund werden darf (site_unreachable),
reicht ein einzelner Fehlschlag nicht mehr aus: er koennte ein Netzaussetzer
sein, und daraus eine Behauptung in einer Kaltmail zu machen waere genau die
erfundene Aussage, gegen die website_audit.py geschrieben ist. Dieser Job
reiht deshalb bei einem Fehlschlag EINEN verzoegerten Job
(confirm_website_unreachable) ein.

Warum das etwas anderes ist als der Retry-Sturm oben, in drei Punkten:

  1. EINMAL, nicht bis max_attempts. Der Job scheitert weiterhin nicht, die
     Queue wiederholt ihn also nicht. Es gibt genau eine zweite Beobachtung.
  2. SPAETER, nicht sofort. CONFIRM_DELAY_S liegt eine halbe Stunde in der
     Zukunft, der Suchlauf ist bis dahin durch. Ein Retry haette dagegen
     mitten in der Abarbeitung von 300 Firmen erneut zugeschlagen.
  3. NUR FUER DIE SCHNELLEN FEHLERARTEN. Das ist der Punkt, an dem die
     urspruengliche Sorge haengt: sie handelt von 20 Sekunden Zeitablauf je
     Versuch. Genau 'timeout' bekommt keine zweite Beobachtung. Die
     dauerhaften Arten scheitern gemessen in unter fuenf Sekunden (die Zahlen
     stehen in website_fetch.py), sie koennen eine Replik nicht blockieren.

Bei 24 Bau-Leads vom 2026-08-27 waren zwei Domains betroffen. Der Aufschlag
sind also zwei schnelle Abrufe eine halbe Stunde spaeter, nicht 300.
"""
import logging
from datetime import datetime, timezone

import httpx

from worker import website_audit, website_fetch
from worker.db import sb
from worker.queue import enqueue
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted

log = logging.getLogger("worker.check_website")

# Wie lange zwischen den beiden Beobachtungen liegt.
#
# GESETZTE GRENZE, KEIN MESSWERT, und ein Abwaegen zwischen zwei Fehlern:
#
#   Zu kurz  Ein Aussetzer, der beide Abrufe trifft, wird zum Befund. Sekunden
#            oder Minuten reichen dafuer nicht aus, eine halbe Stunde schon.
#   Zu lang  Der Befund kommt zu spaet. Die Lead-Liste ist Minuten nach der
#            Suche fertig, und wer dann seine Kampagne baut, hat den Lead
#            ohne Befundsatz schon zurueckgehalten
#            (apps/web/lib/instantly/create-campaign.ts). Ein Befund vom
#            naechsten Tag waere fuer diese Kampagne wertlos.
#
# Eine halbe Stunde ist die kuerzeste Spanne, die zwei wirklich unabhaengige
# Beobachtungen ergibt und den Befund noch in derselben Arbeitssitzung
# liefert. Der Rest der Absicherung liegt nicht in der Zeit, sondern in der
# Fehlerart (nur dauerhafte zaehlen) und in der Gegenprobe auf das eigene Netz
# (website_fetch.own_network_is_up).
CONFIRM_DELAY_S = 1800

# Nur diese Inhaltstypen werden ausgewertet. Hinter einer hinterlegten
# "Website" steckt gelegentlich ein PDF oder eine JSON-Antwort; die durch die
# HTML-Pruefungen zu schicken, ergaebe eine Liste von Befunden, die alle nur
# heissen "das ist kein HTML".
_HTML_CONTENT_TYPES = ("text/html", "application/xhtml")


def _reihe_browser_ein(job: dict, business_id: str, url: str | None) -> bool:
    """Die zweite Stufe einreihen, die dieselbe Seite im Browser misst.

    AUCH NACH EINEM FEHLSCHLAG DIESER STUFE. Das ist kein Versehen:
    gemessen am 2026-08-30 an 38 echten Leads waren 3 Seiten per rohem
    HTTP nicht abrufbar und im Browser problemlos erreichbar. Wuerde der
    Browser nur nach einem gelungenen Abruf laufen, blieben genau die
    Faelle aus, in denen er den teuersten Satz des Katalogs verhindert:
    "eure Seite laedt gar nicht" ueber eine Seite, die laedt.

    Ohne pruefbare Adresse wird nichts eingereiht und browser_audit_required
    bleibt false, sonst wartet website_finding auf eine Stufe, die nie
    kommt.

    GESCHRIEBEN WIRD ZUERST, DANN EINGEREIHT. Umgekehrt entsteht ein Rennen,
    und es ist kein theoretisches: der Worker kann den Browser-Job aufnehmen
    und beenden, bevor dieser Job seinen eigenen Schreibvorgang absetzt.
    Dann traegt _write hinterher wieder 'pending' ein, obwohl die Messung
    laengst 'completed' war, und website_finding wartet bis zum
    Vier-Minuten-Deckel auf eine Stufe, die schon fertig ist. Gefunden bei
    der Diff-Inspektion durch ein zweites Modell am 2026-08-30.

    Der Preis ist ein zweiter Schreibvorgang im Fehlerfall: laesst sich der
    Job nicht einreihen, muss die Markierung wieder weg, sonst wartet
    website_finding auf etwas, das nie kommt. Im Normalfall bleibt es bei
    einem.
    """
    if not url:
        return False
    try:
        enqueue(job["workspace_id"], "browser_check", {"business_id": business_id})
        return True
    except Exception:
        log.warning("browser_check konnte nicht eingereiht werden", exc_info=True)
        try:
            sb().table("businesses").update(
                {"browser_audit_required": False, "website_audit_browser_status": None}
            ).eq("id", business_id).execute()
        except Exception:
            log.warning("Ruecknahme der Browser-Markierung ging nicht", exc_info=True)
        return False


def _write(business_id: str, status: str, audit: dict | None = None,
           browser_folgt: bool = False) -> None:
    """Ergebnis festhalten. Ein Job, ein Schreibvorgang.

    `browser_folgt` markiert, dass die zweite Stufe eingereiht ist und
    website_finding auf sie warten soll (Migration 0107).
    """
    daten = {
        "website_audit": audit or {},
        "website_audit_status": status,
        "website_audit_at": datetime.now(timezone.utc).isoformat(),
    }
    if browser_folgt:
        daten["browser_audit_required"] = True
        daten["website_audit_browser_status"] = "pending"
    sb().table("businesses").update(daten).eq("id", business_id).execute()


def inspect_page(url: str) -> tuple[str, dict | None]:
    """Ein Abruf und seine Auswertung, ohne Datenbank.

    Liefert ("ok", Befund) oder ("skipped", None), wenn die Antwort kein HTML
    ist. httpx.HTTPError geht unveraendert an den Aufrufer weiter: was ein
    Fehlschlag bedeutet, entscheiden die beiden Aufrufer verschieden (hier die
    erste Beobachtung, in pipelines/confirm_unreachable.py die zweite).

    Ausgelagert, damit es genau EINE Fassung dieses Abrufs gibt. Eine zweite
    Kopie im Bestaetigungsjob wuerde sich einer fremden Website gegenueber
    frueher oder spaeter anders verhalten als diese, ohne dass es jemandem
    auffiele.
    """
    page = website_fetch.fetch_page(url)
    if not any(t in page.content_type for t in _HTML_CONTENT_TYPES):
        log.info("Website %s liefert %s, kein HTML", url, page.content_type or "?")
        return "skipped", None

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
    return "ok", audit


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
        status, audit = inspect_page(url)
    except httpx.HTTPError as exc:
        kind = website_fetch.classify_failure(exc)
        if kind == website_fetch.CERT:
            # Ein kaputtes Zertifikat darf nicht als "unerreichbar"
            # verschwinden: der Besucher kommt zwar genauso wenig auf die
            # Seite, aber er sieht dabei eine Warnung mit dem Namen der Firma
            # darin, und das ist ein anderer, nachpruefbarer Befund.
            _write(business_id, "ok", website_audit.ssl_broken(url), bool(url))
            _reihe_browser_ein(job, business_id, url)
            return

        log.info("Website %s nicht erreichbar (%s): %s", url, kind, exc)
        now = datetime.now(timezone.utc).isoformat()
        _write(
            business_id,
            "unreachable",
            website_audit.unreachable(url, kind=kind, first_seen_at=now),
            bool(url),
        )
        # Der Browser bekommt seine Chance trotzdem, und GERADE HIER: die
        # 3 von 38 Leads, die nur er erreicht, liegen genau in diesem Zweig.
        _reihe_browser_ein(job, business_id, url)
        # Noch KEIN Befund, nur die erste Beobachtung. Ob daraus einer wird,
        # entscheidet der verzoegerte Job (siehe Modul-Docstring). Fuer die
        # nicht dauerhaften Fehlerarten wird er gar nicht erst eingereiht:
        # 'timeout' ist die einzige langsame und zugleich die einzige, die
        # regelmaessig an uns statt an der fremden Seite liegt.
        if kind not in website_fetch.DURABLE_FAILURE_KINDS:
            return
        try:
            enqueue(
                job["workspace_id"],
                "confirm_website_unreachable",
                {"business_id": business_id},
                delay_s=CONFIRM_DELAY_S,
            )
        except Exception:
            # Das Ergebnis dieses Jobs steht schon in der Datenbank, er ist
            # fertig. Faellt das Einreihen aus (der Jobtyp fehlt in der
            # CHECK-Constraint, weil Migration 0106 noch nicht angewandt ist),
            # darf er daran nicht scheitern: die Queue wuerde ihn sonst
            # wiederholen und dabei genau den Abruf erneut ausfuehren, dessen
            # Wiederholung der Kommentar oben verhindert.
            log.warning("Bestaetigungsjob konnte nicht eingereiht werden", exc_info=True)
        return

    _write(business_id, status, audit, bool(url))
    _reihe_browser_ein(job, business_id, url)
