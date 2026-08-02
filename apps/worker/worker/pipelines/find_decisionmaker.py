"""Pipeline 2 — Port von n8n 'Find_Decisionmaker'.

OpenAI Responses API mit web_search-Tool + Structured Output (JSON Schema).
Ersetzt das '```json'-Prompt-Parsing und die Switch/Stop-and-Error-Logik aus n8n.
"""
import json
import re

from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from worker.db import sb
from worker import usage
from worker.email_classify import classify_email
from worker.keys import get_api_key
from worker.search_state import BUSINESS_WITH_SEARCH, search_is_deleted
from worker.suppression import is_suppressed, load_suppression

MODEL = "gpt-4.1-mini"

SYSTEM_PROMPT = (
    "You are an expert researcher finding the business owner / decision makers of a given "
    "business. Use web search. Only include natural persons (individual human beings) - "
    "NEVER companies, holdings, trusts or other legal entities as persons. "
    "For each person also find their email address, their direct/mobile phone number "
    "(check the website imprint/contact page and public listings) and social "
    "profiles (LinkedIn, Instagram, Twitter/X, Facebook) if available. "
    "Use the string 'NA' for anything you cannot find. Only include real people you found "
    "evidence for; if you find nobody, return an empty persons list. "
    "Additionally, based on the same research, write a concise factual company summary: "
    "2-4 sentences covering what the business does, who its customers are, and any "
    "notable specifics (location, scale, technology, recent developments). Write it in "
    "the language of the company's own website. Purely factual, no marketing fluff, no "
    "praise. If you cannot find enough to summarize, use the string 'NA'."
)

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "company_name": {"type": "string"},
        "company_summary": {"type": "string"},
        "persons": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "title": {"type": "string"},
                    "email": {"type": "string"},
                    "phone": {"type": "string"},
                    "linkedin": {"type": "string"},
                    "instagram": {"type": "string"},
                    "twitter": {"type": "string"},
                    "facebook": {"type": "string"},
                },
                "required": [
                    "name", "title", "email", "phone", "linkedin", "instagram", "twitter", "facebook",
                ],
            },
        },
    },
    "required": ["company_name", "company_summary", "persons"],
}


COMPANY_NAME_PATTERN = re.compile(
    r"\b(gmbh|m\.?b\.?h|ag|kg|og|ug|e\.u\.|ltd|llc|inc|corp|co\.|s\.?a\.?r\.?l|"
    r"b\.?v\.|n\.?v\.|plc|s\.?r\.?o|holding|group|ventures|capital|restaurants?)\b|&",
    re.IGNORECASE,
)


def is_company_name(name: str) -> bool:
    """Erkennt juristische Personen, die die KI faelschlich als Person liefert."""
    return bool(COMPANY_NAME_PATTERN.search(name))


def _clean(value: str | None) -> str | None:
    return None if not value or value.strip().upper() == "NA" else value.strip()


def parse_persons(data: dict) -> list[dict]:
    """Die KI ist schon per Prompt auf echte Personen eingeschraenkt (siehe
    SYSTEM_PROMPT), trotzdem als zweite Absicherung dieselbe Praefix-Heuristik
    wie bei Hunter: falls die gefundene E-Mail doch eine Rollen-Adresse ist
    (info@/office@ etc.), wird der Kontakt verworfen statt als personenbezogen
    gezaehlt zu werden.

    Zusaetzlich wird innerhalb einer Antwort entdoppelt: das Modell liefert
    dieselbe Person durchaus mehrfach zurueck (real aufgetreten: zehn Zeilen
    mit derselben Adresse fuer eine Firma, alle aus einem Durchlauf). Ohne das
    stehen dieselben Kontakte mehrfach in der Liste und blaehen die Zaehler
    auf, die der Nutzer im Frontend sieht."""
    out = []
    seen_emails: set[str] = set()
    seen_names: set[str] = set()
    for p in data.get("persons", []):
        name = _clean(p.get("name"))
        if name is None or is_company_name(name):
            continue
        email = _clean(p.get("email"))
        email_type = classify_email(email)
        if email_type == "generic":
            continue
        # E-Mail ist der belastbare Schluessel; fehlt sie, muss der Name
        # herhalten, sonst landet dieselbe namenlose Person mehrfach drin.
        if email:
            key = email.lower()
            if key in seen_emails:
                continue
            seen_emails.add(key)
        else:
            key = name.strip().lower()
            if key in seen_names:
                continue
            seen_names.add(key)
        parts = name.split(" ", 1)
        out.append(
            {
                "full_name": name,
                "first_name": parts[0],
                "last_name": parts[1] if len(parts) > 1 else None,
                "title": _clean(p.get("title")),
                "email": email,
                "email_type": email_type,
                "phone": _clean(p.get("phone")),
                "linkedin": _clean(p.get("linkedin")),
                "instagram": _clean(p.get("instagram")),
                "twitter": _clean(p.get("twitter")),
                "facebook": _clean(p.get("facebook")),
                "source": "ai_websearch",
            }
        )
    return out


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=60), reraise=True)
def research(
    business: dict,
    api_key: str,
    workspace_id: str | None = None,
    search_id: str | None = None,
) -> dict:
    client = OpenAI(api_key=api_key)
    resp = client.responses.create(
        model=MODEL,
        tools=[{"type": "web_search"}],
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Company Name: {business['name']}\n"
                    f"Website: {business.get('website') or 'NA'}\n"
                    f"Address: {business.get('address') or 'NA'}"
                ),
            },
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "decisionmakers",
                "schema": SCHEMA,
                "strict": True,
            }
        },
    )
    # Web-Suche als Werkzeug macht diesen Aufruf deutlich teurer als eine
    # reine Textgenerierung -- umso wichtiger, ihn echt zu zaehlen statt
    # pauschal pro Job zu schaetzen.
    if workspace_id:
        usage.record_openai(workspace_id, "find_decisionmaker", resp, search_id=search_id)
    return json.loads(resp.output_text)


def run(job: dict) -> None:
    ws = job["workspace_id"]
    business_id = job["payload"]["business_id"]
    biz = sb().table("businesses").select(BUSINESS_WITH_SEARCH).eq("id", business_id).single().execute().data
    if search_is_deleted(biz):
        return  # Suche im Papierkorb -- keine OpenAI-Kosten fuer unsichtbare Leads

    def set_status(status: str) -> None:
        sb().table("businesses").update({"decisionmaker_status": status}).eq(
            "id", business_id
        ).execute()

    set_status("running")
    try:
        data = research(
            biz, get_api_key(ws, "openai"), workspace_id=ws, search_id=biz.get("search_id")
        )
        summary = _clean(data.get("company_summary"))
        if summary:
            sb().table("businesses").update({"company_summary": summary}).eq(
                "id", business_id
            ).execute()
        emails, domains = load_suppression(ws)
        # Schon vorhandene Kontakte dieser Firma ausklammern. Ein Job kann
        # mehrfach laufen -- etwa wenn der Worker mitten in der Ausfuehrung
        # stirbt und claim_job() den Job nach der Zeitueberschreitung neu
        # einreiht (Migration 0047). Ohne diese Pruefung wuerde der zweite
        # Durchlauf dieselben Personen ein weiteres Mal anlegen.
        existing_rows = (
            sb()
            .table("contacts")
            .select("email, full_name")
            .eq("business_id", business_id)
            .execute()
            .data
            or []
        )
        known_emails = {r["email"].lower() for r in existing_rows if r.get("email")}
        # Namen als Rueckfallschluessel: ohne E-Mail gaebe es sonst keinen, und
        # gerade die Kontakte ohne Adresse wuerden sich bei jedem Wiederholungs-
        # lauf vervielfachen.
        known_names = {
            r["full_name"].strip().lower()
            for r in existing_rows
            if r.get("full_name") and not r.get("email")
        }

        def is_new(c: dict) -> bool:
            email = (c.get("email") or "").strip().lower()
            if email:
                return email not in known_emails
            name = (c.get("full_name") or "").strip().lower()
            return bool(name) and name not in known_names

        contacts = [
            c | {"workspace_id": ws, "business_id": business_id}
            for c in parse_persons(data)
            if not is_suppressed(emails, domains, email=c.get("email")) and is_new(c)
        ]
        if contacts:
            sb().table("contacts").insert(contacts).execute()
            set_status("found")
        else:
            set_status("not_found")
    except Exception:
        set_status("failed")
        raise
