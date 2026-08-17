"""Pipeline 3 — Port von n8n 'Hunt_Persons'.

Hunter Domain-Search (executive/management, limit 5).
Verbesserung ggü. n8n: E-Mails mit verification.status == 'invalid' werden verworfen.
"""
from urllib.parse import urlparse

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from worker import usage
from worker.db import sb
from worker.email_classify import classify_email
from worker.http_safety import raise_for_status_safe
from worker.keys import get_api_key
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted
from worker.suppression import is_suppressed, load_suppression

HUNTER_URL = "https://api.hunter.io/v2/domain-search"


def extract_domain(url: str) -> str:
    netloc = urlparse(url if "//" in url else f"https://{url}").netloc
    return netloc.removeprefix("www.")


def parse_hunter_emails(payload: dict) -> list[dict]:
    """Nimmt nur personenbezogene Treffer mit (Hunters eigenes type-Feld) --
    generische Rollen-Adressen (info@/office@ etc.) werden verworfen, siehe
    worker.email_classify. Cold-Outreach an ein geteiltes Postfach bringt dem
    Kunden praktisch nichts und zaehlt auch nicht als qualifizierter Lead."""
    out = []
    for e in payload.get("data", {}).get("emails", []):
        if (e.get("verification") or {}).get("status") == "invalid":
            continue
        email_type = classify_email(e.get("value"), hunter_type=e.get("type"))
        if email_type == "generic":
            continue
        out.append(
            {
                "first_name": e.get("first_name"),
                "last_name": e.get("last_name"),
                "full_name": " ".join(filter(None, [e.get("first_name"), e.get("last_name")]))
                or None,
                "title": e.get("position"),
                "seniority": e.get("seniority"),
                "department": e.get("department"),
                "email": e.get("value"),
                "email_type": email_type,
                "email_confidence": e.get("confidence"),
                "email_verification_status": (e.get("verification") or {}).get("status"),
                "phone": e.get("phone_number"),
                "linkedin": e.get("linkedin"),
                "twitter": e.get("twitter"),
                "source": "hunter",
            }
        )
    return out


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30), reraise=True)
def domain_search(domain: str, api_key: str) -> dict:
    r = httpx.get(
        HUNTER_URL,
        params={
            "domain": domain,
            "limit": 5,
            "department": "executive,management",
            "api_key": api_key,
        },
        timeout=30,
    )
    raise_for_status_safe(r)
    return r.json()


def run(job: dict) -> None:
    ws = job["workspace_id"]
    business_id = job["payload"]["business_id"]
    biz = sb().table("businesses").select(BUSINESS_WITH_SEARCH).eq("id", business_id).single().execute().data
    if search_is_deleted(biz):
        return  # Suche im Papierkorb -- keine Hunter-Credits fuer unsichtbare Leads

    def set_status(status: str) -> None:
        # decisionmaker_status wandert bewusst mit: seit jeder Suchweg genau
        # eine Adressquelle hat, ist hunt_persons im Corporate-Modus der
        # einzige Schritt, der Ansprechpartner findet -- find_decisionmaker
        # laeuft dort nicht mehr. Bliebe das Feld auf "pending", wuerde
        # personalize dauerhaft mit NotReadyYet zurueckgestellt und nie eine
        # Eroeffnungszeile schreiben (siehe personalize.build_context).
        sb().table("businesses").update(
            {"hunter_status": status, "decisionmaker_status": status}
        ).eq("id", business_id).execute()

    if not biz.get("website"):
        set_status("not_found")
        return
    set_status("running")
    try:
        payload = domain_search(extract_domain(biz["website"]), get_api_key(ws, "hunter"))
        # Hunter rechnet pro Domain-Suche ab, unabhaengig davon, wie viele
        # Adressen dabei herauskommen -- deshalb hier zaehlen und nicht erst
        # nach der Sperrlisten-Filterung. Der Eurowert eines Credits haengt am
        # Tarif und bleibt offen (siehe worker/usage.py).
        usage.record(
            ws, "hunter", "domain_search", 1, "credits", search_id=biz.get("search_id")
        )
        emails, domains = load_suppression(ws)
        contacts = [
            c | {"workspace_id": ws, "business_id": business_id}
            for c in parse_hunter_emails(payload)
            if not is_suppressed(emails, domains, email=c.get("email"))
        ]
        if contacts:
            sb().table("contacts").insert(contacts).execute()
            set_status("found")
        else:
            set_status("not_found")
    except Exception:
        set_status("failed")
        raise
