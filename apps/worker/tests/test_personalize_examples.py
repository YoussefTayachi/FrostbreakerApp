"""Die hinterlegten Few-Shot-Beispiele der Personalisierung.

Kein Netz: geprueft wird ausschliesslich, was load_examples aus der Datenbank
macht.
"""
from worker.pipelines import personalize


class FakeQuery:
    """Minimale Attrappe der Supabase-Query-Kette."""

    def __init__(self, rows):
        self._rows = rows

    def __getattr__(self, _name):
        def chained(*_args, **_kwargs):
            return self

        return chained

    def execute(self):
        return type("Result", (), {"data": self._rows})()


class TestLoadExamples:
    def _load(self, monkeypatch, rows):
        monkeypatch.setattr(personalize, "sb", lambda: FakeQuery(rows))
        return personalize.load_examples("ws-1")

    def test_halbe_paare_fliegen_raus(self, monkeypatch):
        rows = [
            {"input_context": "voll", "icebreaker": "auch voll", "sort_order": 0},
            {"input_context": "nur Kontext", "icebreaker": "", "sort_order": 1},
            {"input_context": "", "icebreaker": "nur Zeile", "sort_order": 2},
            {"input_context": "   ", "icebreaker": "  ", "sort_order": 3},
            {"input_context": None, "icebreaker": None, "sort_order": 4},
        ]
        assert self._load(monkeypatch, rows) == [
            {"input_context": "voll", "icebreaker": "auch voll"}
        ]

    def test_reihenfolge_bleibt_wie_geliefert(self, monkeypatch):
        rows = [
            {"input_context": "a", "icebreaker": "A", "sort_order": 0},
            {"input_context": "b", "icebreaker": "B", "sort_order": 1},
        ]
        assert [e["icebreaker"] for e in self._load(monkeypatch, rows)] == ["A", "B"]

    def test_leere_tabelle(self, monkeypatch):
        assert self._load(monkeypatch, []) == []
        assert self._load(monkeypatch, None) == []
