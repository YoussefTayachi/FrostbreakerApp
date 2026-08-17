"""Verhindert, dass ein API-Key aus einem Query-Parameter im Klartext in einer
Fehlermeldung landet. httpx.Response.raise_for_status() haengt die komplette
Request-URL unveraendert an die Exception-Message. Bei Hunter (api_key=...)
und Google Maps (key=...) wird der Key dabei mitgeloggt. Diese Nachrichten
landen unveraendert in searches.error/jobs.last_error (Datenbank!) und werden
im Frontend teils sogar als Tooltip angezeigt (searches.error, siehe
apps/web/app/searches/page.tsx).
"""
import re

import httpx

_SECRET_PARAM_PATTERN = re.compile(r"(?i)([?&](?:api_key|key)=)[^&]+")

# Der Antwort-Body ist bei einem 4xx die einzige Stelle, die den GRUND nennt
# (Hunter liefert dort z.B. {"errors":[{"details":"..."}]}). Ohne ihn steht in
# searches.error nur "400 Bad Request", und man raet, welcher Filter schuld
# ist. Begrenzt, damit eine HTML-Fehlerseite die Spalte nicht flutet.
_MAX_BODY_CHARS = 400


def redact_url(url: str) -> str:
    return _SECRET_PARAM_PATTERN.sub(r"\1***", url)


def _safe_body_excerpt(response: httpx.Response) -> str:
    """Kurzer, redigierter Auszug des Antwort-Bodys fuer die Fehlermeldung."""
    try:
        body = response.text
    except Exception:  # noqa: BLE001 (Body nicht lesbar/dekodierbar: dann eben ohne)
        return ""
    body = " ".join(body.split())  # Zeilenumbrueche raus, bleibt einzeilig loggbar
    if not body:
        return ""
    # Auch den Body redigieren: ein Anbieter koennte die Anfrage inkl.
    # Query-String zurueckspiegeln, dann steht der Key wieder drin.
    body = redact_url(body)
    if len(body) > _MAX_BODY_CHARS:
        body = body[:_MAX_BODY_CHARS] + "..."
    return body


def raise_for_status_safe(response: httpx.Response) -> None:
    """Ersatz fuer response.raise_for_status(): redigiert Keys und haengt den
    Antwort-Body an, damit die Fehlermeldung tatsaechlich diagnostisch ist."""
    if not response.is_error:
        return
    kind = "Client" if response.status_code < 500 else "Server"
    message = (
        f"{kind} error '{response.status_code} {response.reason_phrase}' for url "
        f"'{redact_url(str(response.url))}'"
    )
    excerpt = _safe_body_excerpt(response)
    if excerpt:
        message += f" -- Antwort: {excerpt}"
    raise httpx.HTTPStatusError(message, request=response.request, response=response)
