"""Der write_website_finding-Job: aus einem Befund wird ein eigener Satz.

Der Schwerpunkt liegt auf den beiden Stellen, an denen dieser Job Geld kosten
oder eine kaputte Mail erzeugen kann: kein Befund heisst kein Modellaufruf,
und ein zweites Zustellen desselben Jobs heisst kein zweiter Aufruf.
"""
from datetime import datetime, timedelta, timezone

import pytest

from worker.pipelines import personalize, website_finding


def business(**over) -> dict:
    row = {
        "id": "b-1",
        "name": "Muster GmbH",
        "website": "https://muster.de",
        "search_id": "s-1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "website_audit_status": "ok",
        "website_finding": None,
        "website_audit": {
            "findings": [
                {"code": "site_builder", "evidence": "Wix.com Website Builder"},
                {"code": "no_https", "evidence": "http://muster.de/"},
            ]
        },
    }
    row.update(over)
    return row


# ── Das Material ───────────────────────────────────────────────────────────


def test_material_nennt_tatsache_beleg_und_folge():
    context = website_finding.finding_context(business())
    assert "Gemessener Mangel:" in context
    assert "HTTPS" in context  # der ranghoechste Befund, nicht der erste in der Liste
    assert "http://muster.de/" in context
    assert "Nicht sicher" in context  # die Folge
    assert "Wix" not in context  # genau EIN Befund, nie eine Liste


def test_ohne_befund_kein_material():
    assert website_finding.finding_context(business(website_audit={"findings": []})) is None
    assert website_finding.finding_context(business(website_audit={})) is None
    assert website_finding.finding_context(business(website_audit=None)) is None


def test_beleg_darf_fehlen():
    context = website_finding.finding_context(
        business(website_audit={"findings": [{"code": "no_viewport"}]})
    )
    assert "gefunden" not in context
    # FACT_DE ist bewusst ohne Umlaute geschrieben (siehe website_audit.py).
    assert "Mobilgeraete" in context


def test_code_ohne_hinterlegten_text_liefert_nichts():
    """Lieber kein Satz als ein halber. Ein unbekannter Code kann nur aus einer
    aelteren Fassung des Katalogs stammen."""
    audit = {"findings": [{"code": "no_https"}]}
    frueher = website_finding.website_audit.FACT_DE.pop("no_https")
    try:
        assert website_finding.finding_context(business(website_audit=audit)) is None
    finally:
        website_finding.website_audit.FACT_DE["no_https"] = frueher


# ── Das Warten auf den Check ───────────────────────────────────────────────


def test_wartet_auf_den_laufenden_check():
    assert website_finding.audit_pending(business(website_audit_status="pending")) is True


def test_wartet_nicht_ewig():
    """Stirbt der check_website-Job, darf dieser Job nicht mit ihm haengen
    bleiben. Lieber ohne Satz als eine Lead-Liste, die steht."""
    alt = datetime.now(timezone.utc) - website_finding.AUDIT_WAIT_LIMIT - timedelta(minutes=1)
    biz = business(website_audit_status="pending", created_at=alt.isoformat())
    assert website_finding.audit_pending(biz) is False


def test_wartet_nicht_wenn_niemand_prueft():
    """Status null bei vorhandener Website (Zeilen vor Migration 0102, von Hand
    angelegte Firmen): es ist kein Job unterwegs, also gibt es nichts zu
    erwarten."""
    assert website_finding.audit_pending(business(website_audit_status=None)) is False


def test_unlesbares_datum_gilt_als_frisch():
    biz = business(website_audit_status="pending", created_at="kein Datum")
    assert website_finding.audit_pending(biz) is True


# ── Die Vorgaben ───────────────────────────────────────────────────────────


class _Row:
    def __init__(self, data):
        self.data = data


class _Workspaces:
    def __init__(self, row):
        self._row = row

    def table(self, _name):
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def single(self):
        return self

    def execute(self):
        return _Row(self._row)


def test_ohne_eigenen_prompt_gilt_der_standard_in_der_workspace_sprache(monkeypatch):
    monkeypatch.setattr(
        website_finding, "sb", lambda: _Workspaces({"personalization_language": "en"})
    )
    cfg = website_finding.load_config("ws-1")
    assert cfg["system_prompt"].startswith(website_finding.DEFAULT_FINDING_PROMPT_EN)
    assert cfg["language"] == "en"
    # Sprache und verbotene Zeichen sind die des Workspaces, nicht eigene.
    assert cfg["banned_words"] == personalize.DEFAULT_BANNED_WORDS


def test_eigener_prompt_schlaegt_den_standard(monkeypatch):
    monkeypatch.setattr(
        website_finding,
        "sb",
        lambda: _Workspaces(
            {
                "website_finding_prompt": "  Schreib einen Satz.  ",
                "personalization_banned_words": "—, sehr geehrte",
            }
        ),
    )
    cfg = website_finding.load_config("ws-1")
    assert cfg["system_prompt"] == "Schreib einen Satz."
    assert cfg["banned_words"] == ["—", "sehr geehrte"]


def test_die_harten_vorgaben_reden_nicht_vom_icebreaker():
    """constraint_block wird mit personalize geteilt; er darf hier nicht
    'icebreaker' sagen, sonst schreibt das Modell den falschen Text."""
    block = personalize.constraint_block(
        website_finding.FINDING_MAX_WORDS, ["—"], "de", subject="sentence"
    )
    assert "Write the sentence in German" in block
    assert "icebreaker" not in block
    assert f"Maximum {website_finding.FINDING_MAX_WORDS} words" in block


# ── Der Job ────────────────────────────────────────────────────────────────


class _Businesses:
    """Genug Supabase-Nachbau fuer select().eq().single().execute() und
    update().eq().execute(). Merkt sich, was geschrieben wurde."""

    def __init__(self, row, writes):
        self._row = row
        self._writes = writes
        self._pending = None

    def table(self, _name):
        return self

    def select(self, *_a, **_k):
        return self

    def update(self, payload):
        self._pending = payload
        return self

    def eq(self, *_a, **_k):
        return self

    def single(self):
        return self

    def execute(self):
        if self._pending is not None:
            self._writes.append(self._pending)
            self._pending = None
            return _Row(None)
        return _Row(self._row)


def _lauf(monkeypatch, row, *, antworten=None, force=False):
    """Den Job mit einem festen Datensatz laufen lassen. Gibt die Schreibvorgaenge
    und die tatsaechlich gestellten Modellanfragen zurueck."""
    writes: list[dict] = []
    aufrufe: list[dict] = []
    antworten = list(antworten or ["Deine Website läuft ohne HTTPS."])

    monkeypatch.setattr(website_finding, "sb", lambda: _Businesses(row, writes))
    monkeypatch.setattr(
        website_finding,
        "load_config",
        lambda _ws: {"system_prompt": "P", "banned_words": ["—"], "language": "de"},
    )
    monkeypatch.setitem(
        __import__("sys").modules,
        "worker.keys",
        type("M", (), {"get_api_key": staticmethod(lambda *a, **k: "sk-test")}),
    )

    def fake_generate(name, context, key, prompt, **kw):
        aufrufe.append({"name": name, "context": context, "prompt": prompt, **kw})
        return antworten.pop(0)

    monkeypatch.setattr(personalize, "generate", fake_generate)
    website_finding.run(
        {"workspace_id": "ws-1", "payload": {"business_id": "b-1", "force": force}}
    )
    return writes, aufrufe


def test_schreibt_den_satz(monkeypatch):
    writes, aufrufe = _lauf(monkeypatch, business())
    assert writes == [
        {"website_finding": "Deine Website läuft ohne HTTPS.", "website_finding_needs_review": False}
    ]
    assert len(aufrufe) == 1
    assert aufrufe[0]["operation"] == "website_finding"
    # Die Icebreaker-Beispiele wuerden hier das falsche Muster beibringen.
    assert "examples" not in aufrufe[0]


def test_ohne_befund_kein_modellaufruf_und_kein_schreibvorgang(monkeypatch):
    """DER FALL, DER HAEUFIG IST. Leer ist das Ergebnis, nicht ein Fehler, und
    ein Rueckfallsatz waere eine erfundene Tatsachenbehauptung."""
    writes, aufrufe = _lauf(monkeypatch, business(website_audit={"findings": []}))
    assert writes == []
    assert aufrufe == []


def test_zweite_zustellung_kostet_nichts(monkeypatch):
    writes, aufrufe = _lauf(monkeypatch, business(website_finding="Steht schon da."))
    assert writes == []
    assert aufrufe == []


def test_force_erzeugt_neu(monkeypatch):
    writes, aufrufe = _lauf(monkeypatch, business(website_finding="Steht schon da."), force=True)
    assert len(aufrufe) == 1
    assert writes[0]["website_finding"] == "Deine Website läuft ohne HTTPS."


def test_geloeschte_suche_kostet_nichts(monkeypatch):
    writes, aufrufe = _lauf(
        monkeypatch, business(searches={"deleted_at": "2026-08-01T00:00:00+00:00"})
    )
    assert writes == []
    assert aufrufe == []


def test_laufender_check_stellt_zurueck(monkeypatch):
    with pytest.raises(personalize.NotReadyYet):
        _lauf(monkeypatch, business(website_audit_status="pending"))


def test_zu_langer_satz_bekommt_genau_eine_korrekturrunde(monkeypatch):
    lang = " ".join(["Wort"] * (website_finding.FINDING_MAX_WORDS + 5))
    writes, aufrufe = _lauf(monkeypatch, business(), antworten=[lang, "Kurz genug."])
    assert len(aufrufe) == 2
    assert "zu lang" in aufrufe[1]["correction"]
    assert writes[0]["website_finding_needs_review"] is False


def test_zweiter_versuch_daneben_wird_markiert(monkeypatch):
    lang = " ".join(["Wort"] * (website_finding.FINDING_MAX_WORDS + 5))
    writes, _ = _lauf(monkeypatch, business(), antworten=[lang, lang])
    assert writes[0]["website_finding_needs_review"] is True
