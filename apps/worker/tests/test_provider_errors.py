"""Tests gegen die ECHTEN Fehlertexte aus public.jobs (Stand 2026-08-03).

Ausgedachte Beispiele haetten hier wenig Wert: der springende Punkt ist, dass
OpenAI bei aufgebrauchtem Guthaben denselben Code 429 schickt wie bei blosser
Drosselung. Nur der Wortlaut trennt die beiden, und der ist so, wie er ist --
nicht so, wie man ihn sich ausdenken wuerde.
"""
from worker.provider_errors import classify_error, provider_from_error

# Woertlich aus jobs.last_error, 88x personalize + 40x find_decisionmaker.
OPENAI_NO_CREDITS = (
    "Error code: 429 - {'error': {'message': 'You have no credits remaining. "
    "Add credits to continue using the API', 'type': 'insufficient_quota'}}"
)

# Woertlich aus jobs.last_error, hunt_persons.
HUNTER_RATE_LIMIT = (
    "Client error '429 Too Many Requests' for url "
    "'https://api.hunter.io/v2/domain-search?domain=marketing1on1.com&limit=10'"
)

# Ebenfalls echt, aber ein gewoehnlicher Fehler ohne Anbieter-Bezug.
PARSE_ERROR = "'email\\xa0protected' does not appear to be an IPv4 or IPv6 address"

MISSING_KEY = "Kein API-Key fuer Provider 'google_maps' hinterlegt"


class TestClassifyError:
    def test_openai_ohne_guthaben_ist_kein_ratelimit(self):
        """Der eigentliche Kern: 429 UND 'no credits' -> Guthaben, nicht Drosselung."""
        assert classify_error(OPENAI_NO_CREDITS) == "out_of_credit"

    def test_hunter_drosselung(self):
        assert classify_error(HUNTER_RATE_LIMIT) == "rate_limited"

    def test_gewoehnlicher_fehler(self):
        assert classify_error(PARSE_ERROR) is None

    def test_fehlender_key_ist_kein_guthabenproblem(self):
        assert classify_error(MISSING_KEY) is None

    def test_leerer_text(self):
        assert classify_error("") is None
        assert classify_error(None) is None

    def test_weitere_schreibweisen(self):
        assert classify_error("insufficient_quota") == "out_of_credit"
        assert classify_error("You exceeded your current quota") == "out_of_credit"
        assert classify_error("HTTP 402 Payment Required") == "out_of_credit"
        assert classify_error("Quota exceeded for this project") == "out_of_credit"

    def test_gross_und_kleinschreibung_egal(self):
        assert classify_error("NO CREDITS REMAINING") == "out_of_credit"
        assert classify_error("Too Many Requests") == "rate_limited"

    def test_nacktes_429_gilt_als_drosselung(self):
        assert classify_error("Server returned 429") == "rate_limited"


class TestProviderFromError:
    def test_aus_der_url(self):
        assert provider_from_error(HUNTER_RATE_LIMIT) == "hunter"
        assert provider_from_error("https://api.apollo.io/v1/x failed") == "apollo"
        assert provider_from_error("https://api.openai.com/v1/responses 500") == "openai"

    def test_url_schlaegt_job_typ(self):
        """Die URL ist die verlaesslichere Quelle -- sie steht direkt im Fehler."""
        assert provider_from_error(HUNTER_RATE_LIMIT, "personalize") == "hunter"

    def test_rueckfall_auf_job_typ(self):
        assert provider_from_error(OPENAI_NO_CREDITS, "personalize") == "openai"
        assert provider_from_error(OPENAI_NO_CREDITS, "find_decisionmaker") == "openai"
        assert provider_from_error("irgendein fehler", "hunt_persons") == "hunter"

    def test_get_businesses_bleibt_offen(self):
        """Welcher Anbieter dort zustaendig ist, haengt an der Quelle der Suche.
        Lieber kein Anbieter als der falsche."""
        assert provider_from_error("irgendein fehler", "get_businesses") is None

    def test_ohne_hinweis_keine_zuordnung(self):
        assert provider_from_error("irgendein fehler") is None
        assert provider_from_error("") is None
