import logging
import time
from functools import lru_cache

import httpx
from supabase import Client, create_client

from worker.config import get_settings

log = logging.getLogger("worker.db")

# Wie oft ein abgerissener LESEZUGRIFF wiederholt wird, bevor der Fehler
# durchschlaegt. Drei Versuche mit kurzem Abstand, weil ein Verbindungsabriss
# beim naechsten Anlauf so gut wie immer weg ist -- er liegt an der einen
# kaputten Verbindung, nicht am Server.
LESE_VERSUCHE = 3


class _AbrissfesterTransport(httpx.HTTPTransport):
    """HTTP-Schicht unter PostgREST, mit zwei Aenderungen gegen Verbindungsabrisse.

    ═══════════════════════════════════════════════════════════════════════
    GEMESSEN AM 2026-09-10, 15:05 UTC
    ═══════════════════════════════════════════════════════════════════════
    Vierzehn Jobs quer durch sechs Typen sind binnen Sekunden mit
    "Server disconnected" gescheitert. Der Satz stammt woertlich aus
    httpcore/_sync/http2.py: die HTTP/2-Verbindung wurde geschlossen,
    waehrend Anfragen darauf liefen. Die Edge-Logs derselben Minute zeigen
    ausschliesslich 200, 201 und 204 -- der Server hat nichts abgelehnt und
    von den abgerissenen Anfragen nie eine Antwort geschickt.

    ZWEI FOLGERUNGEN, BEIDE HIER UMGESETZT:

    1. KEIN HTTP/2. postgrest-py legt seinen Client mit http2=True an (siehe
       postgrest/_sync/client.py). Ueber HTTP/2 laeuft der gesamte Verkehr
       eines Prozesses durch EINE Verbindung, und db.sb() ist per lru_cache
       genau eine Instanz fuer alle Arbeitsfaeden. Ein Abriss trifft damit
       nicht eine Anfrage, sondern alles, was gerade unterwegs ist -- exakt
       das gemessene Bild. Ueber HTTP/1.1 hat jede gleichzeitige Anfrage
       ihre eigene Verbindung aus dem Pool; ein Abriss kostet dann eine
       Anfrage. Der Preis sind ein paar Sockets mehr, bei vier Faeden je
       Replik belanglos.

    2. WIEDERHOLEN, ABER NUR LESEND. Ein Abriss beim Lesen der Antwort sagt
       NICHT, ob der Server die Anfrage schon ausgefuehrt hat. Ein
       wiederholtes GET ist trotzdem harmlos. Ein wiederholtes POST waere es
       nicht: es koennte denselben Job ein zweites Mal einreihen und damit
       fremde API-Credits ein zweites Mal ausgeben. Schreibzugriffe laufen
       deshalb weiter in den Fehler und in den Queue-Retry, der genau dafuer
       da ist.

    Verbindungsfehler VOR dem Absenden sind ein anderer Fall: da ist nichts
    passiert, und die Wiederholung ist fuer jede Methode sicher. Die
    uebernimmt httpx selbst ueber `retries` (siehe _neuer_transport).
    """

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        versuch = 0
        while True:
            try:
                return super().handle_request(request)
            except (httpx.RemoteProtocolError, httpx.ReadError) as exc:
                versuch += 1
                if request.method not in ("GET", "HEAD") or versuch >= LESE_VERSUCHE:
                    raise
                log.warning(
                    "Verbindung zu PostgREST abgerissen (%s), Versuch %s von %s",
                    exc,
                    versuch + 1,
                    LESE_VERSUCHE,
                )
                time.sleep(0.25 * versuch)


def _neuer_transport() -> _AbrissfesterTransport:
    # retries greift nur beim Verbindungsaufbau, also bevor irgendetwas
    # gesendet wurde. Fuer schreibende Anfragen ist das die einzige
    # Wiederholung, die ohne Risiko einer Doppelausfuehrung moeglich ist.
    return _AbrissfesterTransport(retries=2)


@lru_cache
def sb() -> Client:
    s = get_settings()
    client = create_client(s.supabase_url, s.supabase_service_role_key)
    # Die HTTP-Schicht wird nachtraeglich getauscht statt ueber
    # ClientOptions(httpx_client=...) mitgegeben: dieser Parameter reicht
    # denselben Client an PostgREST, Auth UND Storage weiter, die drei
    # verschiedene base_url brauchen. Der Tausch trifft nur PostgREST, und
    # dort laeuft der gesamte Verkehr dieses Workers (Tabellen und rpc).
    #
    # httpx._transport ist privat. Deshalb der Schutz drumherum: geht der
    # Tausch nach einem Abhaengigkeits-Update nicht mehr, laeuft der Worker
    # unveraendert weiter wie vor dieser Aenderung, nur ohne die
    # Wiederholungen -- und die Zeile im Protokoll sagt, warum.
    try:
        client.postgrest.session._transport = _neuer_transport()
    except Exception:
        log.warning(
            "HTTP-Schicht fuer PostgREST konnte nicht getauscht werden; "
            "Verbindungsabrisse werden nicht wiederholt",
            exc_info=True,
        )
    return client
