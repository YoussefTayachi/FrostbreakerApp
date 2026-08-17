"""Unit-Tests fuer die reinen Prospeo-Funktionen (kein Netz, keine DB).

Der Zweck dieser Datei ist nicht nur, dass build_search_filters richtig
rechnet, sondern dass sie GENAUSO rechnet wie buildProspeoFilters() in
apps/web/lib/prospeo-query.ts. Die beiden Seiten muessen uebereinstimmen,
weil der Trefferzaehler im Formular dieselbe Anfrage stellt wie der Worker
beim echten Lauf. Weicht ein Feld ab, verspricht die Oberflaeche eine Zahl,
die die Suche nicht einloest.

Die Faelle unten sind deshalb absichtlich dieselben wie in
prospeo-query.test.ts. Wer hier etwas aendert, aendert dort mit.
"""

from worker.pipelines.prospeo import (
    BULK_ENRICH_CHUNK,
    HEADCOUNT_RANGES,
    PER_PAGE,
    REVENUE_TIERS,
    _address_of,
    _current_job,
    _map_pair,
    _phone_of,
    _website_of,
    build_company_summary,
    build_search_filters,
)


class TestBuildSearchFilters:
    def test_leere_filter_fallen_ganz_weg(self):
        """Ein leeres include-Array ist bei Prospeo keine fehlende Bedingung,
        sondern eine, die nichts erfuellt; der Fehler erschiene als
        'keine Treffer' und waere von einem echten Nullergebnis nicht zu
        unterscheiden."""
        assert build_search_filters({}) == {}
        assert build_search_filters(
            {
                "person_titles": "  ",
                "technologies": [],
                "headcount": [],
                "keywords": "",
                "traffic_countries": [],
            }
        ) == {}

    def test_stellentitel_mit_gross_geschriebener_vergleichsart(self):
        """GROSS. Die Doku sagt "contains"/"exact", die echte API lehnt beides
        klein ab: "Invalid match_mode. Must be one of: CONTAINS, EXACT,
        SIMILAR, STRICT." Am 2026-08-05 im Testlauf gemessen."""
        assert build_search_filters({"person_titles": "CEO, Head of Support"}) == {
            "person_job_title": {
                "include": ["CEO", "Head of Support"],
                "match_mode": "CONTAINS",
            }
        }
        assert build_search_filters(
            {"person_titles": "CEO", "person_title_match": "EXACT"}
        ) == {"person_job_title": {"include": ["CEO"], "match_mode": "EXACT"}}

    def test_normalisiert_klein_geschriebene_vergleichsart(self):
        built = build_search_filters({"person_titles": "CEO", "person_title_match": "exact"})
        assert built["person_job_title"]["match_mode"] == "EXACT"

    def test_unbekannte_vergleichsart_faellt_auf_contains(self):
        built = build_search_filters({"person_titles": "CEO", "person_title_match": "fuzzy"})
        assert built["person_job_title"]["match_mode"] == "CONTAINS"

    def test_verwirft_unbekannte_groessenstufen(self):
        """'11-50' gibt es bei Prospeo nicht, '10001+' ist Apollos
        Schreibweise. Beide fliegen raus."""
        assert build_search_filters({"headcount": ["11-50", "51-100", "10001+"]}) == {
            "company_headcount_range": {"include": ["51-100"]}
        }

    def test_oberste_stufe_heisst_10000_plus(self):
        assert "10000+" in HEADCOUNT_RANGES
        assert "10001+" not in HEADCOUNT_RANGES

    def test_deckelt_technologien_und_keywords_bei_20(self):
        many = [f"Tech{i}" for i in range(30)]
        built = build_search_filters({"technologies": many, "keywords": ",".join(many)})
        assert len(built["company_technology"]["include"]) == 20
        assert len(built["company_keywords"]["include"]) == 20

    def test_verwirft_unbekannte_umsatzstufen(self):
        assert build_search_filters({"revenue": ["1M", "3M"]}) == {
            "company_revenue": {"include": ["1M"]}
        }


class TestStellenausschreibungen:
    def test_hiring_for_mit_vergleichsart(self):
        assert build_search_filters({"hiring_for": "Customer Support, Support Agent"}) == {
            "company_job_posting_hiring_for": {
                "include": ["Customer Support", "Support Agent"],
                "match_type": "CONTAINS",
            }
        }

    def test_mengenspanne_auch_einseitig(self):
        assert build_search_filters({"job_posting_min": 5}) == {
            "company_job_posting_quantity": {"min": 5}
        }
        assert build_search_filters({"job_posting_max": 100}) == {
            "company_job_posting_quantity": {"max": 100}
        }

    def test_null_ist_ein_gesetzter_wert(self):
        assert build_search_filters({"job_posting_min": 0}) == {
            "company_job_posting_quantity": {"min": 0}
        }


class TestWebsiteTraffic:
    def test_besuchsspanne(self):
        assert build_search_filters(
            {"traffic_min_visits": 10000, "traffic_max_visits": 1000000}
        ) == {
            "company_website_traffic": {
                "min_monthly_visits": 10000,
                "max_monthly_visits": 1000000,
            }
        }

    def test_veraenderung_mit_zeitraum(self):
        assert build_search_filters(
            {
                "traffic_change_min": 10,
                "traffic_change_max": 200,
                "traffic_change_period": "quarterly",
            }
        ) == {
            "company_website_traffic": {
                "visit_change": {"period": "quarterly", "min_change": 10, "max_change": 200}
            }
        }

    def test_monthly_als_voreinstellung(self):
        built = build_search_filters({"traffic_change_min": 25})
        assert built["company_website_traffic"] == {
            "visit_change": {"period": "monthly", "min_change": 25}
        }

    def test_deckelt_laender_bei_fuenf(self):
        built = build_search_filters(
            {
                "traffic_countries": ["US", "UK", "DE", "FR", "IT", "ES"],
                "traffic_country_min_pct": 20,
            }
        )
        traffic = built["company_website_traffic"]
        assert len(traffic["top_countries"]) == 5
        assert traffic["min_country_pct"] == 20

    def test_prozentsatz_nur_mit_laendern(self):
        """min_country_pct ist laut Doku NUR zusammen mit top_countries
        erlaubt. Allein gesetzt waere es eine ungueltige Anfrage."""
        assert build_search_filters({"traffic_country_min_pct": 20}) == {}

    def test_zeitraum_allein_ergibt_kein_traffic_objekt(self):
        """Laut Doku braucht das Traffic-Objekt mindestens ein echtes
        Kriterium. Nur ein Zeitraum ist keine Bedingung."""
        assert build_search_filters({"traffic_change_period": "yearly"}) == {}

    def test_unbrauchbare_zahl_wird_ignoriert_statt_nan(self):
        assert build_search_filters({"traffic_min_visits": "abc"}) == {}


class TestMapping:
    def test_website_aus_domain_gebaut(self):
        assert _website_of({"website": "https://a.com"}) == "https://a.com"
        assert _website_of({"domain": "b.com"}) == "https://b.com"
        assert _website_of({}) is None

    def test_adresse_bevorzugt_die_fertige_raw_address(self):
        """Prospeo liefert eine vollstaendige Anschrift inklusive Strasse mit.
        Am 2026-08-05 im Testlauf gesehen: "301 8th St, San Francisco,
        California, US"."""
        assert (
            _address_of({"location": {"raw_address": "301 8th St, San Francisco, California, US",
                                      "city": "San Francisco"}})
            == "301 8th St, San Francisco, California, US"
        )

    def test_adresse_faellt_auf_die_einzelteile_zurueck(self):
        assert (
            _address_of({"location": {"city": "Austin", "state": "TX", "country": "United States"}})
            == "Austin, TX, United States"
        )
        # Laut Doku kann jedes Feld null sein; das darf nicht knallen.
        assert _address_of({"location": None}) is None
        assert _address_of({}) is None

    def test_telefon_ist_ein_objekt_keine_zeichenkette(self):
        """phone_hq ist verschachtelt:

            {"phone_hq": "+16165759676", "phone_hq_national": "(616) 575-9676", ...}

        Ohne _phone_of waere dieses dict in die Textspalte
        businesses.phone_national gewandert: entweder ein Datenbankfehler
        oder ein gespeichertes "{'phone_hq': ...}". Am 2026-08-05 im Testlauf
        aufgefallen."""
        assert _phone_of({"phone_hq": {
            "phone_hq": "+16165759676",
            "phone_hq_national": "(616) 575-9676",
            "phone_hq_international": "+16165759676",
        }}) == "(616) 575-9676"
        # Rueckfall, falls die nationale Fassung fehlt.
        assert _phone_of({"phone_hq": {"phone_hq": "+4930123"}}) == "+4930123"
        # Und falls Prospeo eines Tages doch eine Zeichenkette schickt.
        assert _phone_of({"phone_hq": "+4930123"}) == "+4930123"
        assert _phone_of({"phone_hq": None}) is None
        assert _phone_of({}) is None

    def test_senioritaet_kommt_aus_der_job_historie(self):
        """seniority und departments stehen NICHT oben auf dem Person-Objekt,
        dort sind sie durchgaengig null. Sie haengen am Eintrag in
        job_history mit current=true. Ohne das haette jeder Prospeo-Kontakt
        seniority=None bekommen, und die Kampagnen-Auswahl "nur Entscheider"
        haette nichts mehr zu filtern gehabt."""
        person = {
            "full_name": "Ella Brant",
            "seniority": None,
            "departments": None,
            "job_history": [
                {"title": "Alt", "current": False, "seniority": "Entry", "departments": ["Sales"]},
                {"title": "Customer Support Lead", "current": True,
                 "seniority": "Manager", "departments": ["Customer Service / Support"]},
            ],
        }
        job = _current_job(person)
        assert job["seniority"] == "Manager"

        pair = _map_pair(person, {"name": "X", "domain": "x.com"}, "a@x.com", "VERIFIED")
        assert pair["contact"]["seniority"] == "Manager"
        assert pair["contact"]["department"] == "Customer Service / Support"

    def test_ohne_job_historie_kein_absturz(self):
        assert _current_job({}) == {}
        assert _current_job({"job_history": None}) == {}
        # Kein current=true -> der erste Eintrag ist besser als nichts.
        assert _current_job({"job_history": [{"title": "A", "seniority": "VP"}]})["seniority"] == "VP"

    def test_ohne_website_kein_datensatz(self):
        """Ohne Website gibt es keinen Entdopplungsschluessel; dieselbe
        Regel wie bei Apollo."""
        assert _map_pair({"full_name": "A B"}, {"name": "X"}, "a@b.c", "VERIFIED") is None

    def test_ohne_namen_kein_datensatz(self):
        assert _map_pair({}, {"name": "X", "domain": "x.com"}, "a@b.c", "VERIFIED") is None

    def test_vollstaendige_uebersetzung(self):
        pair = _map_pair(
            {
                "person_id": "p1",
                "first_name": "Sarah",
                "last_name": "Klein",
                "full_name": "Sarah Klein",
                "current_job_title": "Head of Support",
                "job_history": [
                    {"current": True, "seniority": "head", "departments": ["Support", "Operations"]}
                ],
                "linkedin_url": "https://linkedin.com/in/sk",
            },
            {
                "name": "Beispiel GmbH",
                "domain": "beispiel.de",
                "phone_hq": {"phone_hq_national": "+49 30 123"},
                "location": {"city": "Berlin", "country": "Germany"},
            },
            "sarah@beispiel.de",
            "VERIFIED",
        )
        assert pair is not None
        assert pair["business"]["website"] == "https://beispiel.de"
        assert pair["business"]["place_id"] is None
        assert pair["business"]["phone_national"] == "+49 30 123"
        assert pair["contact"]["email"] == "sarah@beispiel.de"
        assert pair["contact"]["source"] == "prospeo"
        # Nur die erste Abteilung, unsere Spalte haelt eine.
        assert pair["contact"]["department"] == "Support"
        assert pair["contact"]["seniority"] == "head"
        assert pair["contact"]["email_verification_status"] == "valid"

    def test_unverifizierte_adresse_bekommt_keinen_gueltig_stempel(self):
        pair = _map_pair(
            {"full_name": "A B"},
            {"name": "X", "domain": "x.com"},
            "a@x.com",
            "UNAVAILABLE",
        )
        assert pair["contact"]["email_verification_status"] is None

    def test_vorname_faellt_auf_den_vollen_namen_zurueck(self):
        pair = _map_pair({"full_name": "Max Mustermann"}, {"name": "X", "domain": "x.com"}, "a@x.com", None)
        assert pair["contact"]["first_name"] == "Max"


class TestCompanySummary:
    def test_zu_duenn_ist_schlechter_als_nichts(self):
        assert build_company_summary({"industry": "Retail"}) is None
        assert build_company_summary({}) is None
        assert build_company_summary(None) is None

    def test_beschreibung_technik_und_branche(self):
        text = build_company_summary(
            {
                "description": "Wir verkaufen Nahrungsergaenzung direkt an Endkunden und "
                "betreiben dafuer einen eigenen Shop mit weltweitem Versand.",
                "technology": {"technology_names": ["Shopify", "Klaviyo", "Gorgias"]},
                "industry": "Health & Wellness",
            }
        )
        assert "Shopify" in text
        assert "Klaviyo" in text
        assert "Branche: Health & Wellness" in text

    def test_beschreibung_wird_gekuerzt(self):
        long = "x" * 5000
        text = build_company_summary({"description": long, "industry": "Retail"})
        assert len(text) < 2500


def test_konstanten_entsprechen_prospeos_vorgaben():
    """Von Prospeo fest vorgegeben, nicht von uns gewaehlt: wer sie aendert,
    aendert gegen die API."""
    assert PER_PAGE == 25
    assert BULK_ENRICH_CHUNK == 50
    assert len(HEADCOUNT_RANGES) == 11
    assert len(REVENUE_TIERS) == 14
