"""Unit-Tests fuer worker.dedupe (kein Netz, keine DB)."""
from worker.dedupe import filter_blocking

BUSINESSES = [
    {"id": "b1", "website": "https://aktiv.com", "place_id": None, "search_id": "s-aktiv"},
    {"id": "b2", "website": "https://papierkorb.com", "place_id": None, "search_id": "s-geloescht"},
    {"id": "b3", "website": "https://kontaktiert.com", "place_id": None, "search_id": "s-geloescht"},
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
    """Auch wenn ihre Suche im Papierkorb liegt -- sonst entstuenden neue
    Kontaktzeilen mit Status 'new' und dieselbe Person wuerde ein zweites Mal
    angeschrieben."""
    blocking = filter_blocking(BUSINESSES, {"s-aktiv"}, {"b3"})
    ids = [b["id"] for b in blocking]
    assert "b3" in ids
    assert "b2" not in ids


def test_ohne_aktive_suchen_und_ohne_kontakte_ist_nichts_gesperrt():
    """Genau der real aufgetretene Zustand: alle Firmen stammten aus
    geloeschten Suchen, niemand war kontaktiert -- die Suche war komplett
    blockiert."""
    assert filter_blocking(BUSINESSES, set(), set()) == []


def test_business_ohne_search_id_blockiert_nicht():
    orphan = [{"id": "b9", "website": "https://waise.com", "place_id": None, "search_id": None}]
    assert filter_blocking(orphan, {"s-aktiv"}, set()) == []
