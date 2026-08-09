"""Bereits bei Apollo bezahlte Daten wiederverwenden statt neu zu kaufen.

Apollo berechnet dieselbe Person erneut, wenn man sie ein zweites Mal ueber
die API anreichert -- das steht so in ihrer Doku und ist am 2026-08-09 an
echten Daten sichtbar geworden: 1106 Apollo-Kontakte, 1050 eindeutige
Adressen, also 56 doppelt bezahlte Credits.

Der Cache haengt am API-SCHLUESSEL, nicht am Workspace: Credits werden vom
Apollo-Konto abgezogen, und eine Agentur mit einem Vertrag und fuenf
Kunden-Workspaces zahlt sonst fuenfmal fuer dieselbe Person. Gespeichert wird
nur der Fingerabdruck des Schluessels (siehe Migration 0087).

WAS DIESES MODUL BEWUSST NICHT TUT

Es entscheidet nicht, ob ein Lead ausgeliefert wird -- es entscheidet nur,
woher der Datensatz kommt. Ein Treffer im Cache heisst "gratis", nicht
"ueberspringen". Das ist der Unterschied zwischen "Credits gespart" und "Lead
verloren", und er ist der ganze Grund, warum hier eine Tabelle steht und
nicht bloss eine Sperrliste von IDs.
"""
import hashlib
import logging
from datetime import datetime, timedelta, timezone

from worker.db import sb

log = logging.getLogger(__name__)

# Ab wann ein zwischengespeicherter Datensatz neu geholt wird.
#
# Ein Cache ohne Ablauf liefert irgendwann Adressen von Menschen, die die
# Firma laengst verlassen haben -- gratis, aber wertlos, und der Bounce
# beschaedigt die Absender-Reputation. Ein halbes Jahr ist der Kompromiss:
# lang genug, dass wiederkehrende Suchen und Lead-Abos wirklich nichts mehr
# kosten, kurz genug, dass eine Adresse nicht ueber einen Jobwechsel hinaus
# als gueltig ausgegeben wird.
MAX_AGE_DAYS = 180


def fingerprint(api_key: str) -> str:
    """Schluessel-Fingerabdruck. Nie der Schluessel selbst -- die Tabelle soll
    auch dann nichts hergeben, wenn jemand sie zu Gesicht bekommt."""
    return hashlib.sha256(api_key.encode()).hexdigest()


def _fresh_enough(fetched_at: str | None) -> bool:
    if not fetched_at:
        return False
    try:
        stamp = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return stamp > datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)


def get_many(api_key: str, kind: str, external_ids: list[str]) -> dict[str, dict]:
    """Was von diesen IDs schon bezahlt und noch frisch genug ist.

    Ein Fehler beim Lesen ist ausdruecklich kein Grund, den Lauf abzubrechen:
    dann wird eben bezahlt, was ohnehin bezahlt worden waere. Der Cache darf
    Kosten senken, aber niemals eine Suche verhindern.
    """
    if not external_ids:
        return {}
    found: dict[str, dict] = {}
    fp = fingerprint(api_key)
    # In Paketen abfragen: eine in-Liste mit tausenden Werten sprengt die URL.
    for i in range(0, len(external_ids), 200):
        chunk = external_ids[i : i + 200]
        try:
            rows = (
                sb()
                .table("apollo_cache")
                .select("external_id, payload, fetched_at")
                .eq("key_fingerprint", fp)
                .eq("kind", kind)
                .in_("external_id", chunk)
                .execute()
                .data
                or []
            )
        except Exception:  # noqa: BLE001 -- Begruendung siehe Docstring
            log.warning("Apollo-Cache nicht lesbar, es wird regulaer angereichert", exc_info=True)
            return found
        for row in rows:
            if _fresh_enough(row.get("fetched_at")):
                found[row["external_id"]] = row["payload"]
    return found


def put_many(api_key: str, kind: str, items: dict[str, dict]) -> None:
    """Frisch bezahlte Datensaetze ablegen.

    upsert mit fetched_at=jetzt: eine erneut geholte Person ist wieder frisch,
    und ihr alter Eintrag darf nicht die neue Alterung bestimmen.

    Scheitert das Schreiben, ist nur der Cache leer -- die Suche selbst hat
    ihre Daten. Deshalb wird der Fehler notiert und nicht geworfen.
    """
    if not items:
        return
    now = datetime.now(timezone.utc).isoformat()
    fp = fingerprint(api_key)
    rows = [
        {
            "key_fingerprint": fp,
            "kind": kind,
            "external_id": external_id,
            "payload": payload,
            "fetched_at": now,
        }
        for external_id, payload in items.items()
    ]
    for i in range(0, len(rows), 200):
        try:
            sb().table("apollo_cache").upsert(
                rows[i : i + 200], on_conflict="key_fingerprint,kind,external_id"
            ).execute()
        except Exception:  # noqa: BLE001 -- Begruendung siehe Docstring
            log.warning("Apollo-Cache nicht beschreibbar", exc_info=True)
            return
