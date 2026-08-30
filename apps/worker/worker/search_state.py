"""Schutz davor, Geld fuer Leads auszugeben, die niemand mehr sehen wird.

Die Anreicherung (find_decisionmaker, personalize, hunt_persons) wird beim
Abschluss einer Suche fuer JEDE gefundene Firma eingereiht, pro Firma also
mehrere OpenAI-Aufrufe. Wandert die Suche danach in den Papierkorb, laufen
diese Jobs bisher trotzdem weiter: Kosten fuer Ergebnisse, die in keiner
Ansicht mehr auftauchen (die Lead-Listen filtern geloeschte Suchen aus).
Real gemessen: 9 wartende personalize-Jobs, alle fuer geloeschte Suchen.

Geprueft wird beim Ausfuehren, nicht beim Einreihen. Zum Einreihzeitpunkt
existiert die Suche ja noch. Ein Job fuer eine geloeschte Suche wird still
als erledigt abgehakt statt zu scheitern: es ist kein Fehler, sondern Arbeit,
die sich zwischenzeitlich erledigt hat.
"""

# Businesses laden und dabei Papierkorb-Status UND Quelle der zugehoerigen
# Suche mitnehmen; spart eine zweite Abfrage pro Job. Die Quelle braucht
# find_decisionmaker, um die Maps-Ausnahme fuer Rollen-Adressen zu erkennen.
BUSINESS_WITH_SEARCH = "*, searches(deleted_at, source)"


def _related_search(business: dict) -> dict | None:
    """PostgREST liefert eine many-to-one-Beziehung als Objekt, je nach Version/
    Abfrage aber auch als einelementige Liste. Beide Formen akzeptieren,
    damit nichts an einem Detail der Serialisierung vorbeigreift."""
    related = business.get("searches")
    if isinstance(related, list):
        related = related[0] if related else None
    return related if isinstance(related, dict) else None


def search_is_deleted(business: dict) -> bool:
    """True, wenn die Suche hinter dieser Firma im Papierkorb liegt."""
    related = _related_search(business)
    if related is None:
        return False
    return related.get("deleted_at") is not None


def search_source(business: dict) -> str | None:
    """Die Quelle der Suche hinter dieser Firma ('maps', 'apollo', ...).

    None, wenn die Beziehung fehlt. Aufrufer muessen dann die STRENGERE
    Variante waehlen: eine fehlende Angabe darf keine Ausnahme freischalten,
    die nur fuer einen bestimmten Suchweg gedacht ist.
    """
    related = _related_search(business)
    return related.get("source") if related else None


class SearchCancelled(Exception):
    """Der Nutzer hat diese Suche abgebrochen, waehrend sie lief.

    Kein Fehler, sondern eine Anweisung. main.py faengt sie ab und schliesst
    den Job als 'cancelled', nicht als 'failed', denn ein gescheiterter Job
    wird vom Queue-Retry (Migration 0047) spaeter erneut versucht, und ein
    abgebrochener Lauf, der von selbst wieder anlaeuft, waere die teuerste
    denkbare Auslegung von "Abbrechen".
    """


def search_is_cancelled(search_id: str) -> bool:
    """Fragt den aktuellen Zustand der Suche ab.

    Bewusst eine eigene Abfrage und kein Wert, der beim Start eingesammelt
    wird: der Abbruch passiert ja WAEHREND der Job laeuft. Ein zu Beginn
    gelesener Status waere immer der von vorhin.

    Die Abfrage kostet wenige Millisekunden und steht direkt vor Schritten,
    die Sekunden dauern und Credits verbrauchen; sie faellt damit nicht ins
    Gewicht. Bei einem Netzfehler wird bewusst False geliefert: im Zweifel
    weiterarbeiten ist besser, als eine bezahlte Suche wegen eines
    Verbindungsproblems abzubrechen.
    """
    from worker.db import sb  # lokal, damit Tests das Modul ohne DB laden koennen

    try:
        row = (
            sb()
            .table("searches")
            .select("status")
            .eq("id", search_id)
            .single()
            .execute()
            .data
        )
    except Exception:  # noqa: BLE001 (Begruendung siehe Docstring)
        return False
    return bool(row) and row.get("status") == "cancelled"


def raise_if_cancelled(search_id: str) -> None:
    """Prueffpunkt fuer die teuren Schleifen."""
    if search_is_cancelled(search_id):
        raise SearchCancelled(search_id)
