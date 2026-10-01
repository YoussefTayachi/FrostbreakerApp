"""Firmenname -> Domain, ohne Credits.

Anlass (2026-10-01): Apollos kostenlose Personensuche liefert je Person nur
Vorname, Titel und den Firmennamen, aber keine Domain (siehe
apollo.parse_apollo_person). Bisher kam die Domain erst mit dem bezahlten
bulk_match. Fuer den Modus "erst pruefen, dann freischalten" muss die Website
aber VOR dem Bezahlen bekannt sein, sonst kann die Aside-Recherche nicht
entscheiden, ob die Firma ueberhaupt passt.

Quelle ist Clearbits oeffentliche Autovervollstaendigung (ohne Schluessel).
Gemessen am 2026-10-01 an 50 Firmen aus einer echten retaiyn-Suche: 39 mit
Treffer, aber mehrere falsch (FATCO -> fatcoupon.com, Root'd -> rootdown.us).
Deshalb gilt ein Treffer nur, wenn der normalisierte Name exakt passt. Lieber
eine Firma auslassen (kostet nichts) als die falsche Website recherchieren und
danach fuer die falsche Firma bezahlen.
"""

from __future__ import annotations

import logging

import httpx

from worker.pipelines.apollo import normalize_company

log = logging.getLogger(__name__)

AUTOCOMPLETE_URL = "https://autocomplete.clearbit.com/v1/companies/suggest"


def pick_domain(name: str, hits: list[dict]) -> str | None:
    """Den Treffer waehlen, dessen Name exakt zum gesuchten passt (pure, testbar)."""
    target = normalize_company(name)
    if not target:
        return None
    for hit in hits or []:
        domain = (hit.get("domain") or "").strip().lower()
        if domain and normalize_company(hit.get("name")) == target:
            return domain
    return None


def lookup_domain(name: str | None) -> str | None:
    """Domain zu einem Firmennamen oder None. Fehler zaehlen als 'unbekannt'."""
    if not name:
        return None
    try:
        r = httpx.get(AUTOCOMPLETE_URL, params={"query": name}, timeout=10)
        if r.status_code != 200:
            return None
        return pick_domain(name, r.json() or [])
    except Exception as exc:  # noqa: BLE001 (eine fehlende Domain ist kein Fehler der Suche)
        log.info("Domain-Suche fuer %r fehlgeschlagen: %s", name, exc)
        return None
