"""Die Kostenrechnung.

Nur die reine Funktion: record() schreibt in die Datenbank und faengt jeden
Fehler selbst ab, dafuer braucht es hier keinen Test.
"""

import pytest

from worker import usage


class TestOpenaiCostUsd:
    def test_ein_und_ausgabe_getrennt(self):
        # Muss mit openaiCostUsd in apps/web/lib/usage.ts uebereinstimmen.
        assert usage.openai_cost_usd(1_000_000, 0) == pytest.approx(0.40)
        assert usage.openai_cost_usd(0, 1_000_000) == pytest.approx(1.60)

    def test_gecachte_tokens_sind_teil_der_eingabe(self):
        """Der Punkt, an dem sich die Zahl leicht vervierfacht.

        OpenAI meldet input_tokens als Gesamtsumme und cached_tokens als
        Anteil DARIN. Wer den Anteil zusaetzlich zum vollen Eingangspreis
        rechnet, verbucht den Beispiel-Vorspann viermal zu teuer.
        """
        assert usage.openai_cost_usd(1_000_000, 0, 1_000_000) == pytest.approx(0.10)
        # Halb gecacht: die Haelfte zum vollen, die Haelfte zum Cache-Preis.
        assert usage.openai_cost_usd(1_000_000, 0, 500_000) == pytest.approx(0.25)

    def test_mehr_gecacht_als_eingang_wird_nicht_negativ(self):
        """Kaeme so eine Meldung je zurueck, waere ein Minusbetrag schlimmer
        als eine zu hohe Zahl: er zoege die Summe der ganzen Suche herunter."""
        assert usage.openai_cost_usd(100, 0, 999_999) >= 0


def test_preise_je_modell_und_websuche():
    from worker import usage as u

    mini = u.openai_cost_usd(1_000_000, 0, 0, model="gpt-4.1-mini-2025-04-14")
    gross = u.openai_cost_usd(1_000_000, 0, 0, model="gpt-4.1-2025-04-14")
    assert round(mini, 2) == 0.40
    assert round(gross, 2) == 2.00
    assert round(u.openai_cost_usd(0, 1_000_000, 0, model="gpt-4.1"), 2) == 8.00
    # Unbekanntes Modell: mini-Tarif wie bisher, nie 0.
    assert round(u.openai_cost_usd(1_000_000, 0, 0, model="irgendwas"), 2) == 0.40

    class _O:
        def __init__(self, type):
            self.type = type

    class _R:
        output = [_O("web_search_call"), _O("message")]

    assert u.web_search_calls(_R()) == 1
    assert u.OPENAI_USD_PER_WEB_SEARCH_CALL == 0.01
