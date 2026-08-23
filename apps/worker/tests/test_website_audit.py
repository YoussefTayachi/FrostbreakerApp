"""Der Website-Check: HTML-Schnipsel rein, Befunde raus.

Je Code ein Positiv- und ein Negativfall. Kein Netz, keine Datenbank: analyze()
ist eine reine Funktion, genau dafuer liegt der Abruf in website_fetch.py.
"""
from datetime import date

import pytest

from worker import website_audit
from worker.website_audit import CONSEQUENCE_DE, FACT_DE, FINDING_CODES, analyze, top_finding

TODAY = date(2026, 8, 23)

# Eine Seite ohne jeden Befund. Basis fuer alle Negativfaelle: wer hier etwas
# aendert, aendert die Ausgangslage saemtlicher Tests.
CLEAN = """
<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Malerbetrieb Muster aus Kassel, seit 1998.">
<link rel="stylesheet" href="https://muster.de/style.css">
<script src="https://muster.de/app.js"></script>
</head><body>
<h1>Malerbetrieb Muster</h1>
<footer>&copy; 2026 Malerbetrieb Muster GmbH</footer>
</body></html>
"""


def codes(html: str, **kwargs) -> list[str]:
    kwargs.setdefault("checked_url", "https://muster.de/")
    kwargs.setdefault("final_url", "https://muster.de/")
    kwargs.setdefault("page_bytes", len(html))
    kwargs.setdefault("today", TODAY)
    return [f["code"] for f in analyze(html, **kwargs)["findings"]]


def evidence_for(html: str, code: str, **kwargs) -> str | None:
    kwargs.setdefault("checked_url", "https://muster.de/")
    kwargs.setdefault("final_url", "https://muster.de/")
    kwargs.setdefault("page_bytes", len(html))
    kwargs.setdefault("today", TODAY)
    for f in analyze(html, **kwargs)["findings"]:
        if f["code"] == code:
            return f["evidence"]
    raise AssertionError(f"Befund {code} nicht gefunden")


def test_saubere_seite_hat_keine_befunde():
    assert codes(CLEAN) == []


# ── no_https ───────────────────────────────────────────────────────────────


def test_no_https_wenn_die_seite_ueber_http_laeuft():
    assert "no_https" in codes(CLEAN, final_url="http://muster.de/")


def test_no_https_wenn_http_nicht_auf_https_umleitet():
    assert "no_https" in codes(CLEAN, http_redirects_to_https=False)


def test_kein_no_https_wenn_http_umleitet():
    assert "no_https" not in codes(CLEAN, http_redirects_to_https=True)


def test_kein_no_https_wenn_die_http_probe_nichts_beantwortet():
    """None heisst "Port 80 antwortet nicht". Das ist kein Mangel: die Seite
    ist dann schlicht nur ueber https zu haben."""
    assert "no_https" not in codes(CLEAN, http_redirects_to_https=None)


# ── no_viewport ────────────────────────────────────────────────────────────


def test_no_viewport_wenn_das_meta_tag_fehlt():
    html = CLEAN.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', "")
    assert "no_viewport" in codes(html)


def test_kein_no_viewport_bei_anderer_attributreihenfolge():
    html = CLEAN.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<meta content='width=device-width' name=viewport>",
    )
    assert "no_viewport" not in codes(html)


# ── stale_copyright ────────────────────────────────────────────────────────


def test_stale_copyright_bei_alter_jahreszahl():
    html = CLEAN.replace("&copy; 2026", "&copy; 2019")
    assert "stale_copyright" in codes(html)
    assert evidence_for(html, "stale_copyright") == "2019"


def test_stale_copyright_erst_ab_zwei_jahren_abstand():
    """Die Schwelle ist bewusst konservativ: eine Seite, die im Januar noch das
    Vorjahr stehen hat, ist gepflegt und wird nicht angegangen."""
    assert "stale_copyright" not in codes(CLEAN.replace("&copy; 2026", "&copy; 2025"))
    assert "stale_copyright" in codes(CLEAN.replace("&copy; 2026", "&copy; 2024"))


def test_stale_copyright_nimmt_die_juengste_zahl_einer_spanne():
    html = CLEAN.replace("&copy; 2026", "&copy; 2005 - 2026")
    assert "stale_copyright" not in codes(html)


def test_stale_copyright_findet_die_zahl_auch_zwischen_tags():
    html = CLEAN.replace("&copy; 2026", "<span>&copy;</span> <b>2018</b>")
    assert evidence_for(html, "stale_copyright") == "2018"


def test_stale_copyright_ignoriert_jahreszahlen_ohne_copyright_zeichen():
    """Ein Gruendungsjahr im Fusstext ist kein Befund."""
    html = CLEAN.replace("&copy; 2026 Malerbetrieb Muster GmbH", "Familienbetrieb seit 1998")
    assert "stale_copyright" not in codes(html)


def test_stale_copyright_ohne_footer_element_greift_auf_das_dokumentende_zu():
    html = "<html><body><p>Text</p>&copy; 2018 Muster</body></html>"
    assert "stale_copyright" in codes(html)


def test_stale_copyright_ignoriert_zahlen_aus_der_zukunft():
    html = CLEAN.replace("&copy; 2026", "&copy; 2031")
    assert "stale_copyright" not in codes(html)


# ── mixed_content ──────────────────────────────────────────────────────────


def test_mixed_content_bei_unverschluesseltem_skript():
    html = CLEAN.replace('src="https://muster.de/app.js"', 'src="http://muster.de/app.js"')
    assert "mixed_content" in codes(html)
    assert evidence_for(html, "mixed_content") == "http://muster.de/app.js"


def test_kein_mixed_content_auf_einer_http_seite():
    """Auf einer http-Seite ist eine http-Ressource kein Mixed Content, sondern
    das Erwartbare. Der Befund dort waere no_https, und der wird auch gesetzt."""
    html = CLEAN.replace('src="https://muster.de/app.js"', 'src="http://muster.de/app.js"')
    found = codes(html, final_url="http://muster.de/")
    assert "mixed_content" not in found
    assert "no_https" in found


def test_kein_mixed_content_bei_link_rel_profile():
    """Der klassische Fehlalarm: jedes WordPress-Theme traegt
    <link rel="profile" href="http://gmpg.org/xfn/11"> im Kopf. Das ist ein
    Verweis, keine Einbindung, und der Browser warnt deswegen nicht."""
    html = CLEAN.replace(
        '<link rel="stylesheet" href="https://muster.de/style.css">',
        '<link rel="stylesheet" href="https://muster.de/style.css">'
        '<link rel="profile" href="http://gmpg.org/xfn/11">'
        '<link rel="pingback" href="http://muster.de/xmlrpc.php">',
    )
    assert "mixed_content" not in codes(html)


def test_mixed_content_bei_unverschluesseltem_stylesheet():
    html = CLEAN.replace('href="https://muster.de/style.css"', 'href="http://muster.de/style.css"')
    assert "mixed_content" in codes(html)


# ── site_builder ───────────────────────────────────────────────────────────


def test_site_builder_ueber_das_generator_tag():
    html = CLEAN.replace(
        "<meta charset=\"utf-8\">",
        '<meta charset="utf-8"><meta name="generator" content="Wix.com Website Builder">',
    )
    assert "site_builder" in codes(html)
    assert evidence_for(html, "site_builder") == "Wix.com Website Builder"


def test_site_builder_ueber_den_cdn_host():
    html = CLEAN.replace(
        'src="https://muster.de/app.js"',
        'src="https://static.parastorage.com/services/main.js"',
    )
    assert "site_builder" in codes(html)
    assert evidence_for(html, "site_builder") == "Wix"


def test_site_builder_erkennt_die_uebrigen_baukaesten():
    for generator in (
        "Jimdo",
        "Squarespace",
        "GoDaddy Website Builder 7.0",
        "Weebly",
        "IONOS MyWebsite",
        "1&1 MyWebsite",
    ):
        html = CLEAN.replace(
            '<meta charset="utf-8">',
            f'<meta charset="utf-8"><meta name="generator" content="{generator}">',
        )
        assert "site_builder" in codes(html), generator


def test_wordpress_ist_kein_site_builder():
    """Absichtlich kein Befund: eine gepflegte WordPress-Seite ist voellig in
    Ordnung, und "Sie benutzen WordPress" waere ein Aufhaenger ohne Inhalt."""
    html = CLEAN.replace(
        '<meta charset="utf-8">',
        '<meta charset="utf-8"><meta name="generator" content="WordPress 6.5.2">',
    )
    assert "site_builder" not in codes(html)


# ── legacy_markup ──────────────────────────────────────────────────────────


def test_legacy_markup_bei_font_tag():
    html = CLEAN.replace("<h1>", "<font size=2><h1>")
    assert "legacy_markup" in codes(html)
    assert evidence_for(html, "legacy_markup") == "<font>"


def test_legacy_markup_bei_frameset_center_und_marquee():
    for tag in ("frameset", "center", "marquee"):
        assert "legacy_markup" in codes(CLEAN.replace("<h1>", f"<{tag}><h1>")), tag


def test_kein_legacy_markup_bei_aehnlich_beginnenden_tags():
    """<fontsomething> und <centered> gibt es nicht, aber der Wortanfang darf
    trotzdem nicht reichen: sonst schlaegt jede Klasse wie <div class="center">
    zu."""
    html = CLEAN.replace("<h1>", '<div class="center"><span class="font-bold"><h1>')
    assert "legacy_markup" not in codes(html)


# ── no_meta_description ────────────────────────────────────────────────────


def test_no_meta_description_wenn_beide_fehlen():
    html = CLEAN.replace(
        '<meta name="description" content="Malerbetrieb Muster aus Kassel, seit 1998.">', ""
    )
    assert "no_meta_description" in codes(html)


def test_kein_no_meta_description_wenn_nur_og_description_da_ist():
    html = CLEAN.replace(
        '<meta name="description" content="Malerbetrieb Muster aus Kassel, seit 1998.">',
        '<meta property="og:description" content="Malerbetrieb aus Kassel.">',
    )
    assert "no_meta_description" not in codes(html)


def test_leere_description_zaehlt_wie_keine():
    html = CLEAN.replace('content="Malerbetrieb Muster aus Kassel, seit 1998."', 'content="  "')
    assert "no_meta_description" in codes(html)


# ── ssl_broken / unreachable ───────────────────────────────────────────────


def test_ssl_broken_kommt_aus_dem_ausnahmezweig():
    audit = website_audit.ssl_broken("https://abgelaufen.de/")
    assert [f["code"] for f in audit["findings"]] == ["ssl_broken"]
    assert audit["findings"][0]["evidence"] is None


def test_unreachable_raet_nichts():
    audit = website_audit.unreachable("https://weg.de/")
    assert audit == {"checked_url": "https://weg.de/", "findings": []}


# ── Messwerte und Speicherform ─────────────────────────────────────────────


def test_page_bytes_ist_kein_befund():
    audit = analyze(
        CLEAN,
        checked_url="https://muster.de/",
        final_url="https://muster.de/",
        page_bytes=48213,
        today=TODAY,
    )
    assert audit["page_bytes"] == 48213
    assert audit["findings"] == []


def test_generator_wird_woertlich_mitgespeichert():
    html = CLEAN.replace(
        '<meta charset="utf-8">',
        '<meta charset="utf-8"><meta name="generator" content="Wix.com Website Builder">',
    )
    audit = analyze(
        html,
        checked_url="https://muster.de/",
        final_url="https://muster.de/",
        page_bytes=len(html),
        today=TODAY,
    )
    assert audit["generator"] == "Wix.com Website Builder"


def test_beleg_ist_nie_ein_satz():
    """Belege wandern in einen Prompt. Alles, was dort nach Formulierung
    aussieht, uebernimmt das Modell woertlich."""
    long_url = "http://muster.de/" + "a" * 300 + ".js"
    html = CLEAN.replace('src="https://muster.de/app.js"', f'src="{long_url}"')
    assert len(evidence_for(html, "mixed_content")) <= website_audit.MAX_EVIDENCE_CHARS


# ── Rangfolge ──────────────────────────────────────────────────────────────


def test_befunde_kommen_in_katalogreihenfolge():
    """Eine Seite mit allem, was schiefgehen kann."""
    html = """
    <html><head>
    <meta name="generator" content="Wix.com Website Builder">
    </head><body>
    <font>alt</font>
    <img src="http://muster.de/logo.png">
    <footer>&copy; 2018 Muster</footer>
    </body></html>
    """
    found = codes(html, http_redirects_to_https=False)
    assert found == [c for c in FINDING_CODES if c in found]
    assert found == [
        "no_https",
        "no_viewport",
        "stale_copyright",
        "mixed_content",
        "site_builder",
        "legacy_markup",
        "no_meta_description",
    ]


def test_top_finding_liefert_genau_einen_und_zwar_den_staerksten():
    audit = {
        "findings": [
            {"code": "no_meta_description", "evidence": None},
            {"code": "no_https", "evidence": "http://muster.de/"},
            {"code": "site_builder", "evidence": "Wix"},
        ]
    }
    top = top_finding(audit)
    assert top["code"] == "no_https"


def test_top_finding_uebergeht_unbekannte_codes():
    """Ein Code aus einer neueren Worker-Fassung hat hier weder Rang noch Text."""
    assert top_finding({"findings": [{"code": "erfunden", "evidence": None}]}) is None
    assert top_finding({"findings": []}) is None
    assert top_finding(None) is None
    assert top_finding({}) is None


# ── Der Katalog selbst ─────────────────────────────────────────────────────


@pytest.mark.parametrize("code", FINDING_CODES)
def test_jeder_code_hat_tatsache_und_folge(code):
    assert FACT_DE.get(code), code
    assert CONSEQUENCE_DE.get(code), code


@pytest.mark.parametrize("code", FINDING_CODES)
def test_kein_folgesatz_enthaelt_einen_gedankenstrich(code):
    """Gedankenstriche stehen auf der Verbotsliste der Personalisierung
    (DEFAULT_BANNED_WORDS). Einer in diesen Saetzen wuerde ueber den
    Prompt-Kontext im Ergebnis landen und dort eine bezahlte Korrekturrunde
    ausloesen."""
    for text in (FACT_DE[code], CONSEQUENCE_DE[code]):
        assert "—" not in text
        assert "–" not in text
        assert "--" not in text


def test_texte_ohne_eigenen_code_gibt_es_nicht():
    assert set(FACT_DE) == set(FINDING_CODES)
    assert set(CONSEQUENCE_DE) == set(FINDING_CODES)
