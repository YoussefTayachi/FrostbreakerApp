"""Verhindert, dass ein API-Key aus einem Query-Parameter im Klartext in einer
Fehlermeldung landet. httpx.Response.raise_for_status() haengt die komplette
Request-URL unveraendert an die Exception-Message -- bei Hunter (api_key=...)
und Google Maps (key=...) wird der Key dabei mitgeloggt. Diese Nachrichten
landen unveraendert in searches.error/jobs.last_error (Datenbank!) und werden
im Frontend teils sogar als Tooltip angezeigt (searches.error, siehe
apps/web/app/searches/page.tsx).
"""
import re

import httpx

_SECRET_PARAM_PATTERN = re.compile(r"(?i)([?&](?:api_key|key)=)[^&]+")


def redact_url(url: str) -> str:
    return _SECRET_PARAM_PATTERN.sub(r"\1***", url)


def raise_for_status_safe(response: httpx.Response) -> None:
    """Ersatz fuer response.raise_for_status() mit URL-Redaction in der Fehlermeldung."""
    if not response.is_error:
        return
    kind = "Client" if response.status_code < 500 else "Server"
    message = (
        f"{kind} error '{response.status_code} {response.reason_phrase}' for url "
        f"'{redact_url(str(response.url))}'"
    )
    raise httpx.HTTPStatusError(message, request=response.request, response=response)
