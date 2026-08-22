"""Der Claude-Pfad der Personalisierung.

Geprueft wird das, woran Few-Shot in der Praxis scheitert: die REIHENFOLGE und
die FORM der Turns. Ein Beispiel, das an der falschen Stelle steht oder anders
aussieht als die echte Anfrage, bringt dem Modell eine andere Abbildung bei als
die gemeinte, und man sieht es dem Ergebnis nicht an, weil trotzdem ein
plausibler Satz herauskommt.

Kein Netz: der Anthropic-Client wird durch eine Attrappe ersetzt, die die
Anfrage nur festhaelt.
"""
from typing import ClassVar

import pytest

from worker.pipelines import personalize


class FakeBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class FakeResponse:
    def __init__(self, text: str = "Ihr seid seit 2011 dabei, deswegen melde ich mich."):
        self.content = [FakeBlock(text)]
        self.stop_reason = "end_turn"
        self.usage = None


class FakeMessages:
    def __init__(self, store: dict, response: FakeResponse):
        self._store = store
        self._response = response

    def create(self, **kwargs):
        self._store["calls"] = self._store.get("calls", []) + [kwargs]
        return self._response


class FakeAnthropic:
    """Attrappe fuer anthropic.Anthropic. Merkt sich die letzte Anfrage."""

    store: ClassVar[dict] = {}
    response = FakeResponse()

    def __init__(self, api_key: str | None = None):
        FakeAnthropic.store["api_key"] = api_key
        self.messages = FakeMessages(FakeAnthropic.store, FakeAnthropic.response)


@pytest.fixture
def fake_claude(monkeypatch):
    FakeAnthropic.store = {}
    FakeAnthropic.response = FakeResponse()
    monkeypatch.setattr(personalize, "Anthropic", FakeAnthropic)
    return FakeAnthropic.store


EXAMPLES = [
    {"input_context": "Bäckerei Meier, seit 1912, drei Filialen.", "icebreaker": "Drei Filialen seit 1912."},
    {"input_context": "Autohaus Nord, Elektro-Umbau 2024.", "icebreaker": "Der Elektro-Umbau 2024 fällt auf."},
]


class TestNachrichtenaufbau:
    def test_system_prompt_steht_im_system_feld(self, fake_claude):
        personalize.generate_claude("Muster GmbH", "Kontext", "sk-x", "SYSTEM", examples=EXAMPLES)
        call = fake_claude["calls"][0]
        assert call["system"][0]["text"] == "SYSTEM"
        assert call["model"] == personalize.CLAUDE_MODEL

    def test_reihenfolge_beispiele_dann_echte_anfrage(self, fake_claude):
        personalize.generate_claude("Muster GmbH", "Kontext", "sk-x", "SYSTEM", examples=EXAMPLES)
        msgs = fake_claude["calls"][0]["messages"]
        assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant", "user"]
        # Beispiel-User-Turn: der hinterlegte Kontext, unveraendert.
        assert msgs[0]["content"] == EXAMPLES[0]["input_context"]
        assert msgs[2]["content"] == EXAMPLES[1]["input_context"]
        # Beispiel-Assistant-Turn: die blanke Zeile, ohne Anfuehrungszeichen
        # und ohne Label.
        assert msgs[1]["content"][0]["text"] == EXAMPLES[0]["icebreaker"]
        assert msgs[3]["content"][0]["text"] == EXAMPLES[1]["icebreaker"]
        # Die echte Anfrage steht ganz hinten, in der Form von generate().
        assert msgs[4]["content"] == "Unternehmen: Muster GmbH\n\nKontext"

    def test_korrektur_haengt_am_letzten_turn(self, fake_claude):
        personalize.generate_claude(
            "Muster GmbH", "Kontext", "sk-x", "SYSTEM",
            correction="zu lang (40 statt max. 35 Wörter)", examples=EXAMPLES,
        )
        msgs = fake_claude["calls"][0]["messages"]
        assert "zu lang" in msgs[-1]["content"]
        assert msgs[-1]["content"].startswith("Unternehmen: Muster GmbH")
        # An keinem Beispiel: sonst lernt das Modell, dass zu jedem Kontext
        # eine Ruege gehoert.
        for m in msgs[:-1]:
            text = m["content"] if isinstance(m["content"], str) else m["content"][0]["text"]
            assert "zu lang" not in text

    def test_cache_punkt_am_ende_des_geteilten_vorspanns(self, fake_claude):
        personalize.generate_claude("Muster GmbH", "Kontext", "sk-x", "SYSTEM", examples=EXAMPLES)
        call = fake_claude["calls"][0]
        msgs = call["messages"]
        # Genau EIN Punkt, und zwar auf dem letzten Beispiel. Ein Punkt auf der
        # echten Anfrage wuerde je Lead einen eigenen Eintrag schreiben und nie
        # einen lesen.
        assert msgs[3]["content"][0]["cache_control"] == {"type": "ephemeral"}
        assert "cache_control" not in msgs[1]["content"][0]
        assert "cache_control" not in call["system"][0]
        assert isinstance(msgs[4]["content"], str)  # letzter Turn: kein Blockformat, kein Punkt

    def test_ohne_beispiele_cache_punkt_auf_dem_system_prompt(self, fake_claude):
        personalize.generate_claude("Muster GmbH", "Kontext", "sk-x", "SYSTEM", examples=[])
        call = fake_claude["calls"][0]
        assert call["system"][0]["cache_control"] == {"type": "ephemeral"}
        assert [m["role"] for m in call["messages"]] == ["user"]

    def test_antwort_wird_entpackt(self, fake_claude):
        FakeAnthropic.response = FakeResponse('"Drei Filialen seit 1912."')
        line = personalize.generate_claude("Muster GmbH", "Kontext", "sk-x", "SYSTEM")
        assert line == "Drei Filialen seit 1912."

    def test_ablehnung_ist_kein_leerer_icebreaker(self, fake_claude):
        FakeAnthropic.response = FakeResponse("")
        FakeAnthropic.response.stop_reason = "refusal"
        with pytest.raises(personalize.ClaudeRefused):
            personalize.generate_claude("Muster GmbH", "Kontext", "sk-x", "SYSTEM")


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
