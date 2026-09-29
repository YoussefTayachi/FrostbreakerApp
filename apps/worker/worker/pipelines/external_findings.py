"""Personen-Befund von aussen pruefen: Claude mit Aside recherchiert, wir pruefen.

Seit 2026-09-29 (Youssef: "hyperpersonalisierte Emails komplett ohne
OpenAI"). Bei Listen mit filters.person_findings_mode = "claude" recherchiert
nicht der Worker per OpenAI-Websuche, sondern eine Claude-Code-Sitzung auf
Youssefs Rechner: sie oeffnet Website und LinkedIn im Aside-Browser, waehlt
den Fund, schreibt die sieben Schnipsel und liefert sie ueber das
Frostbreaker-MCP (set_person_findings) ab. Das Abo laeuft nur dort, nicht auf
Railway.

Dieser Job ist die zweite Haelfte: dieselben Netze wie beim OpenAI-Weg
(why_unusable, validate_snippets mit Verbotswoertern, erfundenen Zahlen,
Lob, Behauptungen ueber das Setup), ohne jeden Modellaufruf. Dazu eine
Pruefung, die der OpenAI-Weg nicht hat: bei Quellen ausserhalb von LinkedIn
wird die Seite per HTTP geladen und nachgesehen, ob das woertliche Zitat
dort steht. Kostet nichts und faengt erfundene Zitate.

Nutzlast: {"contact_id": ...}. Erwartet Status 'submitted'; alles andere
endet still (jemand hat inzwischen neu abgeliefert oder zurueckgesetzt).
"""

from __future__ import annotations

import html
import logging
import re
import time
from datetime import datetime, timezone

import httpx

from worker.db import sb
from worker.pipelines import personalize
from worker.pipelines.person_finding import (
    COMPANY_SITE,
    FALLBACK_ANGLE,
    _cap,
    _lade_business,
    canonical_linkedin,
    is_linkedin_host,
    is_trivial,
    known_facts,
    load_offer,
    offer_block,
    own_brand_words,
    person_banned_words,
    person_name_words,
    platform_label,
    resolve_anchor,
    source_host,
    touches_private,
    validate_snippets,
    why_unusable,
)
from worker.search_state import search_filters, search_is_deleted

log = logging.getLogger(__name__)

MODE_CLAUDE = "claude"
PROVENANCE_MODEL = "claude-aside"

CONTACT_COLUMNS = (
    "id, workspace_id, business_id, full_name, first_name, last_name, title, seniority, "
    "department, linkedin, email, custom, created_at, person_finding_status, "
    "person_snippets, person_finding_source"
)

# Wie viel vom Zitat auf der Seite stehen muss. Nicht das ganze: Seiten
# setzen Zeilenumbrueche, typografische Anfuehrungszeichen und gekuerzte
# Absaetze anders als die Abschrift.
QUOTE_PROBE_CHARS = 60


def is_claude_mode(filters: dict | None) -> bool:
    return str((filters or {}).get("person_findings_mode") or "") == MODE_CLAUDE


def _normalize(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(
        r"<script.*?</script>|<style.*?</style>", " ", text, flags=re.DOTALL | re.IGNORECASE
    )
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"[^\w' ]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def quote_probe(verbatim: str) -> str:
    """Der Anfang des Zitats in der Form, in der er auf der Seite gesucht wird."""
    norm = _normalize(verbatim)
    if len(norm) <= QUOTE_PROBE_CHARS:
        return norm
    cut = norm[:QUOTE_PROBE_CHARS]
    return cut.rsplit(" ", 1)[0] if " " in cut else cut


def quote_on_page(verbatim: str, page_html: str) -> bool:
    probe = quote_probe(verbatim)
    return bool(probe) and probe in _normalize(page_html)


def check_quote(url: str | None, verbatim: str | None) -> str:
    """'verified', 'not_found', 'fetch_failed', 'linkedin' oder 'no_quote'.

    LinkedIn wird nicht geladen: ohne Login liefert es eine Anmeldeseite, und
    mit Login waere es genau das automatisierte Abrufen, das wir vermeiden.
    Dort gilt, was Claude im eingeloggten Browser gesehen hat.
    """
    if not (verbatim or "").strip():
        return "no_quote"
    host = source_host(url)
    if host is None:
        return "fetch_failed"
    if is_linkedin_host(host):
        return "linkedin"
    # Zwei Versuche. Am 2026-09-29 meldete der erste Abruf von xymogen.com
    # vom Railway-Worker "nicht gefunden", ein zweiter Minuten spaeter
    # "gefunden", lokal stand der Satz ebenfalls im HTML. Ein einzelner
    # Ausreisser soll keinen echten Fund in die Pruefung schicken.
    ergebnis = "fetch_failed"
    for versuch in range(2):
        if versuch:
            time.sleep(3)
        try:
            resp = httpx.get(
                url or "",
                timeout=15.0,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (Frostbreaker quote check)"},
            )
        except httpx.HTTPError:
            continue
        if resp.status_code >= 400:
            continue
        if quote_on_page(verbatim or "", resp.text):
            return "verified"
        ergebnis = "not_found"
    return ergebnis


def finding_problem(finding: dict, contact: dict) -> str | None:
    """Warum ein abgelieferter Fund nicht taugt, oder None.

    Die Firmenwebsite setzt im OpenAI-Weg nur der Code (company_fallback),
    darum kennt why_unusable sie nicht. Hier darf Claude sie liefern; dafuer
    gelten die inhaltlichen Netze (leer, privat, trivial) trotzdem.
    """
    if finding.get("source_kind") == COMPANY_SITE:
        if not (finding.get("claim") or "").strip():
            return "claim_empty"
        if touches_private(finding):
            return "private"
        if is_trivial(finding):
            return "trivial"
        return None
    return why_unusable(finding, contact)


def run(job: dict) -> None:
    contact_id = (job.get("payload") or {}).get("contact_id")
    if not contact_id:
        return
    rows = (
        sb().table("contacts").select(CONTACT_COLUMNS).eq("id", contact_id).limit(1).execute().data
    )
    if not rows:
        return
    contact = rows[0]
    if contact.get("person_finding_status") != "submitted":
        return
    ws = contact["workspace_id"]
    biz = _lade_business(contact["business_id"])
    if not biz or search_is_deleted(biz):
        return
    filters = search_filters(biz)

    submitted = dict(contact.get("person_finding_source") or {})
    raw_snips = dict(contact.get("person_snippets") or {})
    contact["_business_name"] = biz.get("name")

    finding = {
        "angle": submitted.get("angle") or FALLBACK_ANGLE,
        "claim": submitted.get("claim") or "",
        "verbatim": submitted.get("verbatim") or "",
        "source_kind": submitted.get("source_kind"),
        "source_url": submitted.get("source_url") or "",
        "age_months": submitted.get("age_months"),
        "identity_anchor": submitted.get("identity_anchor") or "company_and_role",
        "identity_evidence": submitted.get("identity_evidence") or "",
    }
    grund = finding_problem(finding, contact)
    if finding["source_kind"] == COMPANY_SITE:
        anchor = COMPANY_SITE
    else:
        anchor = resolve_anchor(
            finding, canonical_linkedin(contact.get("linkedin")), biz.get("name")
        )
    zitat = check_quote(finding["source_url"], finding["verbatim"])

    cfg = personalize.load_agent_config(ws)
    offer = load_offer(ws)
    banned = (
        person_banned_words(cfg["banned_words"], cfg["language"])
        + own_brand_words(offer)
        + person_name_words(contact)
    )
    material = [finding["claim"], finding["verbatim"], known_facts(contact), offer_block(offer)]
    platform = platform_label(finding, cfg["language"])
    snips, problems = validate_snippets(
        raw_snips,
        platform,
        banned,
        material,
        compact=bool(filters.get("person_snippets_compact")),
    )

    review_reason = None
    if grund:
        review_reason = f"finding:{grund}"
    elif zitat == "not_found":
        review_reason = "quote_not_found"
    elif anchor == "none":
        review_reason = "unverified_anchor"
    elif problems:
        review_reason = "rules"

    provenienz = {
        **{k: v for k, v in submitted.items() if k not in ("snippet_problems", "review_reason")},
        "claim": _cap(finding["claim"]),
        "verbatim": _cap(finding["verbatim"]),
        "source_url": _cap(finding["source_url"], 500),
        "identity_anchor": anchor,
        "quote_check": zitat,
        "finding_problem": grund,
        "review_reason": review_reason,
        "snippet_problems": problems or None,
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "model": PROVENANCE_MODEL,
    }
    # person_finding traegt den ersten Satz: hasPersonFinding im Web verlangt
    # einen Text, und der Opener ist der Satz ueber die Person.
    absatz = snips.get("opener") or finding["claim"]
    sb().table("contacts").update(
        {
            "person_finding": absatz,
            "person_snippets": snips,
            "person_finding_needs_review": review_reason is not None,
            "person_finding_status": "found",
            "person_finding_source": provenienz,
        }
    ).eq("id", contact_id).eq("person_finding_status", "submitted").execute()
    log.info("Befund von aussen geprueft: %s review=%s zitat=%s", contact_id, review_reason, zitat)
