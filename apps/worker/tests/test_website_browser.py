"""Die Browser-Stufe, ohne Browser geprueft.

Die Messung braucht Chromium, die AUSWERTUNG nicht: sie ist eine reine
Funktion auf einem Dictionary, genau wie der HTML-Katalog in
test_website_audit.py eine reine Funktion auf HTML-Schnipseln ist. Deshalb
laufen diese Tests in Millisekunden und in jeder Umgebung.

Was hier NICHT getestet wird, ist Playwright selbst. Getestet wird, was aus
einer Messung an Behauptungen wird, und das ist der teure Teil: ein falscher
Befund landet in einer Kaltmail bei einem Fremden.
"""
import pytest

from worker import website_audit as wa
from worker import website_browser as wb

# ── Zieladressen ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8765",
    "http://localhost/admin",
    "http://192.168.0.1",
    "http://10.0.0.5",
    "http://169.254.169.254/latest/meta-data/",  # Cloud-Metadaten
    "https://[::1]/",
    "file:///etc/passwd",
    "ftp://example.com",
    "",
])
def test_nicht_oeffentliche_ziele_werden_abgewiesen(url):
    """Ein Browser loest DNS selbst auf und folgt Weiterleitungen. Ohne diese
    Pruefung wird aus einer Lead-Adresse ein Weg ins eigene Netz."""
    assert wb.is_public_url(url) is False


def test_oeffentliche_adresse_geht_durch():
    assert wb.is_public_url("https://example.com") is True


def test_measure_ohne_pruefbare_adresse_misst_gar_nicht():
    """Kein Browserstart fuer eine Adresse, die ohnehin abgewiesen wuerde."""
    m = wb.measure("http://192.168.1.1")
    assert m.status == "skipped"
    assert "oeffentlich" in (m.reason or "")


# ── Waende ─────────────────────────────────────────────────────────────────


def test_wand_am_text_erkannt():
    assert wb.wall_reason("Just a moment...", []) is not None


def test_wand_am_element_erkannt():
    assert wb.wall_reason("", ["#challenge-form"]) is not None


def test_wand_nur_im_titel_erkannt():
    """Der gemessene Fall vom 2026-08-31: transcendentroofing.com.

    Die Sperre lieferte HTTP 202 mit dem Titel "Robot Challenge Screen" und
    187 Zeichen Text, in denen keines der Merkmale stand. Die Messung galt als
    gelungen, und ihre Zahlen beschrieben die Sperrseite: kein og:image, keine
    Telefonlinks, keine Formulare, keine Beschreibung. Seither geht der Titel
    mit in den Abgleich.
    """
    koerper = "transcendentroofing.com verify you are human by completing the action below."
    assert wb.wall_reason(koerper, []) is None
    assert wb.wall_reason(koerper + " robot challenge screen", []) is not None


def test_ein_langer_titel_macht_aus_einer_wand_keine_seite():
    """Der Titel zaehlt beim Erkennen mit, aber NICHT als sichtbarer Text.

    Sonst haette eine Sperrseite mit ausschweifendem Titel genug "Inhalt", um
    an WALL_MAX_TEXT vorbeizukommen.
    """
    kurz = "just a moment"
    assert wb.wall_reason(kurz + " " + "x" * 900, [], len(kurz)) is not None


def test_normale_seite_ist_keine_wand():
    assert wb.wall_reason("Willkommen bei Malerei Mueller in Oetz", []) is None


def test_eine_wand_erzeugt_keinen_einzigen_befund():
    """Der wichtigste Test dieser Datei.

    Ein Consent-Dialog oder eine Bot-Pruefung sieht aus wie eine leere Seite.
    Wer daraus einen Befund macht, schreibt einem Inhaber, seine Seite sei
    kaputt, weil ein Cookie-Banner davor stand.
    """
    messung = {
        "status": "inconclusive",
        "reason": "challenge-text: just a moment",
        "desktop": {"hauptTextLaenge": 0, "textLaenge": 12},
        "handy": {"ueberbreite": 400, "ueberstehend": ["div#x"], "zielZuKlein": 99},
        "console_error_count": 20,
    }
    assert wa.browser_findings(messung) == []


# ── Befunde aus einer Messung ──────────────────────────────────────────────


def _messung(**teile):
    basis = {
        "status": "completed",
        "http_status": 200,
        "desktop": {"hauptTextLaenge": 5000, "textLaenge": 8000, "loecher": []},
        "handy": {"ueberbreite": 0, "ueberstehend": [], "textUnter12px": 0, "zielZuKlein": 0},
        "console_error_count": 0,
        "timing_ms": [],
    }
    for schluessel, wert in teile.items():
        if isinstance(wert, dict) and isinstance(basis.get(schluessel), dict):
            basis[schluessel] = {**basis[schluessel], **wert}
        else:
            basis[schluessel] = wert
    return basis


def test_ueberlauf_ohne_beleg_element_ist_kein_befund():
    """Der Skill website-finding verlangt zwei unabhaengige Belege je Befund.
    Eine Zahl ohne Ort ist einer."""
    m = _messung(handy={"ueberbreite": 300, "ueberstehend": []})
    assert [f["code"] for f in wa.browser_findings(m)] == []


def test_ueberlauf_mit_beleg_element_ist_ein_befund():
    m = _messung(handy={"ueberbreite": 300, "ueberstehend": ["section#hero"]})
    befunde = wa.browser_findings(m)
    assert [f["code"] for f in befunde] == ["mobile_overflow"]
    assert "section#hero" in befunde[0]["evidence"]


def test_wenige_pixel_ueberlauf_sind_rundung():
    m = _messung(handy={"ueberbreite": 4, "ueberstehend": ["div#a"]})
    assert wa.browser_findings(m) == []


def test_leerer_abschnitt_wird_gemeldet():
    m = _messung(desktop={"loecher": ["section.ueber-uns"]})
    befunde = wa.browser_findings(m)
    assert [f["code"] for f in befunde] == ["empty_section"]


# ── Was gemessen, aber nie behauptet wird ──────────────────────────────────


@pytest.mark.parametrize("code", [
    "render_blocked", "slow_load", "js_errors", "text_too_small", "tap_targets_small",
])
def test_fuenf_codes_duerfen_nie_in_eine_mail(code):
    assert code in wa.FINDING_CODES
    assert code not in wa.MAILABLE_CODES


def test_nicht_versendbare_befunde_gewinnen_nie():
    """tap_targets_small traf gemessen 28 von 40 Leads. Ohne den Filter waere
    er der haeufigste Satz in der Kampagne."""
    m = _messung(handy={"zielZuKlein": 40, "textUnter12px": 20}, console_error_count=9,
                 desktop={"h1Sichtbar": 2, "beschreibung": "da", "ogImage": True,
                          "telLinks": 1, "formulare": 1})
    codes = [f["code"] for f in wa.browser_findings(m)]
    assert set(codes) == {"js_errors", "text_too_small", "tap_targets_small"}
    # Ein HTML-Audit, das ausgewertet HAT und nichts fand: dann kommen auch
    # keine DOM-Codes dazu, und uebrig bleiben nur die nicht versendbaren.
    sauber = {"checked_url": "https://muster.de/", "findings": []}
    assert wa.top_finding(sauber, m) is None


def test_alle_codes_haben_einen_text():
    for code in wa.FINDING_CODES:
        assert wa.FACT_DE.get(code), code
        assert wa.CONSEQUENCE_DE.get(code), code


def test_keine_folge_behauptet_geld():
    """Eine Umsatz- oder Conversion-Aussage ist eine Kausalkette, die niemand
    belegen kann, und in einer Kaltmail beim ersten Zweifel das Ende."""
    verboten = ("umsatz", "conversion", "prozent", "%", "euro", "verlier")
    for code, folge in wa.CONSEQUENCE_DE.items():
        unten = folge.lower()
        for wort in verboten:
            assert wort not in unten, f"{code} behauptet {wort!r}: {folge}"


# ── Die Widerlegung: der eigentliche Ertrag ────────────────────────────────


def test_browser_widerlegt_falsches_no_h1():
    """Der gemessene Fall ekomenu.nl: das HTML hat kein h1, das Skript setzt
    drei ein. Ohne diese Regel gewinnt ein Vorwurf, der nicht stimmt."""
    html = {"findings": [{"code": "no_h1", "evidence": None}]}
    m = _messung(desktop={"h1Sichtbar": 3})
    assert wa.invalidate_with_browser(html["findings"], m) == []
    assert wa.top_finding(html, m) is None


def test_browser_widerlegt_meta_description_und_og_image():
    html = {"findings": [
        {"code": "no_meta_description", "evidence": None},
        {"code": "no_og_image", "evidence": None},
    ]}
    m = _messung(desktop={"beschreibung": "Wir bauen Daecher in Tirol", "ogImage": True})
    assert wa.invalidate_with_browser(html["findings"], m) == []


def test_browser_widerlegt_kontaktweg_ueber_jede_der_drei_arten():
    html = [{"code": "no_contact_route", "evidence": None}]
    for feld in ("formulare", "mailLinks", "telLinks"):
        m = _messung(desktop={feld: 1})
        assert wa.invalidate_with_browser(html, m) == [], feld


def test_browser_widerlegt_unerreichbar():
    """Der teuerste Satz im Katalog: 'eure Seite laedt gar nicht' ueber eine
    Seite, die laedt. Gemessen betraf das 3 von 38 Leads."""
    html = {"findings": [{"code": "site_unreachable", "evidence": None}]}
    m = _messung(http_status=200)
    assert wa.top_finding(html, m) is None


def test_transport_befunde_bleiben_unberuehrt():
    """Ein gerendertes DOM sagt nichts ueber HTTPS, Zertifikate oder das
    gelieferte Dokument. Wer hier zu viel widerlegt, verliert echte Befunde."""
    codes = ["ssl_broken", "no_https", "no_viewport", "stale_copyright",
             "mixed_content", "site_builder", "legacy_markup"]
    html = [{"code": c, "evidence": None} for c in codes]
    m = _messung(desktop={"h1Sichtbar": 5, "beschreibung": "da", "ogImage": True,
                          "formulare": 3, "telLinks": 2})
    assert [f["code"] for f in wa.invalidate_with_browser(html, m)] == codes


def test_ohne_messung_bleibt_alles_wie_frueher():
    """Alle Zeilen aus der Zeit vor Migration 0107 muessen sich unveraendert
    verhalten."""
    html = {"findings": [{"code": "no_h1", "evidence": None}]}
    assert wa.top_finding(html) == {"code": "no_h1", "evidence": None}
    assert wa.top_finding(html, None) == {"code": "no_h1", "evidence": None}


def test_gescheiterte_messung_widerlegt_nichts():
    """Ein Browser, der die Seite nicht laden konnte, hat nichts gesehen. Aus
    'nichts gesehen' darf nicht 'alles in Ordnung' werden."""
    html = [{"code": "no_h1", "evidence": None}]
    for status in ("failed", "inconclusive", "skipped"):
        m = _messung(status=status, desktop={"h1Sichtbar": 0})
        assert wa.invalidate_with_browser(html, m) == html, status


def test_combine_sortiert_nach_rang():
    html = {"findings": [{"code": "no_meta_description", "evidence": None}]}
    m = _messung(handy={"ueberbreite": 200, "ueberstehend": ["div#a"]})
    codes = [f["code"] for f in wa.combine(html, m)["findings"]]
    # mobile_overflow steht im Katalog vor no_meta_description
    assert codes.index("mobile_overflow") < codes.index("no_meta_description")


def test_top_finding_nimmt_den_ranghoechsten_ueber_beide_quellen():
    html = {"findings": [{"code": "no_og_image", "evidence": None}]}
    m = _messung(handy={"ueberbreite": 200, "ueberstehend": ["div#a"]})
    assert wa.top_finding(html, m)["code"] == "mobile_overflow"


# ── Die Reihenfolge der beiden Stufen ──────────────────────────────────────


def test_pending_steht_in_der_datenbank_bevor_der_job_eingereiht_wird(monkeypatch):
    """Der Race, den die Diff-Inspektion gefunden hat.

    Wird zuerst eingereiht und danach geschrieben, kann der Worker den
    Browser-Job schon beendet und 'completed' gespeichert haben, wenn
    check_website sein 'pending' hinterherschiebt. website_finding wartet dann
    bis zum Vier-Minuten-Deckel auf eine Stufe, die laengst fertig ist.

    Der Test haelt die Reihenfolge fest, nicht das Ergebnis.
    """
    from worker.pipelines import check_website

    ablauf: list[str] = []

    class FakeTable:
        def update(self, daten):
            ablauf.append("write:pending" if daten.get("website_audit_browser_status")
                          == "pending" else "write")
            return self

        def eq(self, *a):
            return self

        def execute(self):
            return type("R", (), {"data": {}})()

    monkeypatch.setattr(check_website, "sb", lambda: type("S", (), {"table": lambda s, n: FakeTable()})())
    monkeypatch.setattr(check_website, "enqueue", lambda *a, **k: ablauf.append("enqueue"))

    check_website._write("b-1", "ok", {"findings": []}, True)
    check_website._reihe_browser_ein({"workspace_id": "ws-1"}, "b-1", "https://muster.de/")

    assert ablauf == ["write:pending", "enqueue"], ablauf


def test_ohne_adresse_wird_nichts_eingereiht(monkeypatch):
    """Sonst wartet website_finding auf eine Stufe, die nie kommt."""
    from worker.pipelines import check_website

    jobs: list = []
    monkeypatch.setattr(check_website, "enqueue", lambda *a, **k: jobs.append(a))
    assert check_website._reihe_browser_ein({"workspace_id": "ws-1"}, "b-1", "") is False
    assert jobs == []


def test_website_finding_wartet_auf_die_browser_stufe():
    """Ohne dieses Warten schreibt der Finding-Job aus der HTML-Stufe und
    bessert wegen seines Idempotenz-Schutzes nie nach."""
    from worker.pipelines import website_finding as wf

    laeuft = {
        "created_at": "2099-01-01T00:00:00+00:00",
        "website_audit_status": "ok",
        "browser_audit_required": True,
        "website_audit_browser_status": "pending",
    }
    assert wf.audit_pending(laeuft) is True

    fertig = {**laeuft, "website_audit_browser_status": "completed"}
    assert wf.audit_pending(fertig) is False

    # Alte Zeile ohne Browser-Stufe: darf nicht warten.
    alt = {**laeuft, "browser_audit_required": False, "website_audit_browser_status": None}
    assert wf.audit_pending(alt) is False


def test_jeder_terminale_zustand_beendet_das_warten():
    from worker.pipelines import website_finding as wf

    for zustand in ("completed", "inconclusive", "skipped", "failed"):
        biz = {
            "created_at": "2099-01-01T00:00:00+00:00",
            "website_audit_status": "ok",
            "browser_audit_required": True,
            "website_audit_browser_status": zustand,
        }
        assert wf.audit_pending(biz) is False, zustand


# ── Wenn nur der Browser die Seite erreicht ────────────────────────────────


def test_browser_belegt_die_dom_codes_wenn_html_nichts_sah():
    """Der gemessene Fall Rose Line Premier: httpx meldete unreachable, der
    Browser antwortete mit HTTP 200 und sah eine Seite ohne h1. Vorher kam
    dabei GAR KEIN Befund heraus, obwohl er vor Augen lag."""
    html = {"checked_url": "http://x.de/", "findings": [],
            "unreachable_kind": "dns", "unreachable_first_seen_at": "2026-08-30T00:00:00Z"}
    m = _messung(desktop={"h1Sichtbar": 0, "beschreibung": "da", "ogImage": True,
                          "telLinks": 8, "formulare": 2, "hauptTextLaenge": 4000})
    codes = [f["code"] for f in wa.combine(html, m)["findings"]]
    assert "no_h1" in codes
    # was der Browser sieht, wird nicht behauptet
    assert "no_meta_description" not in codes
    assert "no_og_image" not in codes
    assert "no_contact_route" not in codes
    assert "no_tel_link" not in codes


def test_dom_codes_kommen_nicht_doppelt_wenn_html_schon_gemessen_hat():
    """Sonst stuende no_h1 zweimal in der Liste."""
    html = {"checked_url": "http://x.de/", "findings": [{"code": "no_h1", "evidence": None}]}
    m = _messung(desktop={"h1Sichtbar": 0, "beschreibung": "", "ogImage": False})
    codes = [f["code"] for f in wa.combine(html, m)["findings"]]
    assert codes.count("no_h1") == 1
    assert "no_meta_description" not in codes  # HTML hat nichts dazu gesagt


def test_html_hat_ausgewertet_erkennt_die_drei_faelle():
    assert wa.html_hat_ausgewertet({"checked_url": "x", "findings": []}) is True
    assert wa.html_hat_ausgewertet({"checked_url": "x", "unreachable_kind": "dns"}) is False
    assert wa.html_hat_ausgewertet({}) is False
    assert wa.html_hat_ausgewertet(None) is False


def test_leere_seite_bekommt_keinen_kontaktvorwurf():
    """Auf einer Seite, die nichts anzeigt, ist der fehlende Kontaktweg nicht
    der Befund."""
    m = _messung(desktop={"h1Sichtbar": 0, "hauptTextLaenge": 20, "telLinks": 0,
                          "mailLinks": 0, "formulare": 0})
    codes = [f["code"] for f in wa.dom_findings(m)]
    assert "no_contact_route" not in codes
