"""Job reveal_emails: E-Mails erst NACH der Recherche freischalten.

Zweite Haelfte des Modus "erst pruefen, dann freischalten" (filters.verify_first,
siehe get_businesses.run_apollo_verify_first). Payload: {"search_id": ...}.

Freigeschaltet wird nur, wer
  - noch keine Adresse hat,
  - eine Apollo-ID in custom.apollo_id traegt und custom.reveal == 'pending',
  - einen freigegebenen Personen-Befund hat (status 'found', nicht in Pruefung).

Je Kontakt 1 Credit (bulk_match), keine Firmendaten. Ueber
apollo.enrich_people, damit Apollo-Cache, Paketgroesse und Abrechnung genau
so laufen wie im normalen Apollo-Weg.

Passt die freigeschaltete Person nicht zur recherchierten Firma (weder die
Firmendomain noch die Adressdomain ist die gespeicherte Website), wird die
Adresse NICHT gespeichert: der Befund wurde fuer eine andere Firma geschrieben,
und die Mail wuerde an jemanden gehen, ueber den sie nicht spricht.
"""

from __future__ import annotations

import logging

from worker import usage
from worker.db import sb
from worker.email_classify import classify_email
from worker.keys import get_api_key
from worker.pipelines import apollo
from worker.queue import enqueue
from worker.suppression import domain_of

log = logging.getLogger(__name__)


def _todo(rows: list[dict]) -> list[dict]:
    """Welche Kontakte freigeschaltet werden (pure, testbar)."""
    out = []
    for r in rows:
        custom = r.get("custom") or {}
        if r.get("email") or not custom.get("apollo_id") or custom.get("reveal") != "pending":
            continue
        if r.get("person_finding_status") != "found" or r.get("person_finding_needs_review"):
            continue
        out.append(r)
    return out


def _same_company(biz_domain: str | None, org_website: str | None, email: str | None) -> bool:
    """Gehoert die freigeschaltete Person zur recherchierten Firma? (pure)"""
    if not biz_domain:
        return False
    org_d = domain_of(org_website) if org_website else None
    mail_d = (email or "").rsplit("@", 1)[-1].lower() if email and "@" in email else None
    return biz_domain in {org_d, mail_d}


def run(job: dict) -> None:
    ws = job["workspace_id"]
    search_id = job["payload"]["search_id"]

    biz = (
        sb()
        .table("businesses")
        .select("id,website")
        .eq("workspace_id", ws)
        .eq("search_id", search_id)
        .execute()
        .data
        or []
    )
    biz_domain = {b["id"]: domain_of(b.get("website")) for b in biz}
    ids = list(biz_domain)
    rows: list[dict] = []
    for i in range(0, len(ids), 100):
        rows += (
            sb()
            .table("contacts")
            .select(
                "id,business_id,email,custom,person_finding_status,person_finding_needs_review"
            )
            .eq("workspace_id", ws)
            .in_("business_id", ids[i : i + 100])
            .execute()
            .data
            or []
        )
    todo = _todo(rows)
    if not todo:
        log.info("reveal_emails %s: nichts freizuschalten.", search_id)
        return

    api_key = get_api_key(ws, "apollo")
    by_apollo = {r["custom"]["apollo_id"]: r for r in todo}
    parsed = apollo.enrich_people(
        list(by_apollo),
        api_key,
        wanted=len(by_apollo),
        on_charge=lambda n: usage.record(
            ws, "apollo", "bulk_match", n, "credits", search_id=search_id
        ),
    )
    found = {
        (p.get("contact") or {}).get("apollo_id"): p for p in parsed if p.get("contact")
    }

    done = no_email = mismatch = 0
    for pid, row in by_apollo.items():
        custom = dict(row.get("custom") or {})
        pair = found.get(pid)
        contact = (pair or {}).get("contact") or {}
        email = contact.get("email")
        if not email or classify_email(email) == "generic":
            custom["reveal"] = "no_email"
            sb().table("contacts").update({"custom": custom}).eq("id", row["id"]).execute()
            no_email += 1
            continue
        org_website = ((pair or {}).get("business") or {}).get("website")
        if not _same_company(biz_domain.get(row["business_id"]), org_website, email):
            custom["reveal"] = "domain_mismatch"
            sb().table("contacts").update({"custom": custom}).eq("id", row["id"]).execute()
            mismatch += 1
            continue
        custom["reveal"] = "done"
        custom["apollo"] = (contact.get("custom") or {}).get("apollo")
        sb().table("contacts").update(
            {
                "email": email,
                "email_type": classify_email(email),
                "email_verification_status": contact.get("email_verification_status"),
                "full_name": contact.get("full_name"),
                "last_name": contact.get("last_name"),
                "seniority": contact.get("seniority"),
                "department": contact.get("department"),
                "linkedin": contact.get("linkedin"),
                "custom": custom,
            }
        ).eq("id", row["id"]).execute()
        done += 1
    if done:
        enqueue(ws, "verify_emails", {"search_id": search_id})
    log.info(
        "reveal_emails %s: %s freigeschaltet, %s ohne Adresse, %s andere Firma.",
        search_id,
        done,
        no_email,
        mismatch,
    )
