"""Die hinterlegten Few-Shot-Beispiele der Personalisierung.

Kein Netz: geprueft wird, was load_examples aus der Datenbank macht und wie
build_input die Beispiele in die Anfrage haengt.

Bei build_input sind REIHENFOLGE und FORM der Turns der Kern. Daran scheitert
Few-Shot in der Praxis: ein Beispiel, das an der falschen Stelle steht oder
anders aussieht als die echte Anfrage, bringt dem Modell eine andere Abbildung
bei als die gemeinte, und man sieht es dem Ergebnis nicht an, weil trotzdem ein
plausibler Satz herauskommt.
"""
from worker.pipelines import personalize

EXAMPLES = [
    {"input_context": "Bäckerei Meier, seit 1912, drei Filialen.", "icebreaker": "Drei Filialen seit 1912."},
    {"input_context": "Autohaus Nord, Elektro-Umbau 2024.", "icebreaker": "Der Elektro-Umbau 2024 fällt auf."},
]


class TestBuildInput:
    def test_reihenfolge_system_beispiele_echte_anfrage(self):
        items = personalize.build_input("SYSTEM", "Muster GmbH", "Kontext", EXAMPLES)
        assert [i["role"] for i in items] == ["system", "user", "assistant", "user", "assistant", "user"]
        assert items[0]["content"] == "SYSTEM"
        # Beispiel-User-Turn: der hinterlegte Kontext, unveraendert.
        assert items[1]["content"] == EXAMPLES[0]["input_context"]
        assert items[3]["content"] == EXAMPLES[1]["input_context"]
        # Beispiel-Assistant-Turn: die blanke Zeile, ohne Anfuehrungszeichen
        # und ohne Label.
        assert items[2]["content"] == EXAMPLES[0]["icebreaker"]
        assert items[4]["content"] == EXAMPLES[1]["icebreaker"]
        # Die echte Anfrage steht ganz hinten: das ist die Reihenfolge, die
        # OpenAI fuers Praefix-Caching verlangt (statischer Teil zuerst).
        assert items[5]["content"] == "Unternehmen: Muster GmbH\n\nKontext"

    def test_ohne_beispiele_wie_vorher(self):
        items = personalize.build_input("SYSTEM", "Muster GmbH", "Kontext")
        assert [i["role"] for i in items] == ["system", "user"]
        assert items[1]["content"] == "Unternehmen: Muster GmbH\n\nKontext"

    def test_korrektur_haengt_am_letzten_turn(self):
        items = personalize.build_input(
            "SYSTEM", "Muster GmbH", "Kontext", EXAMPLES,
            correction="zu lang (40 statt max. 35 Wörter)",
        )
        assert "zu lang" in items[-1]["content"]
        assert items[-1]["content"].startswith("Unternehmen: Muster GmbH")
        # An keinem Beispiel: sonst lernt das Modell, dass zu jedem Kontext
        # eine Ruege gehoert.
        for item in items[:-1]:
            assert "zu lang" not in item["content"]


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
