"""Pipeline 5 -- Instantly-Integration (Punkt 0 + 1 aus dem Differenzierungs-Plan).

Instantly bleibt die Sende-Infrastruktur (Warmup, Zustellbarkeit), diese Pipeline
holt nur die Ergebnisse zurueck: Kampagnen-Analytics (Opens, Replies, Bounces,
Opportunities) und einzelne eingehende Antworten. Laeuft per Polling gegen die
Instantly API v2 (https://developer.instantly.ai), bewusst OHNE Webhooks --
Webhooks setzen den Hypergrowth-Plan voraus, Polling funktioniert schon auf
Growth (siehe Differenzierungs-Plan, Punkt 0).

Getriggert durch process_due_instantly_polls() in main.py fuer jede Suche mit
gesetzter instantly_campaign_id, alle paar Minuten (nicht bei jedem Job-Zyklus,
/emails hat ein Rate-Limit von 20 Requests/Minute bei Instantly).

Zweiter, unabhaengiger Job-Typ in derselben Datei: run_inbox() synct NICHT pro
Kampagne, sondern pro verbundener Mailbox (eaccount) das komplette Postfach
(empfangen + gesendet), unabhaengig davon ob eine Mail zu einer Kampagne gehoert.
Antworten von unbekannten Absendern werden dabei NICHT verworfen (anders als im
kampagnen-scoped Pfad unten) -- Grund: das soll den eigenen IONOS-Posteingang
vollstaendig spiegeln, nicht nur Lead-Antworten. Warmup-Mails tauchen hier trotzdem
nicht auf: Instantlys /api/v2/emails hat kein is_warmup-Feld, aber der IONOS-
Spamfilter sortiert Warmup-Verkehr schon vor Instantlys eigenem IMAP-Sync aus.
"""
from datetime import datetime, timezone

import httpx
from openai import OpenAI

from worker.db import sb
from worker.keys import get_api_key

BASE_URL = "https://api.instantly.ai"

# "not_interested" bewusst niedrig eingeordnet: eine echte, spaetere Antwort soll
# den Status trotzdem noch auf "replied" anheben koennen, falls sich das aendert.
STATUS_RANK = {
    "new": 0, "contacted": 1, "not_interested": 1,
    "replied": 2, "meeting_booked": 3, "customer": 4,
}


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}"}


def fetch_campaign_analytics(api_key: str, campaign_id: str) -> dict | None:
    r = httpx.get(
        f"{BASE_URL}/api/v2/campaigns/analytics",
        params={"id": campaign_id},
        headers=_headers(api_key),
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    return data[0] if data else None


def fetch_replies(api_key: str, campaign_id: str, since: str | None) -> list[dict]:
    params: dict = {"campaign_id": campaign_id, "email_type": "received", "limit": 100}
    if since:
        params["min_timestamp_created"] = since
    r = httpx.get(f"{BASE_URL}/api/v2/emails", params=params, headers=_headers(api_key), timeout=30)
    r.raise_for_status()
    return r.json().get("items") or []


def fetch_accounts(api_key: str) -> list[dict]:
    """Alle mit diesem Workspace verbundenen Instantly-Mailboxen (eaccounts)."""
    r = httpx.get(f"{BASE_URL}/api/v2/accounts", params={"limit": 100}, headers=_headers(api_key), timeout=30)
    r.raise_for_status()
    return r.json().get("items") or []


def fetch_inbox_emails(api_key: str, eaccount: str, email_type: str, since: str | None) -> list[dict]:
    """Postfach-weiter Abruf (kein campaign_id-Filter) -- der Unterschied zu
    fetch_replies() oben ist genau das: hier zaehlt die Mailbox, nicht die
    Kampagne, deshalb kommen auch Mails ohne Kampagnenbezug mit."""
    params: dict = {"eaccount": eaccount, "email_type": email_type, "mode": "emode_all", "limit": 100}
    if since:
        params["min_timestamp_created"] = since
    r = httpx.get(f"{BASE_URL}/api/v2/emails", params=params, headers=_headers(api_key), timeout=30)
    r.raise_for_status()
    return r.json().get("items") or []


def classify_reply(openai_key: str, body_text: str) -> str | None:
    """Grobe Einordnung einer eingehenden Antwort (Punkt 1). Best-effort: schlaegt
    die Klassifizierung fehl, wird das Status-Update trotzdem nicht blockiert."""
    try:
        client = OpenAI(api_key=openai_key)
        resp = client.responses.create(
            model="gpt-4.1-mini",
            input=[
                {
                    "role": "system",
                    "content": (
                        "Ordne die folgende Antwort auf eine Akquise-E-Mail in genau eine "
                        "Kategorie ein: 'interested', 'not_interested' oder 'question'. "
                        "Antworte nur mit dem Kategorie-Wort, sonst nichts."
                    ),
                },
                {"role": "user", "content": body_text[:2000]},
            ],
        )
        label = resp.output_text.strip().lower()
        return label if label in {"interested", "not_interested", "question"} else "question"
    except Exception:
        return None


def _update_campaign_stats(search_id: str, ws: str, analytics: dict) -> None:
    sb().table("instantly_campaign_stats").upsert(
        {
            "search_id": search_id,
            "workspace_id": ws,
            "leads_count": analytics.get("leads_count", 0),
            "contacted_count": analytics.get("contacted_count", 0),
            "emails_sent_count": analytics.get("emails_sent_count", 0),
            "open_count": analytics.get("open_count", 0),
            "reply_count": analytics.get("reply_count", 0),
            "reply_count_unique": analytics.get("reply_count_unique", 0),
            "bounced_count": analytics.get("bounced_count", 0),
            "unsubscribed_count": analytics.get("unsubscribed_count", 0),
            "completed_count": analytics.get("completed_count", 0),
            "total_opportunities": analytics.get("total_opportunities", 0),
            "total_opportunity_value": analytics.get("total_opportunity_value", 0),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="search_id",
    ).execute()


def _process_reply(ws: str, email: dict, openai_key: str | None) -> None:
    lead_email = (email.get("lead") or "").strip().lower()
    if not lead_email:
        return
    matches = (
        sb()
        .table("contacts")
        .select("id, outreach_status")
        .eq("workspace_id", ws)
        .ilike("email", lead_email)
        .limit(1)
        .execute()
        .data
    )
    if not matches:
        return  # Antwort von einer E-Mail, die (noch) keinem eigenen Kontakt entspricht
    contact = matches[0]

    body_text = ((email.get("body") or {}).get("text")) or ""
    ai_interest = classify_reply(openai_key, body_text) if openai_key and body_text else None

    sb().table("messages").upsert(
        {
            "workspace_id": ws,
            "contact_id": contact["id"],
            "direction": "inbound",
            "status": "received",
            "subject": email.get("subject"),
            "body": body_text,
            "sent_at": email.get("timestamp_email"),
            "instantly_email_id": email["id"],
            "ai_interest": ai_interest,
        },
        on_conflict="workspace_id,instantly_email_id",
    ).execute()

    if STATUS_RANK.get(contact["outreach_status"], 0) < STATUS_RANK["replied"]:
        sb().table("contacts").update({"outreach_status": "replied"}).eq("id", contact["id"]).execute()


def run(job: dict) -> None:
    ws = job["workspace_id"]
    search_id = job["payload"]["search_id"]
    search = sb().table("searches").select("*").eq("id", search_id).single().execute().data
    campaign_id = (search or {}).get("instantly_campaign_id")
    if not campaign_id:
        return

    api_key = get_api_key(ws, "instantly")

    analytics = fetch_campaign_analytics(api_key, campaign_id)
    if analytics:
        _update_campaign_stats(search_id, ws, analytics)

    openai_key: str | None
    try:
        openai_key = get_api_key(ws, "openai")
    except Exception:
        openai_key = None  # Klassifizierung ist optional, Status-Update funktioniert auch ohne

    since = search.get("instantly_last_polled_at")
    for email in fetch_replies(api_key, campaign_id, since):
        _process_reply(ws, email, openai_key)

    sb().table("searches").update(
        {"instantly_last_polled_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", search_id).execute()


def _process_email(ws: str, email: dict, direction: str, eaccount: str, openai_key: str | None) -> None:
    """Wie _process_reply(), aber OHNE das fruehe return bei unbekanntem Absender --
    die Mail landet trotzdem in messages, nur ohne contact_id/KI-Klassifizierung/
    Status-Update (das bleibt CRM-Kontakten vorbehalten, kein OpenAI-Aufruf fuer
    Mails ohne Lead-Bezug)."""
    lead_email = (email.get("lead") or "").strip().lower()

    contact = None
    if lead_email:
        matches = (
            sb()
            .table("contacts")
            .select("id, outreach_status")
            .eq("workspace_id", ws)
            .ilike("email", lead_email)
            .limit(1)
            .execute()
            .data
        )
        contact = matches[0] if matches else None

    body_text = ((email.get("body") or {}).get("text")) or ""
    ai_interest = None
    if contact and openai_key and body_text:
        ai_interest = classify_reply(openai_key, body_text)

    sb().table("messages").upsert(
        {
            "workspace_id": ws,
            "contact_id": contact["id"] if contact else None,
            "from_email": lead_email or None,
            "eaccount": eaccount,
            "direction": direction,
            "status": "received" if direction == "inbound" else "sent",
            "subject": email.get("subject"),
            "body": body_text,
            "sent_at": email.get("timestamp_email"),
            "instantly_email_id": email["id"],
            "ai_interest": ai_interest,
        },
        on_conflict="workspace_id,instantly_email_id",
    ).execute()

    if contact and direction == "inbound" and STATUS_RANK.get(contact["outreach_status"], 0) < STATUS_RANK["replied"]:
        sb().table("contacts").update({"outreach_status": "replied"}).eq("id", contact["id"]).execute()


def run_inbox(job: dict) -> None:
    """Mailbox-weiter Sync, ein Job pro Workspace (nicht pro Suche/Kampagne wie
    run() oben). Getriggert durch process_due_inbox_sync() in main.py."""
    ws = job["workspace_id"]
    api_key = get_api_key(ws, "instantly")

    openai_key: str | None
    try:
        openai_key = get_api_key(ws, "openai")
    except Exception:  # noqa: BLE001
        openai_key = None  # Klassifizierung ist optional, Sync funktioniert auch ohne

    workspace = sb().table("workspaces").select("instantly_inbox_synced_at").eq("id", ws).single().execute().data
    since = (workspace or {}).get("instantly_inbox_synced_at")

    for account in fetch_accounts(api_key):
        eaccount = account.get("email")
        if not eaccount:
            continue
        for email_type, direction in (("received", "inbound"), ("sent", "outbound")):
            for email in fetch_inbox_emails(api_key, eaccount, email_type, since):
                _process_email(ws, email, direction, eaccount, openai_key)

    sb().table("workspaces").update(
        {"instantly_inbox_synced_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", ws).execute()
