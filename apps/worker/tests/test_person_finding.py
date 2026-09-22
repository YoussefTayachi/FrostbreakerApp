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
    best = pf.best_finding([f], contact())
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
    assert pf.source_label(finding(), "en") == "On LinkedIn you wrote"
    pod = finding(source_kind="podcast", source_url="https://www.techpixies.com/episode280/")
    assert pf.source_label(pod, "en") == "On the techpixies.com podcast"
    prof = finding(
        source_kind="profile", source_url="https://www.linkedin.com/in/kate-prince-5aa8283b"
    )
    assert pf.source_label(prof, "de") == "Auf deinem LinkedIn-Profil"


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
    assert ctx.startswith("Source label, use it word for word to open: On LinkedIn you wrote")
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


def _run_contact(monkeypatch, db, findings, text="Absatz.", research_raises=None):
    monkeypatch.setattr(pf, "sb", lambda: db)
    aufrufe = {"research": 0, "generate": 0}

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
    db = _Db({"businesses": [business()], "contacts": [contact()]})
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
    assert src["source_label"] == "On LinkedIn you wrote"
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
    zu_lang = " ".join(["wort"] * 60)
    aufrufe = _run_contact(monkeypatch, db, [finding()], text=zu_lang)
    pf.run(job({"contact_id": "c-1"}))
    row = db.tables["contacts"][0]
    assert aufrufe["generate"] == 2
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
    assert pf.source_label(art, "en") == "In your piece on linkedin.com"


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
