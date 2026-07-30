"""Unit-Tests fuer worker.search_state (kein Netz, keine DB)."""
from worker.search_state import search_is_deleted, search_source


def test_search_source_wird_gelesen():
    """Entscheidet, ob Hunter als Rueckfallebene ueberhaupt noch aussteht."""
    assert search_source({"searches": {"source": "corporate"}}) == "corporate"
    assert search_source({"searches": [{"source": "maps"}]}) == "maps"


def test_search_source_ohne_beziehung_ist_none():
    assert search_source({}) is None
    assert search_source({"searches": None}) is None


def test_deleted_search_is_detected_as_object():
    assert search_is_deleted({"searches": {"deleted_at": "2026-07-30T10:00:00+00:00"}}) is True


def test_deleted_search_is_detected_as_list():
    """PostgREST liefert je nach Abfrage/Version auch eine einelementige Liste."""
    assert search_is_deleted({"searches": [{"deleted_at": "2026-07-30T10:00:00+00:00"}]}) is True


def test_active_search_is_not_deleted():
    assert search_is_deleted({"searches": {"deleted_at": None}}) is False
    assert search_is_deleted({"searches": [{"deleted_at": None}]}) is False


def test_missing_relation_is_treated_as_active():
    """Im Zweifel anreichern statt still zu ueberspringen -- ein fehlendes
    Feld darf nicht dazu fuehren, dass echte Leads unbearbeitet bleiben."""
    assert search_is_deleted({}) is False
    assert search_is_deleted({"searches": None}) is False
    assert search_is_deleted({"searches": []}) is False
