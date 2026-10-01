"""Job verify_emails: Adressen einer Liste live per NeverBounce pruefen.

Payload: {"search_id": ...}. Laeuft nur in Workspaces mit
workspaces.auto_verify_emails (Migration 0128), eingereiht am Ende einer
Suche (get_businesses._finish) und nach dem Freischalten (reveal_emails).

Danach wandern Firmen, deren Adressen ALLE riskant sind (catchall, accept_all,
unknown), in eine eigene Liste "<Name> | Catch-all". Eine Liste speist genau
eine Kampagne (searches.instantly_campaign_id), deshalb ist eine eigene Liste
der Weg zu einer eigenen, kleineren Catch-all-Kampagne. Youssef am 2026-10-01:
"automatisch pruefen, catchall in eigene kampagne".

GEMESSEN AM 2026-10-01, 10 retaiyn-Leads mit Apollos 'verified': 4 valid,
5 catchall, 1 unknown, 0 invalid. Apollos 'verified' haelt also gegen echte
Bounces, sagt aber nichts darueber, ob die Domain alles annimmt.

Kosten: je Pruefung ein NeverBounce-Credit. Doppelt bezahlt wird nichts:
needs_neverbounce laesst alles liegen, was NeverBounce schon geprueft hat,
ein wiederholter Job prueft also nur den Rest.
"""

from __future__ import annotations

import logging

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from worker import usage
from worker.db import sb
from worker.keys import MissingApiKey, get_api_key

log = logging.getLogger(__name__)

NB_URL = "https://api.neverbounce.com/v4/single/check"

# Gleiche Skala wie apps/web/app/api/verify-emails/route.ts.
CONFIDENCE_BY_RESULT = {"valid": 97, "catchall": 60, "unknown": 40, "disposable": 20, "invalid": 0}

# Zustellbar, aber nicht belegt: die Domain nimmt alles an oder hat nicht
# geantwortet. invalid/disposable sortiert die Kampagne ohnehin aus
# (apps/web/lib/contacts.ts), die gehoeren nicht in die Catch-all-Liste.
RISKY = {"catchall", "accept_all", "unknown"}


def needs_neverbounce(c: dict) -> bool:
    """Spiegel von needsNeverBounce in apps/web/lib/email-verification.ts."""
    if not c.get("email"):
        return False
    if c.get("email_verified_by") == "neverbounce":
        return False
    if not c.get("email_verification_status"):
        return True
    return c.get("source") == "apollo"


def risky_businesses(contacts: list[dict]) -> set[str]:
    """Firmen, bei denen jede Adresse riskant ist (pure, testbar).

    Eine Firma mit einer belegten und einer riskanten Adresse bleibt in der
    Hauptliste: dort wird ohnehin nur eine Person je Firma angeschrieben.
    """
    status_by_biz: dict[str, list[str | None]] = {}
    for c in contacts:
        if c.get("email") and c.get("business_id"):
            status_by_biz.setdefault(c["business_id"], []).append(c.get("email_verification_status"))
    return {b for b, st in status_by_biz.items() if st and all(s in RISKY for s in st)}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20), reraise=True)
def check(api_key: str, email: str) -> str:
    r = httpx.get(NB_URL, params={"key": api_key, "email": email, "timeout": "8"}, timeout=15)
    r.raise_for_status()
    body = r.json()
    if body.get("status") != "success":
        # Die URL steht mit im Text, damit provider_errors den Anbieter erkennt.
        raise RuntimeError(f"api.neverbounce.com: {body.get('status')} {body.get('message')}")
    return body["result"]


def _auto_verify(ws: str) -> bool:
    rows = sb().table("workspaces").select("auto_verify_emails").eq("id", ws).execute().data or []
    return bool(rows and rows[0].get("auto_verify_emails"))


def _contacts(ws: str, search_id: str) -> list[dict]:
    biz = (
        sb()
        .table("businesses")
        .select("id")
        .eq("workspace_id", ws)
        .eq("search_id", search_id)
        .execute()
        .data
        or []
    )
    ids = [b["id"] for b in biz]
    rows: list[dict] = []
    for i in range(0, len(ids), 100):
        rows += (
            sb()
            .table("contacts")
            .select("id,business_id,email,email_verification_status,email_verified_by,source")
            .eq("workspace_id", ws)
            .in_("business_id", ids[i : i + 100])
            .execute()
            .data
            or []
        )
    return rows


def run(job: dict) -> None:
    ws = job["workspace_id"]
    search_id = job["payload"]["search_id"]
    if not _auto_verify(ws):
        return
    try:
        api_key = get_api_key(ws, "neverbounce")
    except MissingApiKey:
        log.info("verify_emails %s: kein NeverBounce-Key, nichts geprueft.", search_id)
        return

    contacts = _contacts(ws, search_id)
    checked = 0
    try:
        for c in contacts:
            if not needs_neverbounce(c):
                continue
            result = check(api_key, c["email"])
            sb().table("contacts").update(
                {
                    "email_verification_status": result,
                    "email_confidence": CONFIDENCE_BY_RESULT.get(result, 40),
                    "email_verified_by": "neverbounce",
                }
            ).eq("id", c["id"]).eq("workspace_id", ws).execute()
            c["email_verification_status"] = result
            c["email_verified_by"] = "neverbounce"
            checked += 1
    finally:
        # Auch bei Abbruch mitten in der Liste: was geprueft ist, ist bezahlt.
        usage.record(
            ws,
            "neverbounce",
            "verify",
            checked,
            "checks",
            cost_usd=checked * usage.NEVERBOUNCE_USD_PER_CHECK,
            search_id=search_id,
        )
    moved = _split_catchall(ws, search_id, contacts)
    log.info("verify_emails %s: %s geprueft, %s Firmen in die Catch-all-Liste.", search_id, checked, moved)


def _split_catchall(ws: str, search_id: str, contacts: list[dict]) -> int:
    rows = (
        sb()
        .table("searches")
        .select("id,name,query,instantly_campaign_id,filters,deleted_at")
        .eq("id", search_id)
        .eq("workspace_id", ws)
        .execute()
        .data
        or []
    )
    if not rows:
        return 0
    search = rows[0]
    if search.get("deleted_at") or (search.get("filters") or {}).get("catchall_of"):
        return 0
    # Haengt schon eine Kampagne oder ein Entwurf an der Liste, bleibt alles,
    # wo es ist: wer die Kampagne gebaut hat, hat mit genau diesen Leads
    # gerechnet.
    if search.get("instantly_campaign_id"):
        return 0
    links = sb().table("campaign_searches").select("campaign_id").eq("search_id", search_id).execute().data
    if links:
        return 0

    risky = sorted(risky_businesses(contacts))
    if not risky:
        return 0

    existing = (
        sb()
        .table("searches")
        .select("id")
        .eq("workspace_id", ws)
        .eq("filters->>catchall_of", search_id)
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    if existing:
        child_id = existing[0]["id"]
    else:
        label = (search.get("name") or search.get("query") or "Liste").strip()
        # source 'csv': der Trigger on_search_created startet dafuer keinen
        # Suchlauf (Migration 0075), sonst kaufte get_businesses neu ein.
        child_id = (
            sb()
            .table("searches")
            .insert(
                {
                    "workspace_id": ws,
                    "source": "csv",
                    "name": f"{label} | Catch-all",
                    "query": search.get("query") or label,
                    "location": "",
                    "status": "completed",
                    "max_results": len(risky),
                    "filters": {"catchall_of": search_id},
                }
            )
            .execute()
            .data[0]["id"]
        )
    for i in range(0, len(risky), 100):
        sb().table("businesses").update({"search_id": child_id}).eq("workspace_id", ws).in_(
            "id", risky[i : i + 100]
        ).execute()
    return len(risky)
