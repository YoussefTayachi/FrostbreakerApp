"""Ein Seitenabruf, zwei Verwerter.

Die Website eines Leads wird an zwei Stellen geholt: personalize braucht den
LESBAREN TEXT (trafilatura), der Website-Check das ROHE HTML (Meta-Tags,
eingebundene Ressourcen, Fussbereich). trafilatura wirft genau das weg, was
der Check sehen muss, deshalb liefert dieses Modul das Dokument unveraendert
und ueberlaesst jedem Aufrufer seine eigene Auswertung.

Zusammengelegt, damit User-Agent, Zeitlimit und Weiterleitungsverhalten an
EINER Stelle stehen. Vorher war das der Rumpf von personalize.fetch_website_text;
eine zweite Kopie fuer den Check haette zwei Abrufe erzeugt, die sich einer
fremden Website gegenueber unterschiedlich verhalten, ohne dass es jemandem
auffaellt.

WIE VIELE ABRUFE EIN LEAD KOSTET

Der Check macht hoechstens ZWEI Anfragen pro Lead:

  1. fetch_page() auf die hinterlegte Website (Weiterleitungen folgt httpx
     selbst, das bleibt eine Anfrage aus unserer Sicht).
  2. redirects_to_https() auf die http-Variante, und das auch nur, wenn die
     hinterlegte Adresse bereits https ist. Ohne diese zweite Anfrage laesst
     sich "http leitet nicht auf https um" nicht feststellen: die erste
     Anfrage geht ja gar nicht ueber http.

Beide kosten kein Fremd-Guthaben. Es ist der billigste Job der Queue.
"""
import errno
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse

import httpx

# Ein URL-Schema am Anfang, nach RFC 3986: Buchstabe, danach Buchstaben,
# Ziffern, Plus, Minus, Punkt, dann der Doppelpunkt.
_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:")

# Unveraendert aus personalize uebernommen. Ein ehrlicher Bot-Name im
# Mozilla-Mantel: manche Server antworten auf einen nackten Bibliotheks-UA
# mit 403.
USER_AGENT = "Mozilla/5.0 (compatible; ThawBot/1.0)"

FETCH_TIMEOUT_S = 20

# Die http-Probe liest nur den Statuscode und den Location-Header, kein
# Dokument. Ein kuerzeres Limit als beim Hauptabruf, weil ein Server, der auf
# Port 80 nicht binnen 10 Sekunden antwortet, fuer diese eine Ja/Nein-Frage
# nicht laenger blockieren soll.
PROBE_TIMEOUT_S = 10


@dataclass(frozen=True)
class FetchedPage:
    requested_url: str
    final_url: str
    html: str
    # Groesse des HTML-Dokuments NACH dem Auspacken (httpx entpackt gzip
    # selbst), nicht die uebertragenen Bytes. Und ausdruecklich nicht die
    # Groesse der Seite: Bilder, Skripte und Schriften sind hier nicht drin.
    page_bytes: int
    content_type: str


def normalize_url(raw: str | None) -> str | None:
    """Die hinterlegte Adresse in etwas Abrufbares verwandeln, oder None.

    In businesses.website steht, was Google Maps / Apollo / Hunter geliefert
    haben. Das ist meistens eine vollstaendige URL, manchmal aber nur
    "beispiel.de". Alles, was kein http(s) ist (mailto:, tel:, ftp:), wird
    verworfen statt abgerufen.

    Das Schema wird ueber den Doppelpunkt erkannt und nicht ueber "://":
    "mailto:info@beispiel.de" hat keine zwei Schraegstriche, und mit der
    einfachen Pruefung waere daraus "https://mailto:info@beispiel.de"
    geworden, also ein Abruf gegen einen Host namens "mailto".
    """
    url = (raw or "").strip()
    if not url:
        return None
    if not _SCHEME_RE.match(url):
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return url


def http_variant(url: str) -> str:
    """Dieselbe Adresse ueber http statt https."""
    parsed = urlparse(url)
    return urlunparse(parsed._replace(scheme="http"))


def fetch_page(url: str, timeout: float = FETCH_TIMEOUT_S) -> FetchedPage:
    """Holt das Dokument. Wirft httpx.HTTPError bei allem, was schiefgeht.

    raise_for_status() bleibt drin (und nicht raise_for_status_safe aus
    http_safety): in dieser URL steht kein API-Schluessel, es ist die
    oeffentliche Website eines Leads.
    """
    r = httpx.get(
        url,
        timeout=timeout,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )
    r.raise_for_status()
    return FetchedPage(
        requested_url=url,
        final_url=str(r.url),
        html=r.text,
        page_bytes=len(r.content),
        content_type=(r.headers.get("content-type") or "").lower(),
    )


def redirects_to_https(url: str, timeout: float = PROBE_TIMEOUT_S) -> bool | None:
    """Leitet die http-Variante dieser Adresse auf https um?

    True/False = beantwortet. None = nicht beantwortbar, und das ist der
    wichtige Fall: viele kleine Seiten lauschen ueberhaupt nicht auf Port 80.
    Dass die http-Adresse nicht erreichbar ist, ist KEIN Mangel (die Seite ist
    dann schlicht nur ueber https zu haben). Ein None fuehrt deshalb zu keinem
    Befund, siehe website_audit.analyze.

    follow_redirects=False mit Absicht: gefragt ist die eine Weiterleitung,
    nicht das Ziel dahinter. Der Kette zu folgen waeren weitere Anfragen fuer
    eine Antwort, die schon im ersten Location-Header steht.

    Dass diese zweite Anfrage ihren Platz verdient, ist gemessen (2026-08-23):

        redirects_to_https("https://www.jimdo.com/")  -> True
        redirects_to_https("https://example.com/")    -> False

    Beide Seiten sind ueber https erreichbar, der Hauptabruf sieht also bei
    beiden dasselbe. Erst die Probe trennt sie: example.com beantwortet
    http mit einer normalen Seite statt einer Weiterleitung, und genau das
    ist der Mangel, den no_https meint.
    """
    try:
        r = httpx.get(
            http_variant(url),
            timeout=timeout,
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
        )
    except httpx.HTTPError:
        return None
    if r.status_code not in (301, 302, 303, 307, 308):
        # Antwortet der Server auf http mit einer normalen Seite (200), ist es
        # keine Weiterleitung. Genau das ist der Mangel.
        return False
    location = r.headers.get("location") or ""
    if location.startswith("//"):
        # Schema-relative Weiterleitung: der Browser behaelt http bei.
        return False
    if location.startswith("/"):
        # Weiterleitung auf denselben Host, also weiterhin http.
        return False
    return location.lower().startswith("https://")


# ═══════════════════════════════════════════════════════════════════════════
# WARUM EIN ABRUF GESCHEITERT IST
# ═══════════════════════════════════════════════════════════════════════════
#
# "Nicht erreichbar" ist keine einheitliche Sache, und der Unterschied
# entscheidet darueber, ob daraus eine Aussage in einer Kaltmail werden darf.
# Deshalb wird die Ausnahme in eine von sieben Arten uebersetzt statt in ein
# Ja/Nein.
#
# GEMESSEN AM 2026-08-27 mit fetch_page gegen echte Adressen, jeweils die
# Ursachenkette und die verbrauchte Zeit:
#
#     https://www.leanbuild.co.uk    0,25s  socket.gaierror                 -> dns
#     https://richardwilding.net     0,31s  ssl.SSLEOFError                 -> tls
#     https://tls-v1-0.badssl.com    0,57s  ssl.SSLError UNSUPPORTED_PROTO  -> tls
#     https://expired.badssl.com     0,55s  ssl.SSLCertVerificationError    -> cert
#     https://untrusted-root.bad..   0,56s  ssl.SSLCertVerificationError    -> cert
#     Port ohne Dienst               4,34s  ConnectionRefusedError          -> refused
#
# ZWEI DINGE STEHEN IN DIESEN ZAHLEN, und beide tragen den Rest dieser Datei:
#
#   1. richardwilding.net ist KEIN Zertifikatsfall. Bis zum 2026-08-27 hat
#      is_ssl_error jede ssl.SSLError als "Zertifikat abgelaufen oder
#      ungueltig" gewertet, und genau diese Seite faellt mit SSLEOFError um:
#      der Server bricht den TLS-Handschlag ab, ein Zertifikat bekommt der
#      Browser dabei nie zu sehen. Die Mail haette dem Inhaber ein kaputtes
#      Zertifikat vorgehalten, das es gar nicht gibt, also genau die erfundene
#      Behauptung, gegen die website_audit.py geschrieben ist. Deshalb ist nur
#      SSLCertVerificationError 'cert', alles andere aus dem TLS-Bereich 'tls'.
#
#   2. Jede dauerhafte Fehlerart scheitert in UNTER FUENF SEKUNDEN. Das
#      Zeitlimit von 20 Sekunden greift ausschliesslich bei 'timeout'. Deshalb
#      kann eine zweite Beobachtung fuer die dauerhaften Arten keine Replik
#      blockieren, und deshalb bekommt ausgerechnet 'timeout' keine (siehe den
#      Kommentar zur Bestaetigung in pipelines/check_website.py).
#
# Die Arten:
#
#   cert     Zertifikat abgelaufen, ungueltig oder passt nicht zum Hostnamen.
#            Der Server LEBT, der Browser zeigt eine Warnseite davor. Das ist
#            der Befund ssl_broken und keine Unerreichbarkeit.
#   dns      Der Name loest nicht auf. Dauerhaft, bis jemand den DNS-Eintrag
#            anfasst.
#   refused  Der Name loest auf, aber auf dem Port lauscht nichts. Dauerhaft,
#            bis jemand einen Server startet.
#   tls      Der TLS-Handschlag scheitert (Abbruch, veraltete Protokollfassung).
#            Dauerhaft, weil es an der Serverkonfiguration haengt.
#   timeout  Niemand antwortet rechtzeitig. KANN voruebergehend sein: eine
#            ueberlastete Seite, eine Stoerung unterwegs, oder ein Server, der
#            unseren Bot stillschweigend haengen laesst.
#   http     Der Server antwortet, nur mit 4xx oder 5xx. Er LAEUFT. "Eure Seite
#            laedt gar nicht" waere hier schlicht falsch.
#   other    Alles Uebrige. Im Zweifel kein Befund.
CERT = "cert"
DNS = "dns"
REFUSED = "refused"
TLS = "tls"
TIMEOUT = "timeout"
HTTP = "http"
OTHER = "other"

# Welche Arten dauerhaft genug sind, dass aus ihnen ueberhaupt der Befund
# site_unreachable werden darf (und auch dann erst nach einer zweiten,
# spaeteren Beobachtung, siehe pipelines/confirm_unreachable.py).
#
# timeout, http und other fehlen mit Absicht. Alle drei haben eine harmlose
# Lesart: eine langsame Seite, ein Bot-Filter, der 403 liefert, eine
# Wartungsseite mit 503. Wer daraus "eure Website laedt nicht" macht, schreibt
# dem Empfaenger etwas ueber seine Seite, das der in seinem eigenen Browser
# widerlegen kann.
DURABLE_FAILURE_KINDS = (DNS, REFUSED, TLS)

# Fehlernummern, die "der Host existiert, aber da nimmt niemand ab" heissen.
# ECONNREFUSED deckt den Normalfall ab; die beiden Routing-Fehler stehen
# daneben, weil sie dasselbe bedeuten und genauso schnell zurueckkommen.
_REFUSED_ERRNOS = {errno.ECONNREFUSED, errno.EHOSTUNREACH, errno.ENETUNREACH}


def _causes(exc: BaseException) -> list[BaseException]:
    """Die Ursachenkette einer Ausnahme, oberste zuerst, ohne im Kreis zu laufen.

    httpx verpackt den echten Fehler zweimal (httpx.ConnectError um
    httpcore.ConnectError um ssl.SSLError oder socket.gaierror), der Typ der
    obersten Ausnahme sagt also nichts. Gemessen am 2026-08-27, siehe oben.
    """
    seen: set[int] = set()
    chain: list[BaseException] = []
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__
    return chain


def classify_failure(exc: BaseException) -> str:
    """Warum ist dieser Abruf gescheitert? Liefert eine der Arten von oben.

    Die Reihenfolge der Bloecke ist die Rangfolge: ein Zertifikatsfehler bleibt
    ein Zertifikatsfehler, auch wenn in derselben Kette noch ein Verbindungs-
    fehler steckt.

    Der Textvergleich am Ende ist die Absicherung dagegen, dass eine spaetere
    httpx- oder Python-Fassung anders verpackt. Er steht bewusst zuletzt: die
    Typen sind eindeutig, der Text ist es nicht.
    """
    import ssl

    chain = _causes(exc)

    for err in chain:
        if isinstance(err, ssl.SSLCertVerificationError):
            return CERT
    for err in chain:
        if isinstance(err, ssl.SSLError):
            return TLS
    for err in chain:
        if isinstance(err, socket.gaierror):
            return DNS
    for err in chain:
        if isinstance(err, ConnectionRefusedError):
            return REFUSED
        if isinstance(err, OSError) and err.errno in _REFUSED_ERRNOS:
            return REFUSED
    if isinstance(exc, httpx.TimeoutException):
        return TIMEOUT
    if isinstance(exc, httpx.HTTPStatusError):
        return HTTP

    text = " ".join(str(err) for err in chain).lower()
    if "certificate verify failed" in text or "certificate_verify_failed" in text:
        return CERT
    if "ssl" in text or "tls" in text:
        return TLS
    if "getaddrinfo" in text or "name or service not known" in text:
        return DNS
    if "refused" in text or "unreachable" in text:
        return REFUSED
    if "timed out" in text or "timeout" in text:
        return TIMEOUT
    return OTHER


# Gegenprobe fuer den eigenen Netzzugang, bevor aus "nicht erreichbar" ein Satz
# in einer Mail wird.
#
# DER FALL, DEN SIE ABFAENGT, ist nicht der einzelne tote Lead, sondern die
# kaputte Replik. Faellt auf dem Railway-Host der Resolver aus oder klemmt der
# Ausgang, meldet JEDER Abruf einen dauerhaft aussehenden Fehler, und zwar bei
# beiden Beobachtungen. Ohne Gegenprobe bekaeme dann eine ganze Liste den
# Befund "eure Website laedt nicht": der teuerste denkbare Fehlalarm dieses
# Moduls, weil er nicht einen Empfaenger blamiert, sondern alle auf einmal.
#
# example.com ist von der IANA genau dafuer reserviert (RFC 2606) und gehoert
# niemandem, dem wir damit zur Last fallen. Ein Abruf, kein Guthaben.
#
# Die Fehlerrichtung ist Absicht: antwortet die Gegenprobe NICHT, gilt das
# eigene Netz als fraglich und es entsteht KEIN Befund. Lieber ein verpasster
# Aufhaenger als ein erfundener.
CONTROL_URL = "https://example.com/"


def own_network_is_up(timeout: float = PROBE_TIMEOUT_S) -> bool:
    """Kommt diese Replik ueberhaupt ins Netz? Ein Abruf, nur der Statuscode.

    5xx zaehlt als "nicht beantwortet": dann antwortet zwar irgendetwas, aber
    die Kontrollseite selbst ist gestoert und taugt als Beleg nicht mehr.
    """
    try:
        r = httpx.get(
            CONTROL_URL,
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )
    except httpx.HTTPError:
        return False
    return r.status_code < 500
