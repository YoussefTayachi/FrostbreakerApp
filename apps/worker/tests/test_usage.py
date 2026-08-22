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
