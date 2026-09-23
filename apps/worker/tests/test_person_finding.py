"""Der write_person_finding-Job: aus oeffentlichen Aeusserungen wird ein Absatz.

Schwerpunkt wie bei test_website_finding: die Stellen, an denen dieser Job
Geld kosten oder eine falsche Mail erzeugen kann. Kein Anker heisst kein
Aufruf, ein verlorener Claim heisst kein Aufruf, ein leerer Fund heisst kein
zweiter Aufruf, und nichts bleibt auf 'running' stehen.
"""

from datetime import datetime, timedelta, timezone

import pytest

from worker import usage
from worker.pipelines import person_finding as pf
from worker.pipelines import personalize

# ── Nachbau von genug Supabase fuer diesen Job ─────────────────────────────


class _Row:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.filters = []
        self._update = None
        self._limit = None

    def select(self, *_a, **_k):
        return self

    def update(self, values):
        self._update = values
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def is_(self, col, val):
        self.filters.append(("is", col, val))
        return self

    @property
    def not_(self):
        # supabase-py: .not_.is_("spalte", "null") heisst "ist nicht null".
        return _Not(self)

    def in_(self, col, vals):
        self.filters.append(("in", col, list(vals)))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def single(self):
        return self

    def _match(self, row):
        for kind, col, val in self.filters:
            v = row.get(col)
            if kind == "eq" and v != val:
                return False
            if kind == "is" and val in ("null", None) and v is not None:
                return False
            if kind == "not_is" and val in ("null", None) and v is None:
                return False
            if kind == "in" and v not in val:
                return False
        return True

    def execute(self):
        rows = [r for r in self.db.tables.get(self.table, []) if self._match(r)]
        if self._update is not None:
            for r in rows:
                r.update(self._update)
            self.db.updates.append((self.table, dict(self._update), [r["id"] for r in rows]))
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Row(rows)


class _Not:
    def __init__(self, query):
        self._q = query

    def is_(self, col, val):
        self._q.filters.append(("not_is", col, val))
        return self._q


class _Rpc:
    def __init__(self, data):
        self._data = data

    def execute(self):
        return _Row(self._data)


class _Db:
    def __init__(self, tables, rpc=None):
        self.tables = tables
        self.updates = []
        self.rpc_calls = []
        self._rpc = rpc

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return _Rpc(self._rpc(params) if self._rpc else [])


def _search(flag=True, deleted=None, source="apollo"):
    return {"deleted_at": deleted, "source": source, "filters": {"person_findings": flag}}


def business(**over):
    row = {
        "id": "b-1",
        "workspace_id": "ws-1",
        "name": "Ancient + Brave",
        "website": "https://ancientandbrave.earth",
        "search_id": "s-1",
        "searches": _search(),
    }
    row.update(over)
    return row


def contact(**over):
    row = {
        "id": "c-1",
        "workspace_id": "ws-1",
        "business_id": "b-1",
        "full_name": "Kate Prince",
        "first_name": "Kate",
        "title": "Founder & CEO",
        "seniority": "founder",
        "department": "c_suite",
        "email": "kate@example.com",
        "linkedin": "https://uk.linkedin.com/in/Kate-Prince-5aa8283b/",
        "custom": {"apollo": {"headline": "Founder", "employment_history": []}},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "person_finding": None,
        "person_finding_status": "pending",
    }
    row.update(over)
    return row


def finding(**over):
    row = {
        "angle": "statement",
        "claim": "Trust is the currency in a noisy industry.",
        "source_kind": "own_post",
        "source_url": "https://www.linkedin.com/posts/kate-prince-5aa8283b_forbes-activity-123-abc",
        "age_months": 3,
        "verbatim": "trust has become one of the most valuable currencies",
        "identity_anchor": "linkedin_url",
        "identity_evidence": "",
    }
    row.update(over)
    return row


def job(payload, attempts=1, max_attempts=3):
    return {
        "workspace_id": "ws-1",
        "payload": payload,
        "attempts": attempts,
        "max_attempts": max_attempts,
    }


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setattr(
        personalize,
        "load_agent_config",
        lambda ws: {
            "system_prompt": "x",
            "source": "both",
            "max_words": 25,
            "banned_words": ["—", "I saw"],
            "language": "en",
        },
    )
    monkeypatch.setattr(pf, "get_api_key", lambda ws, provider: "sk-test")
    monkeypatch.setattr(
        pf, "load_offer", lambda ws: {"problem": "email no longer reaches the second order"}
    )
    monkeypatch.setattr(usage, "record", lambda *a, **k: None)
    monkeypatch.setattr(usage, "record_openai", lambda *a, **k: None)


# ── LinkedIn-URLs ──────────────────────────────────────────────────────────


def test_canonical_linkedin_akzeptiert_nur_personenprofile():
    assert (
        pf.canonical_linkedin("https://www.linkedin.com/in/Kate-Prince-5aa8283b/")
        == "kate-prince-5aa8283b"
    )
    assert (
        pf.canonical_linkedin("uk.linkedin.com/in/kate-prince-5aa8283b?trk=x")
        == "kate-prince-5aa8283b"
    )
    assert (
        pf.canonical_linkedin("http://www.linkedin.com/in/dean-smith-2a514934")
        == "dean-smith-2a514934"
    )
    assert pf.canonical_linkedin("https://www.linkedin.com/company/ancientandbrave") is None
    assert pf.canonical_linkedin("https://evil.example/in/kate-prince") is None
    assert pf.canonical_linkedin("https://linkedin.com.evil.example/in/kate") is None
    assert pf.canonical_linkedin("") is None
    assert pf.canonical_linkedin(None) is None


def test_beitrags_autor_wird_grammatisch_geparst_nicht_als_teilstring():
    url = "https://www.linkedin.com/posts/kate-prince-5aa8283b_let-me-show-you-activity-7392_c01b"
    assert pf.linkedin_post_author(url) == "kate-prince-5aa8283b"
    # Ein fremder Beitrag, dessen Pfad den Ziel-Slug nur enthaelt.
    fremd = "https://www.linkedin.com/posts/someone-else_kate-prince-5aa8283b-activity-1_x"
    assert pf.linkedin_post_author(fremd) == "someone-else"
    assert pf.linkedin_post_author("https://www.linkedin.com/pulse/title-kate-prince") is None
    assert pf.linkedin_post_author("https://www.linkedin.com/in/kate-prince-5aa8283b") is None


def test_quellenart_host_matrix():
    assert pf.source_allowed("own_post", "https://www.linkedin.com/posts/x_y") is True
    assert pf.source_allowed("own_post", "https://techpixies.com/episode280/") is False
    assert pf.source_allowed("podcast", "https://techpixies.com/episode280/") is True
    assert pf.source_allowed("podcast", "https://www.linkedin.com/posts/x_y") is False
    assert pf.source_allowed("article", "https://forbes.com/x") is True
    assert pf.source_allowed("article", "https://www.linkedin.com/pulse/x") is True
    assert pf.source_allowed("profile", "not a url") is False


# ── Auswahl ────────────────────────────────────────────────────────────────


def test_eigener_beitrag_mit_autoren_slug_ist_gebunden():
    best = pf.best_finding([finding()], contact())
    assert best is not None
    assert best["anchor"] == "linkedin_url"
    assert best["review_reason"] is None


def test_fremder_beitrag_mit_beleg_geht_in_die_pruefung():
    f = finding(
        source_url="https://www.linkedin.com/posts/someone-else_activity-1_x",
        identity_evidence="Kate Prince, founder of Ancient + Brave, said",
    )
    best = pf.best_finding([f], contact(_business_name="Ancient + Brave"))
    assert best["anchor"] == "company_and_role"
    assert best["review_reason"] == "unverified_anchor"


def test_fremder_beitrag_ohne_beleg_faellt_durch():
    f = finding(
        source_url="https://www.linkedin.com/posts/someone-else_activity-1_x", identity_evidence=""
    )
    assert pf.best_finding([f], contact()) is None


def test_profil_nur_bei_slug_gleichheit():
    passt = finding(
        angle="background",
        source_kind="profile",
        source_url="https://www.linkedin.com/in/kate-prince-5aa8283b",
        age_months=-1,
    )
    fremd = finding(
        angle="background",
        source_kind="profile",
        source_url="https://www.linkedin.com/in/dean-smith-2a514934",
        age_months=-1,
    )
    assert pf.best_finding([passt], contact())["anchor"] == "linkedin_url"
    assert pf.best_finding([fremd], contact()) is None


def test_altersgrenze_je_typ():
    alt = finding(age_months=24)
    undatiert = finding(age_months=-1)
    zeitlos = finding(
        angle="side_switch",
        source_kind="profile",
        source_url="https://www.linkedin.com/in/kate-prince-5aa8283b",
        age_months=-1,
    )
    assert pf.best_finding([alt], contact()) is None
    assert pf.best_finding([undatiert], contact()) is None
    assert pf.best_finding([zeitlos], contact())["angle"] == "side_switch"


def test_frischer_wechsel_braucht_frische_apollo_kopie():
    f = finding(
        angle="fresh_move",
        source_kind="profile",
        source_url="https://www.linkedin.com/in/kate-prince-5aa8283b",
        age_months=2,
    )
    frisch = contact(created_at=datetime.now(timezone.utc).isoformat())
    alt = contact(created_at=(datetime.now(timezone.utc) - timedelta(days=200)).isoformat())
    assert pf.best_finding([f], frisch) is not None
    assert pf.best_finding([f], alt) is None


def test_rangfolge_aussage_vor_werdegang_und_juenger_bei_gleichstand():
    werdegang = finding(
        angle="background",
        source_kind="profile",
        source_url="https://www.linkedin.com/in/kate-prince-5aa8283b",
        age_months=-1,
    )
    aussage_alt = finding(age_months=9)
    aussage_neu = finding(age_months=2, claim="newer")
    best = pf.best_finding([werdegang, aussage_alt, aussage_neu], contact())
    assert best["claim"] == "newer"


def test_unzulaessige_host_kombination_faellt_durch():
    f = finding(
        source_kind="podcast", source_url="https://www.linkedin.com/posts/kate-prince-5aa8283b_x_y"
    )
    assert pf.best_finding([f], contact()) is None


# ── Prompt-Material ────────────────────────────────────────────────────────


def test_verbotsliste_nimmt_nur_striche_aus_dem_workspace():
    banned = pf.person_banned_words(["—", "--", "I saw", "I noticed"], "en")
    assert "—" in banned and "--" in banned
    assert "I saw" not in banned and "I noticed" not in banned
    assert "i think" in banned and "congratulations" in banned
    de = pf.person_banned_words(["—"], "de")
    assert "vielleicht" in de and "i think" not in de


def test_quellenlabel_kommt_aus_dem_code():
    assert pf.source_label(finding(), "en") == "I just read your LinkedIn post where you"
    pod = finding(source_kind="podcast", source_url="https://www.techpixies.com/episode280/")
    assert (
        pf.source_label(pod, "en")
        == "I just listened to your episode on the techpixies.com podcast where you"
    )
    prof = finding(
        source_kind="profile", source_url="https://www.linkedin.com/in/kate-prince-5aa8283b"
    )
    assert pf.source_label(prof, "de") == "Ich habe gerade auf deinem LinkedIn-Profil gelesen, dass"


def test_bekannte_fakten_werden_gekappt():
    lang = "x" * 1000
    c = contact(
        custom={
            "apollo": {
                "headline": lang,
                "employment_history": [
                    {
                        "organization_name": "Org",
                        "title": lang,
                        "start_date": "2020",
                        "current": True,
                    }
                ]
                * 30,
            }
        }
    )
    text = pf.known_facts(c)
    assert lang not in text
    assert text.count("  - ") == pf.MAX_EMPLOYMENT_ENTRIES
    assert "current" in text


def test_schreibprompt_traegt_den_typblock():
    p = pf.write_prompt("en", "side_switch")
    assert p.startswith(pf.WRITE_BASE_EN)
    assert "switch of sides" in p
    assert "Angle: a pattern" not in p
    assert "deutet" in pf.write_prompt("de", "statement")


def test_kontext_grenzt_daten_ab_und_beginnt_mit_dem_label():
    fund = dict(finding(), anchor="linkedin_url")
    ctx = pf.person_context(contact(), business(), fund, {"problem": "p", "offering": "o"}, "en")
    assert ctx.startswith(
        "Source label, use it word for word to open: I just read your LinkedIn post where you"
    )
    assert "<finding>" in ctx and "</finding>" in ctx
    assert "<known_facts>" in ctx and "<offer>" in ctx
    assert ctx.index("<finding>") < ctx.index("<offer>")


# ── Auffaechern ────────────────────────────────────────────────────────────


def test_auffaechern_ohne_flag_tut_nichts(monkeypatch):
    db = _Db({"businesses": [business(searches=_search(flag=False))]})
    monkeypatch.setattr(pf, "sb", lambda: db)
    monkeypatch.setattr(pf, "enqueue_many", lambda *a, **k: pytest.fail("darf nicht einreihen"))
    pf.run(job({"business_id": "b-1"}))
    assert db.rpc_calls == []


def test_auffaechern_nur_mit_anker_und_nur_geclaimte(monkeypatch):
    rows = [
        contact(id="c-1", person_finding_status=None),
        contact(id="c-2", person_finding_status=None, linkedin=None),
        contact(id="c-3", person_finding_status=None, email=None),
        contact(id="c-4", person_finding_status=None),
    ]
    db = _Db({"businesses": [business()], "contacts": rows}, rpc=lambda p: ["c-1"])
    monkeypatch.setattr(pf, "sb", lambda: db)
    eingereiht = []
    monkeypatch.setattr(
        pf, "enqueue_many", lambda ws, typ, payloads: eingereiht.append((typ, payloads))
    )
    pf.run(job({"business_id": "b-1"}))
    # Ohne Anker sofort 'none', ohne Kosten.
    assert {r["id"]: r["person_finding_status"] for r in rows}["c-2"] == "none"
    assert {r["id"]: r["person_finding_status"] for r in rows}["c-3"] == "none"
    # Der Claim geht nur ueber die Kontakte mit Anker, unter dem Deckel.
    name, params = db.rpc_calls[0]
    assert name == "claim_person_finding_contacts"
    assert sorted(params["p_contact_ids"]) == ["c-1", "c-4"]
    assert params["p_limit"] == pf.PERSON_FINDING_MAX_PER_SEARCH
    # Eingereiht wird nur, was die Funktion zurueckgab.
    assert eingereiht == [("write_person_finding", [{"contact_id": "c-1"}])]


def test_auffaechern_setzt_bei_enqueue_fehler_zurueck(monkeypatch):
    rows = [contact(id="c-1", person_finding_status=None)]
    db = _Db({"businesses": [business()], "contacts": rows}, rpc=lambda p: ["c-1"])
    monkeypatch.setattr(pf, "sb", lambda: db)

    def kaputt(*a, **k):
        raise RuntimeError("queue weg")

    monkeypatch.setattr(pf, "enqueue_many", kaputt)
    with pytest.raises(RuntimeError):
        pf.run(job({"business_id": "b-1"}))
    assert ("contacts", {"person_finding_status": None}, ["c-1"]) in db.updates


# ── Der Kontaktjob ─────────────────────────────────────────────────────────


GUTE_SCHNIPSEL = {
    "subjectLine": "collagen and second purchases",
    "opener": (
        "I just read your LinkedIn post where you said the Forbes feature doubled your traffic. "
        "That stuck with me, because for a collagen brand the real money sits in who buys twice."
    ),
    "whatTheySaid": "the Forbes feature doubling your traffic",
    "segments": (
        "You sell collagen on subscription, so your buyers already fall into groups that deserve "
        "different emails: the first-time buyer, the subscriber about to pause, the one-time "
        "buyer who never came back."
    ),
    "promise": (
        "We have the expertise to segment your buyers exactly along those lines and send each "
        "group the right email at the right moment, so they become reliable repeat buyers."
    ),
    "ctaTail": "the segments I'd build first for Ancient + Brave",
}


aufrufe_schnipsel: dict = {}


def _run_contact(monkeypatch, db, findings, text="Absatz.", research_raises=None, snippets=None):
    monkeypatch.setattr(pf, "sb", lambda: db)
    aufrufe = {"research": 0, "generate": 0}
    schnipsel_aufrufe = {"n": 0}

    def fake_snippets(*a, **k):
        schnipsel_aufrufe["n"] += 1
        return dict(snippets or GUTE_SCHNIPSEL)

    monkeypatch.setattr(pf, "write_snippets", fake_snippets)
    aufrufe_schnipsel[id(db)] = schnipsel_aufrufe

    def fake_research(*a, **k):
        aufrufe["research"] += 1
        if research_raises:
            raise research_raises
        return findings

    def fake_generate(*a, **k):
        aufrufe["generate"] += 1
        return text

    monkeypatch.setattr(pf, "research", fake_research)
    monkeypatch.setattr(personalize, "generate", fake_generate)
    return aufrufe


def test_vorhandener_text_kostet_nichts(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact(person_finding="schon da")]})
    aufrufe = _run_contact(monkeypatch, db, [finding()])
    pf.run(job({"contact_id": "c-1"}))
    assert aufrufe == {"research": 0, "generate": 0}


def test_papierkorb_setzt_zurueck_und_kostet_nichts(monkeypatch, cfg):
    db = _Db(
        {"businesses": [business(searches=_search(deleted="2026-09-01"))], "contacts": [contact()]}
    )
    aufrufe = _run_contact(monkeypatch, db, [finding()])
    pf.run(job({"contact_id": "c-1"}))
    assert aufrufe["research"] == 0
    assert db.tables["contacts"][0]["person_finding_status"] is None


def test_verlorener_claim_kostet_nichts(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact(person_finding_status="running")]})
    aufrufe = _run_contact(monkeypatch, db, [finding()])
    pf.run(job({"contact_id": "c-1"}))
    assert aufrufe["research"] == 0


def test_leerer_fund_ist_ein_ergebnis_ohne_zweiten_aufruf(monkeypatch, cfg):
    """Nur noch, wenn auch die Firma nichts hergibt: kein Name, keine
    Beschreibung. Sonst greift der Rueckfall (siehe unten)."""
    db = _Db({"businesses": [business(name="", company_summary=None)], "contacts": [contact()]})
    aufrufe = _run_contact(monkeypatch, db, [])
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe == {"research": 1, "generate": 0}
    assert row["person_finding_status"] == "none"
    assert row["person_finding"] is None
    assert row["person_finding_source"]["findings_returned"] == 0


def test_erfolg_schreibt_absatz_und_provenienz(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    aufrufe = _run_contact(
        monkeypatch, db, [finding()], text="On LinkedIn you wrote that trust is the currency."
    )
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe == {"research": 1, "generate": 1}
    assert row["person_finding_status"] == "found"
    assert row["person_finding"].startswith("On LinkedIn")
    assert row["person_finding_needs_review"] is False
    src = row["person_finding_source"]
    assert src["angle"] == "statement"
    assert src["identity_anchor"] == "linkedin_url"
    assert src["source_label"] == "I just read your LinkedIn post where you"
    assert src["review_reason"] is None


def test_unbestaetigte_bindung_geht_in_die_pruefung(monkeypatch, cfg):
    f = finding(
        source_kind="interview",
        source_url="https://techpixies.com/episode280/",
        identity_anchor="company_and_role",
        identity_evidence="Kate Prince, founder of Ancient + Brave",
    )
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    _run_contact(monkeypatch, db, [f])
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert row["person_finding_needs_review"] is True
    assert row["person_finding_source"]["review_reason"] == "unverified_anchor"


def test_regelverstoss_bekommt_korrekturrunde_und_pruefflag(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    zu_lang = " ".join(["wort"] * 130)
    aufrufe = _run_contact(monkeypatch, db, [finding()], text=zu_lang)
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe["generate"] == 1 + pf.CORRECTION_ROUNDS
    assert row["person_finding_needs_review"] is True
    assert row["person_finding_source"]["review_reason"] == "rules"


def test_fehler_geht_auf_pending_solange_die_queue_wiederholt(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    gezaehlt = []
    monkeypatch.setattr(usage, "record", lambda *a, **k: gezaehlt.append(a))
    _run_contact(monkeypatch, db, [], research_raises=RuntimeError("timeout"))
    with pytest.raises(RuntimeError):
        pf.run(job({"contact_id": "c-1"}, attempts=1, max_attempts=3))
    assert db.tables["contacts"][0]["person_finding_status"] == "pending"
    assert gezaehlt and gezaehlt[0][2] == "person_finding_research_failed"


def test_letzter_versuch_endet_auf_failed(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    _run_contact(monkeypatch, db, [], research_raises=RuntimeError("timeout"))
    with pytest.raises(RuntimeError):
        pf.run(job({"contact_id": "c-1"}, attempts=3, max_attempts=3))
    assert db.tables["contacts"][0]["person_finding_status"] == "failed"


def test_finaler_schreibzugriff_ueberschreibt_keinen_fremden_text(monkeypatch, cfg):
    """Zwischen Claim und Schreiben hat jemand von Hand geschrieben."""
    row = contact()
    db = _Db({"businesses": [business()], "contacts": [row]})

    def generate_und_mensch_schreibt(*a, **k):
        row["person_finding"] = "von Hand"
        return "vom Modell"

    monkeypatch.setattr(pf, "sb", lambda: db)
    monkeypatch.setattr(pf, "research", lambda *a, **k: [finding()])
    monkeypatch.setattr(personalize, "generate", generate_und_mensch_schreibt)
    monkeypatch.setattr(pf, "write_snippets", lambda *a, **k: dict(GUTE_SCHNIPSEL))
    pf.run(job({"contact_id": "c-1"}))
    assert row["person_finding"] == "von Hand"
    # Der bedingte Update traf keine Zeile; der Status folgt dem Text von Hand.
    assert row["person_finding_status"] == "found"


def test_die_harten_vorgaben_reden_vom_absatz():
    block = personalize.constraint_block(
        pf.PERSON_FINDING_MAX_WORDS, ["—"], "en", subject="paragraph"
    )
    assert f"Maximum {pf.PERSON_FINDING_MAX_WORDS} words" in block
    assert "icebreaker" not in block


# ── Nach dem Codex-Review des Diffs ────────────────────────────────────────


def test_linkedin_artikel_wird_nicht_als_eigener_beitrag_ausgegeben():
    art = finding(source_kind="article", source_url="https://www.linkedin.com/pulse/some-title")
    assert pf.source_label(art, "en") == "I just read your piece on linkedin.com where you"


def test_ohne_angebot_nur_teil_eins():
    p = pf.write_prompt("en", "statement", has_offer=False)
    assert "Write ONLY part 1" in p
    assert "Write ONLY part 1" not in pf.write_prompt("en", "statement", has_offer=True)


def test_vorhandener_text_setzt_status_auf_found(monkeypatch, cfg):
    row = contact(person_finding="von Hand", person_finding_status="pending")
    db = _Db({"businesses": [business()], "contacts": [row]})
    _run_contact(monkeypatch, db, [finding()])
    pf.run(job({"contact_id": "c-1"}))
    assert row["person_finding_status"] == "found"


def test_none_nur_bei_status_null(monkeypatch):
    """Der Kontakt stand schon auf pending (anderer Job); die Vorauswahl dieses
    Jobs sieht nur Status-null-Zeilen, also bleibt er unberuehrt."""
    rows = [contact(id="c-2", person_finding_status="pending", linkedin=None)]
    db = _Db({"businesses": [business()], "contacts": rows}, rpc=lambda p: [])
    monkeypatch.setattr(pf, "sb", lambda: db)
    monkeypatch.setattr(pf, "enqueue_many", lambda *a, **k: None)
    pf.run(job({"business_id": "b-1"}))
    assert rows[0]["person_finding_status"] == "pending"


def test_ablehnungsgrund_je_fund():
    alt = finding(age_months=24)
    fremd = finding(
        source_url="https://www.linkedin.com/posts/someone-else_x_y", identity_evidence=""
    )
    pod = finding(
        source_kind="podcast", source_url="https://www.linkedin.com/posts/kate-prince-5aa8283b_x_y"
    )
    assert pf.why_unusable(alt, contact()) == "age"
    assert pf.why_unusable(fremd, contact()) == "anchor"
    assert pf.why_unusable(pod, contact()) == "host_matrix"
    assert pf.why_unusable(finding(), contact()) is None


def test_abgelehnte_funde_landen_in_der_provenienz(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    _run_contact(monkeypatch, db, [finding(age_months=30)])
    pf.run(job({"contact_id": "c-1"}))
    src = db.tables["contacts"][0]["person_finding_source"]
    assert src["findings_returned"] == 1
    assert src["rejected"][0]["reason"] == "age"


def test_gewaehlter_fund_steht_nicht_bei_den_abgelehnten(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    _run_contact(monkeypatch, db, [finding(), finding(age_months=30, claim="alt")])
    pf.run(job({"contact_id": "c-1"}))
    src = db.tables["contacts"][0]["person_finding_source"]
    assert len(src["rejected"]) == 1
    assert src["rejected"][0]["claim"] == "alt"


# ── Nach Lauf 2 ────────────────────────────────────────────────────────────


def test_profil_typen_brauchen_profil_daten():
    f = finding(
        angle="role_vs_size",
        source_kind="profile",
        source_url="https://www.linkedin.com/in/kate-prince-5aa8283b",
        age_months=-1,
    )
    ohne = contact(custom=None)
    mit = contact(custom={"apollo": {"headline": "Founder & CEO at Ancient + Brave"}})
    assert pf.why_unusable(f, ohne) == "no_known_facts"
    assert pf.why_unusable(f, mit) is None


def test_eigener_markenname_und_personenname_sind_verboten():
    assert pf.own_brand_words({"website": "https://www.retaiyn.com/"}) == ["retaiyn"]
    assert pf.own_brand_words({"website": ""}) == []
    assert pf.person_name_words(contact(last_name="Prince")) == ["Kate Prince", "Prince"]
    assert pf.person_name_words(contact(full_name="Kate", last_name="")) == []


def test_dritte_person_loest_korrekturrunde_aus(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact(last_name="Prince")]})
    aufrufe = _run_contact(
        monkeypatch, db, [finding()], text="Kate Prince wrote that trust matters."
    )
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe["generate"] == 1 + pf.CORRECTION_ROUNDS
    assert row["person_finding_needs_review"] is True


# ── Nach Lauf 3 ────────────────────────────────────────────────────────────


def test_eigener_beitrag_auf_dem_eigenen_profil_ist_gebunden():
    """Das Modell liest Beitraege von der Aktivitaetsseite und nennt das
    Profil als Quelle (Lauf 3: Stroeken, Van Velzen)."""
    f = finding(source_url="https://www.linkedin.com/in/kate-prince-5aa8283b")
    best = pf.best_finding([f], contact())
    assert best["anchor"] == "linkedin_url"
    assert best["review_reason"] is None


def test_beleg_ohne_firma_belegt_nichts():
    """Lauf 3: ein anderer Pedro Principe, Beleg "Pedro Principe's own
    LinkedIn post". Ohne Firmennennung ist die Bindung nicht belegt."""
    f = finding(
        source_url="https://pt.linkedin.com/posts/pedroprincipe_activity-1_x",
        identity_anchor="company_and_role",
        identity_evidence="Pedro Principe's own LinkedIn post",
    )
    assert pf.best_finding([f], contact(_business_name="COCON")) is None
    mit_firma = finding(
        source_url="https://pt.linkedin.com/posts/pedroprincipe_activity-1_x",
        identity_anchor="company_and_role",
        identity_evidence="Pedro Principe, CEO of COCON, said",
    )
    best = pf.best_finding([mit_firma], contact(_business_name="COCON"))
    assert best["anchor"] == "company_and_role"


# ── Nach Lauf 6 (zehn echte US-Leads) ──────────────────────────────────────


def test_erfundene_zahlen_werden_erkannt():
    material = "Founded in 2008. Open rates are 20 to 30 percent."
    assert pf.invented_numbers("Many brands miss 30% revenue.", material) == []
    assert pf.invented_numbers("Many brands miss 40% revenue.", material) == ["40%"]
    assert pf.invented_numbers("Since 2008 you run it.", material) == []
    assert pf.invented_numbers("Since 2011 you run it.", material) == ["2011"]
    assert pf.invented_numbers("No numbers here.", material) == []


def test_erfundene_zahl_loest_korrekturrunde_aus(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    aufrufe = _run_contact(
        monkeypatch, db, [finding()], text="You lose 30% of revenue every month."
    )
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe["generate"] == 1 + pf.CORRECTION_ROUNDS
    assert row["person_finding_needs_review"] is True


# ── Nie leer (Regel vom 2026-09-22) ────────────────────────────────────────


def test_ohne_fund_schreibt_der_shop_den_absatz(monkeypatch, cfg):
    db = _Db(
        {
            "businesses": [
                business(
                    company_summary="Ancient + Brave sells collagen powders direct to consumer."
                )
            ],
            "contacts": [contact()],
        }
    )
    aufrufe = _run_contact(
        monkeypatch,
        db,
        [],
        text="On your site you sell collagen powders.",
        snippets=dict(GUTE_SCHNIPSEL, opener="I just read on your site that you sell collagen."),
    )
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe == {"research": 1, "generate": 1}
    assert row["person_finding_status"] == "found"
    assert row["person_finding_needs_review"] is False
    assert row["person_finding_source"]["angle"] == "company"
    assert row["person_finding_source"]["source_label"] == "I just looked at your site and"


def test_rueckfall_braucht_wenigstens_einen_namen():
    assert pf.company_fallback({"name": "", "company_summary": None}) is None
    f = pf.company_fallback({"name": "Firma", "company_summary": None, "website": "https://f.de"})
    assert f["angle"] == "company" and f["claim"] == "Firma"


def test_rueckfall_verliert_gegen_jeden_echten_fund():
    assert pf.ANGLE_RANK["company"] > pf.ANGLE_RANK["role_vs_size"]


# ── Erzwungene Suche (2026-09-22) ──────────────────────────────────────────


def test_suchaufrufe_werden_gezaehlt():
    class _O:
        def __init__(self, type):
            self.type = type

    class _R:
        output = [_O("web_search_call"), _O("message"), _O("web_search_call")]

    assert pf.search_calls(_R()) == 2
    assert pf.search_calls(type("_Leer", (), {"output": [_O("message")]})()) == 0
    assert pf.search_calls(type("_Nichts", (), {})()) == 0


# ── Nach Lauf 4 (erzwungene Suche, 2026-09-22) ─────────────────────────────


def test_private_themen_fallen_durch():
    krank = finding(claim="Odacite was born after her breast cancer experience.")
    assert pf.why_unusable(krank, contact()) == "private"
    weg = finding(claim="He shared that his role was eliminated in a restructuring.")
    assert pf.why_unusable(weg, contact()) == "private"
    sohn = finding(claim="He said his son did not care about the problem he was dealing with.")
    assert pf.why_unusable(sohn, contact()) == "private"
    panik = finding(claim="He shared rebuilding the business after a panic attack.")
    assert pf.why_unusable(panik, contact()) == "private"
    # Wortgrenzen: "person" und "Johnson" enthalten "son", sind aber kein Grund.
    ok = finding(claim="The person Johnson said the analytics dashboard ships next week.")
    assert pf.why_unusable(ok, contact()) is None
    assert pf.why_unusable(finding(), contact()) is None


def test_adverb_abschwaecher_werden_gestrichen():
    assert (
        pf.strip_hedges("Your setup probably stays on default templates.")
        == "Your setup stays on default templates."
    )
    assert (
        pf.strip_hedges("Your flows likely earn less, and campaigns most likely go out late.")
        == "Your flows earn less, and campaigns go out late."
    )
    assert pf.strip_hedges("Probably, your flows stay default.") == "Your flows stay default."
    assert pf.strip_hedges("Dein Setup bringt vermutlich weniger.") == "Dein Setup bringt weniger."
    assert pf.strip_hedges("Nothing to strip here.") == "Nothing to strip here."
    assert pf.strip_hedges("The unlikely-sounding plan.") == "The unlikely-sounding plan."


def test_saetze_ueber_alle_werden_erkannt():
    text = (
        "I just read your post about the launch. Many ecommerce teams using Klaviyo lack "
        "time. Your flows stay on default templates. Most of the impact comes from flows."
    )
    treffer = pf.generic_sentences(text)
    assert treffer == ["Many ecommerce teams using Klaviyo lack time."]
    assert pf.generic_sentences("Most teams don't have time or know-how.") != []
    assert pf.generic_sentences("Almost every shop runs Klaviyo.") != []
    assert pf.generic_sentences("Die meisten Shops lassen die Flows liegen.") != []
    assert pf.generic_sentences("You run many campaigns a year.") == []
    assert pf.generic_sentences("Brands with a tailored setup see an uplift of 30%.") != []
    assert pf.generic_sentences("Ecommerce brands miss this.") != []
    assert pf.generic_sentences("Your brands page looks fine.") == []


# ── Die Schnipsel (2026-09-23) ─────────────────────────────────────────────


def test_schnipsel_landen_am_kontakt(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    _run_contact(monkeypatch, db, [finding()])
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert row["person_snippets"]["platformWhereIGotIt"] == "LinkedIn"
    assert row["person_snippets"]["whatTheySaid"] == "the Forbes feature doubling your traffic"
    assert row["person_finding_needs_review"] is False
    assert aufrufe_schnipsel[id(db)]["n"] == 1


def test_schlechte_schnipsel_bekommen_korrekturrunden_und_pruefflag(monkeypatch, cfg):
    db = _Db({"businesses": [business()], "contacts": [contact()]})
    schlecht = dict(GUTE_SCHNIPSEL, promise="Most brands lose 30% of revenue, we fix that.")
    _run_contact(monkeypatch, db, [finding()], snippets=schlecht)
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe_schnipsel[id(db)]["n"] == 1 + pf.CORRECTION_ROUNDS
    assert row["person_finding_needs_review"] is True
    assert row["person_finding_source"]["review_reason"] == "rules"
    assert any("promise" in p for p in row["person_finding_source"]["snippet_problems"])


def test_validate_snippets_streicht_abschwaecher_und_punkt():
    raw = dict(GUTE_SCHNIPSEL, ctaTail="probably the segments I'd build first for Snap.")
    out, probleme = pf.validate_snippets(raw, "LinkedIn", [], ["Forbes feature"])
    assert probleme == []
    assert out["ctaTail"] == "the segments I'd build first for Snap"
    assert out["platformWhereIGotIt"] == "LinkedIn"
    leer, probleme = pf.validate_snippets(dict(GUTE_SCHNIPSEL, whatTheySaid=""), "LinkedIn", [], [])
    assert probleme == ["whatTheySaid is empty"]
    # "Posts about" vor whatTheySaid, Satzzeichen im Betreff, "with" im ctaTail.
    doppelt = dict(
        GUTE_SCHNIPSEL,
        whatTheySaid="Posts detailing the launch of an electrolyte product",
        subjectLine="electrolyte launch.",
        ctaTail="with the segments I'd build first for Snap",
    )
    out, probleme = pf.validate_snippets(doppelt, "LinkedIn", [], [])
    assert probleme == []
    assert out["whatTheySaid"] == "the launch of an electrolyte product"
    assert out["subjectLine"] == "electrolyte launch"
    out2, _ = pf.validate_snippets(
        dict(GUTE_SCHNIPSEL, whatTheySaid="what you said about the 80 percent split"),
        "LinkedIn",
        [],
        [],
    )
    assert out2["whatTheySaid"] == "the 80 percent split"
    assert out["ctaTail"] == "the segments I'd build first for Snap"
    # Der opener muss die Quelle nennen; Behauptungen ueber das Setup fallen durch.
    _, probleme = pf.validate_snippets(
        dict(
            GUTE_SCHNIPSEL,
            opener="Your post stuck with me.",
            promise="Right now your flows stay on default templates, we fix that.",
        ),
        "LinkedIn",
        [],
        [],
    )
    assert any("name the source" in p for p in probleme)
    assert any("asserts what their setup" in p for p in probleme)
    # Lob in Verkleidung faellt durch, der Fuellsatz nach der Liste wird gestrichen.
    out, probleme = pf.validate_snippets(
        dict(
            GUTE_SCHNIPSEL,
            opener=(
                "I just read your LinkedIn post about the talk. That stuck with me because your "
                "dual role reflects a deep understanding of customer needs."
            ),
            segments=(
                "Plant People sells supplements on subscription, so your buyers fall into groups: "
                "the subscriber, the starter-pack buyer. These groups emerge naturally from your "
                "subscription approach."
            ),
        ),
        "LinkedIn",
        [],
        [],
    )
    assert any("praises" in p for p in probleme)
    assert out["segments"].endswith("the subscriber, the starter-pack buyer.")


def test_platform_label():
    assert pf.platform_label(finding(), "en") == "LinkedIn"
    pod = finding(source_kind="podcast", source_url="https://www.techpixies.com/episode280/")
    assert pf.platform_label(pod, "en") == "the techpixies.com podcast"
    site = {"source_kind": "company_site", "source_url": "https://f.de"}
    assert pf.platform_label(site, "de") == "eurer Seite"
    art = finding(source_kind="article", source_url="https://forbes.com/x")
    assert pf.platform_label(art, "en") == "forbes.com"


def test_absenderprofil_steht_im_material():
    offer = {
        "offering": "Klaviyo flows",
        "sender_profile": "Two founders from Vienna, ex Chatarmin.",
    }
    ctx = pf.person_context(contact(), business(), finding(), offer, "en")
    assert "<sender>" in ctx and "ex Chatarmin" in ctx
    assert pf.sender_block({"sender_profile": "  "}) == ""
    assert pf.sender_block(None) == ""


def test_knappe_fassung_haengt_am_suchfilter():
    assert "COMPACT MODE" not in pf.snippet_prompt("en", [])
    assert "COMPACT MODE" in pf.snippet_prompt("en", [], compact=True)
    assert "KNAPPE FASSUNG" in pf.snippet_prompt("de", [], compact=True)


def test_knappe_fassung_hat_harte_deckel():
    lang = dict(GUTE_SCHNIPSEL, segments=" ".join(["wort"] * 40) + ".")
    _, normal = pf.validate_snippets(lang, "LinkedIn", [], [])
    _, knapp = pf.validate_snippets(lang, "LinkedIn", [], [], compact=True)
    assert not any("segments" in p for p in normal)
    assert any("segments" in p and "zu lang" in p for p in knapp)


def test_nur_knapper_deckel_gerissen_ist_kein_pruefgrund():
    snips = dict(GUTE_SCHNIPSEL, segments=" ".join(["wort"] * 40) + ".")
    _, probleme = pf.validate_snippets(snips, "LinkedIn", [], [], compact=True)
    assert pf.compact_only_length_problems(snips, probleme) == probleme
    # Ueber dem NORMALEN Deckel (70) bleibt es ein harter Verstoss.
    zu_lang = dict(GUTE_SCHNIPSEL, segments=" ".join(["wort"] * 80) + ".")
    _, probleme = pf.validate_snippets(zu_lang, "LinkedIn", [], [], compact=True)
    weich = pf.compact_only_length_problems(zu_lang, probleme)
    assert any(p.startswith("segments") for p in probleme)
    assert not any(p.startswith("segments") for p in weich)
