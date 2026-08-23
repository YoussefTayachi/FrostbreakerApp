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
import re
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


def is_ssl_error(exc: BaseException) -> bool:
    """Steckt in dieser Ausnahme ein TLS-Problem?

    httpx meldet ein abgelaufenes oder ungueltiges Zertifikat als
    httpx.ConnectError; die eigentliche ssl.SSLCertVerificationError haengt
    nur in der Ursachenkette. Deshalb die Kette ablaufen und nicht nur den
    Typ der obersten Ausnahme ansehen.

    Der Textvergleich am Ende ist die Absicherung dagegen, dass eine spaetere
    httpx-Fassung anders verpackt: ein falsch als "unerreichbar" abgelegtes
    Zertifikatsproblem waere ein stillschweigend verlorener Befund.
    """
    import ssl

    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ssl.SSLError):
            return True
        current = current.__cause__ or current.__context__
    text = str(exc).lower()
    return "certificate" in text or "ssl" in text or "tls" in text
