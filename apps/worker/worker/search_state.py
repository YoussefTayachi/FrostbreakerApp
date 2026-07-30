"""Schutz davor, Geld fuer Leads auszugeben, die niemand mehr sehen wird.

Die Anreicherung (find_decisionmaker, personalize, hunt_persons) wird beim
Abschluss einer Suche fuer JEDE gefundene Firma eingereiht -- pro Firma also
mehrere OpenAI-Aufrufe. Wandert die Suche danach in den Papierkorb, laufen
diese Jobs bisher trotzdem weiter: Kosten fuer Ergebnisse, die in keiner
Ansicht mehr auftauchen (die Lead-Listen filtern geloeschte Suchen aus).
Real gemessen: 9 wartende personalize-Jobs, alle fuer geloeschte Suchen.

Geprueft wird beim Ausfuehren, nicht beim Einreihen -- zum Einreihzeitpunkt
existiert die Suche ja noch. Ein Job fuer eine geloeschte Suche wird still
als erledigt abgehakt statt zu scheitern: es ist kein Fehler, sondern Arbeit,
die sich zwischenzeitlich erledigt hat.
"""

# Businesses laden und dabei den Papierkorb-Status der zugehoerigen Suche
# mitnehmen -- spart eine zweite Abfrage pro Job.
BUSINESS_WITH_SEARCH = "*, searches(deleted_at)"


def search_is_deleted(business: dict) -> bool:
    """True, wenn die Suche hinter dieser Firma im Papierkorb liegt.

    PostgREST liefert eine many-to-one-Beziehung als Objekt, je nach Version/
    Abfrage aber auch als einelementige Liste -- beide Formen werden
    akzeptiert, damit die Kostenbremse nicht an einem Detail der
    Serialisierung vorbeigreift.
    """
    related = business.get("searches")
    if isinstance(related, list):
        related = related[0] if related else None
    if not isinstance(related, dict):
        return False
    return related.get("deleted_at") is not None
