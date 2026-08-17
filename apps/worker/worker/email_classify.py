"""Klassifiziert eine gefundene E-Mail als 'personal' (echte Person) oder
'generic' (Rollen-Adresse wie info@/office@). Nur personenbezogene Treffer
sind fuer Cold-Outreach wirklich verwertbar — eine generische Adresse landet
meist in einem geteilten Postfach, das niemand konsequent liest.

Zwei Quellen fuer die Einordnung:
- Hunter liefert das Feld direkt mit ('personal'/'generic' im Domain-Search-
  Response) — wird bevorzugt, wenn vorhanden.
- Sonst per Praefix-Heuristik gegen bekannte Rollen-Postfaecher (KI-Websuche
  liefert kein eigenes type-Feld).
"""
import re

GENERIC_LOCAL_PARTS = {
    "info", "office", "contact", "kontakt", "hello", "hallo", "support",
    "admin", "administration", "sales", "vertrieb", "mail", "email", "team",
    "service", "help", "hilfe", "billing", "buchhaltung", "no-reply",
    "noreply", "webmaster", "postmaster", "enquiries", "inquiries", "general",
    "reception", "empfang", "marketing", "press", "presse", "jobs", "career",
    "careers", "bewerbung",
    # Agentur-typische Sammelpostfaecher — real aufgetreten: sayhello@ wurde
    # als personenbezogen durchgewinkt und landete so in einer Lead-Liste.
    "hi", "hey", "hola", "moin", "connect", "letstalk", "weare", "ask", "talk",
    "intouch", "touch", "inquiry", "newbusiness", "business", "studio", "agency", "work", "projects",
    "project", "partnerships", "partner", "hallo-team", "anfrage", "anfragen",
    "post", "buero", "buchung", "booking", "termin", "praxis", "empfangsdame",
}

# Trennzeichen innerhalb des lokalen Teils: "new.business", "info-us",
# "hello_team" sind genauso Sammelpostfaecher wie "info".
_SEPARATORS = re.compile(r"[._-]")

# Fuellwoerter vor einem Rollenwort: "sayhello", "wearestudio", "getintouch".
# Ohne die rutschen genau solche Adressen als "personal" durch.
_FILLER_PREFIXES = ("say", "we", "lets", "let", "get", "go", "just", "the", "our")


def _strip_trailing_digits(part: str) -> str:
    return re.sub(r"\d+$", "", part)


def _is_generic_local(local: str) -> bool:
    candidates = {local, _strip_trailing_digits(local)}
    for part in _SEPARATORS.split(local):
        if part:
            candidates.add(part)
            candidates.add(_strip_trailing_digits(part))
    if candidates & GENERIC_LOCAL_PARTS:
        return True
    # "sayhello" -> "hello", aber nur wenn der Rest ein vollstaendiges
    # Rollenwort ist. Reine Teilstring-Suche waere zu grob und wuerde echte
    # Namen treffen.
    for candidate in candidates:
        for prefix in _FILLER_PREFIXES:
            if candidate.startswith(prefix) and candidate[len(prefix) :] in GENERIC_LOCAL_PARTS:
                return True
    return False


def classify_email(email: str | None, hunter_type: str | None = None) -> str | None:
    """Gibt 'personal', 'generic' oder None (unbekannt, z.B. keine E-Mail
    vorhanden) zurueck."""
    if hunter_type in ("personal", "generic"):
        return hunter_type
    if not email or "@" not in email:
        return None
    local_part = email.split("@", 1)[0].strip().lower()
    local_part = local_part.split("+", 1)[0]  # Plus-Adressierung abschneiden
    local_part = re.sub(r"[^a-z0-9._-]", "", local_part)
    return "generic" if _is_generic_local(local_part) else "personal"
