"""Unit-Tests fuer worker.dedupe (kein Netz, keine DB)."""

from worker.dedupe import archive_as_businesses, filter_blocking

BUSINESSES = [
    {"id": "b1", "website": "https://aktiv.com", "place_id": None, "search_id": "s-aktiv"},
    {"id": "b2", "website": "https://papierkorb.com", "place_id": None, "search_id": "s-geloescht"},
    {
        "id": "b3",
        "website": "https://kontaktiert.com",
        "place_id": None,
        "search_id": "s-geloescht",
    },
]


def test_firmen_aus_aktiven_suchen_bleiben_gesperrt():
    blocking = filter_blocking(BUSINESSES, {"s-aktiv"}, set())
    assert [b["id"] for b in blocking] == ["b1"]


def test_firmen_aus_geloeschten_suchen_sind_wieder_findbar():
    """Kernfall: Papierkorb heisst 'diese Liste will ich nicht mehr', nicht
    'diese Firma nie wieder finden'."""
    blocking = filter_blocking(BUSINESSES, {"s-aktiv"}, set())
    assert "b2" not in [b["id"] for b in blocking]


def test_bereits_kontaktierte_firmen_bleiben_gesperrt():
    """Auch wenn ihre Suche im Papierkorb liegt; sonst entstuenden neue
    Kontaktzeilen mit Status 'new' und dieselbe Person wuerde ein zweites Mal
    angeschrieben."""
    blocking = filter_blocking(BUSINESSES, {"s-aktiv"}, {"b3"})
    ids = [b["id"] for b in blocking]
    assert "b3" in ids
    assert "b2" not in ids


def test_ohne_aktive_suchen_und_ohne_kontakte_ist_nichts_gesperrt():
    """Genau der real aufgetretene Zustand: alle Firmen stammten aus
    geloeschten Suchen, niemand war kontaktiert, die Suche war komplett
    blockiert."""
    assert filter_blocking(BUSINESSES, set(), set()) == []


def test_business_ohne_search_id_blockiert_nicht():
    orphan = [{"id": "b9", "website": "https://waise.com", "place_id": None, "search_id": None}]
    assert filter_blocking(orphan, {"s-aktiv"}, set()) == []


# ── contact_archive (Migration 0095) ────────────────────────────────────────


def test_archiv_wird_zur_sperrmenge():
    """Der eigentliche Zweck: die Firma ist als Zeile weg, die Sperre bleibt."""
    rows = archive_as_businesses([{"domain": "geloescht.com", "company_name": "Geloescht GmbH"}])
    assert rows == [
        {
            "id": None,
            "name": "Geloescht GmbH",
            "website": "geloescht.com",
            "place_id": None,
            "from_archive": True,
        }
    ]


def test_mehrere_kontakte_derselben_firma_ergeben_eine_sperre():
    """Drei angeschriebene Entscheider sind eine Firma, nicht drei."""
    rows = archive_as_businesses(
        [
            {"domain": "firma.com", "company_name": "Firma"},
            {"domain": "FIRMA.com", "company_name": "firma"},
            {"domain": "firma.com", "company_name": "Firma"},
        ]
    )
    assert len(rows) == 1


def test_archivzeile_ohne_domain_und_name_faellt_raus():
    """Ein Kontakt ohne Firmenangabe kann nichts sperren; er wuerde als
    leerer Eintrag jede Suche mit leerem Namen blockieren."""
    assert archive_as_businesses([{"domain": None, "company_name": None}]) == []


def test_archivzeile_nur_mit_namen_bleibt():
    """Apollos Vorschau kennt nur Namen, deshalb reicht der Name allein."""
    rows = archive_as_businesses([{"domain": None, "company_name": "Nur Name AG"}])
    assert rows[0]["name"] == "Nur Name AG"
    assert rows[0]["website"] is None


def test_sperrquellen_werden_seitenweise_gelesen():
    """PostgREST liefert hoechstens 1000 Zeilen je Abfrage (2026-09-29: 1.179
    Firmen, 87 von 91 Dubletten). _alle muss weiterblaettern."""
    from worker import dedupe

    daten = [{"id": i} for i in range(2500)]

    class Abfrage:
        def range(self, a, b):
            self.a, self.b = a, b
            return self

        def execute(self):
            class R:
                pass

            r = R()
            r.data = daten[self.a : self.b + 1]
            return r

    assert len(dedupe._alle(lambda: Abfrage())) == 2500
