"""Verwirft Profil-URLs, die die KI-Websuche erfunden hat.

═══════════════════════════════════════════════════════════════════════════
DER BEFUND (gemessen am 2026-08-22 in der Produktionsdatenbank)
═══════════════════════════════════════════════════════════════════════════

Workspace 2d9bb9ae-811a-45ff-b1bf-1584e89f51ca: von 3007 Kontakten haben 1449
eine contacts.linkedin. 52 davon enden woertlich auf "12345678". Bei 52
VERSCHIEDENEN Menschen ist das kein Zufall, sondern ein Platzhalter, den das
Modell eingesetzt hat, statt "nicht gefunden" zu melden. Weitere 150 enden auf
sieben oder mehr Ziffern; ein Teil davon duerfte ebenfalls erfunden sein.

Warum das mehr ist als ein toter Link: die Profile werden geoeffnet, um daraus
den Icebreaker zu schreiben. Erfindet das Modell die Adresse, sind Name und
Titel aus DEMSELBEN Aufruf moeglicherweise auch nicht belegt.

Nur die KI-Websuche (pipelines/find_decisionmaker.py) ist betroffen. Apollo,
Prospeo und Hunter liefern ihre Profil-URLs aus einer echten Datenbank; deren
Werte laufen bewusst nicht durch diese Pruefung.

═══════════════════════════════════════════════════════════════════════════
WO DIE GRENZE LIEGT, UND WARUM SIE SO ENG IST
═══════════════════════════════════════════════════════════════════════════

Echte LinkedIn-Adressen enthalten Ziffern: /in/sander-volbeda-1a2b3c4 ist echt,
und LinkedIn haengt an haeufige Namen auch rein numerische Endungen an. "Endet
auf viele Ziffern" ist deshalb KEIN Beweis fuer eine Erfindung -- diese Regel
wuerde echte Profile wegwerfen.

Verworfen wird nur, was ohne jede Kenntnis der Person als Platzhalter
erkennbar ist:

  1. eine fortlaufende Ziffernfolge am Ende (12345678, 123456789, 87654321)
  2. dieselbe Ziffer mehrfach am Ende (00000000, 11111111)
  3. eine Folge aus x am Ende (xxxxxxxx)
  4. ein Platzhalter-Wort als letztes Pfadstueck (example, username, your-name)
  5. eine Adresse, die gar nicht zur Plattform des Feldes gehoert

Alles andere bleibt stehen. Eine erfundene Adresse durchzulassen kostet eine
Minute Recherche; eine echte zu verwerfen kostet den Kontaktweg zum Lead. Von
den 150 langen Ziffern-Endungen trifft diese Pruefung deshalb ABSICHTLICH nur
die, bei denen die Ziffernfolge selbst der Platzhalter ist.
"""
import re
from itertools import pairwise
from urllib.parse import urlsplit

# Die Hosts je Feld aus contacts. Laenderpraefixe (de.linkedin.com) und www.
# werden unten mitbehandelt; hier stehen nur die registrierbaren Domains.
PLATFORM_HOSTS: dict[str, tuple[str, ...]] = {
    "linkedin": ("linkedin.com", "lnkd.in"),
    "instagram": ("instagram.com", "instagr.am"),
    # x.com steht daneben, weil das Modell beide Schreibweisen liefert.
    "twitter": ("twitter.com", "x.com"),
    "facebook": ("facebook.com", "fb.com", "fb.me", "m.me"),
}

# Bewusst KEINE Namen wie "john-doe" oder "max-mustermann": das sind reale
# Namen, und ein echter John Doe wuerde seinen Kontaktweg verlieren. Hier steht
# nur, was als Personenname gar nicht vorkommt.
PLACEHOLDER_SLUGS = frozenset(
    {
        "example",
        "example-profile",
        "username",
        "user-name",
        "yourname",
        "your-name",
        "your-profile",
        "your-username",
        "firstname-lastname",
        "first-last",
        "name-surname",
        "profile-url",
        "na",
        "n-a",
        "none",
        "null",
        "unknown",
        "not-found",
        "notfound",
    }
)

# Ab welcher Laenge eine gleichfoermige Ziffernfolge als Platzhalter gilt.
# Fuenf, weil "1234" auch das Ende einer echten Hausnummer- oder Jahres-Endung
# sein kann; ab fuenf gibt es keine harmlose Lesart mehr.
MIN_PLACEHOLDER_RUN = 5

_TRAILING_DIGITS = re.compile(r"(\d+)$")
_TRAILING_X = re.compile(r"x{4,}$")


def _is_repeated(digits: str) -> bool:
    """00000000, 11111111."""
    return len(set(digits)) == 1


def _is_sequential(digits: str) -> bool:
    """12345678 und 87654321, aber nicht 10432987."""
    steps = {int(b) - int(a) for a, b in pairwise(digits)}
    return steps in ({1}, {-1})


def _host_matches(netloc: str, hosts: tuple[str, ...]) -> bool:
    host = netloc.lower().split("@")[-1].split(":")[0].removeprefix("www.")
    return any(host == d or host.endswith("." + d) for d in hosts)


def clean_profile_url(value: str | None, platform: str) -> str | None:
    """Gibt die URL unveraendert zurueck -- oder None, wenn sie sicher erfunden
    ist.

    Der Wert wird NICHT umgeschrieben (kein Schema ergaenzt, kein Tracking-
    Parameter entfernt): was gespeichert wird, ist genau das, was die Quelle
    geliefert hat, damit sich diese Pruefung spaeter an den Rohdaten
    nachvollziehen laesst.

    Eine unbekannte Plattform laesst den Wert durch -- lieber ungeprueft als
    nach geratenen Regeln verworfen.
    """
    if not value:
        return None
    url = value.strip()
    if not url:
        return None

    hosts = PLATFORM_HOSTS.get(platform)
    if hosts is None:
        return url

    # Das Modell liefert die Adresse durchaus ohne Schema ("linkedin.com/in/x").
    # urlsplit legte sie dann komplett in .path, und der Host-Vergleich unten
    # ginge ins Leere.
    parsed = urlsplit(url if "://" in url else f"https://{url}")
    if not _host_matches(parsed.netloc, hosts):
        return None

    segments = [s for s in parsed.path.split("/") if s]
    if not segments:
        return None  # nackte Startseite, kein Profil

    slug = segments[-1].lower()
    if slug in PLACEHOLDER_SLUGS:
        return None
    if _TRAILING_X.search(slug):
        return None

    treffer = _TRAILING_DIGITS.search(slug)
    if treffer:
        digits = treffer.group(1)
        if len(digits) >= MIN_PLACEHOLDER_RUN and (_is_repeated(digits) or _is_sequential(digits)):
            return None

    return url
