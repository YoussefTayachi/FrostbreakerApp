"""Tests gegen die ECHTEN Fehlertexte aus public.jobs (Stand 2026-08-03).

Ausgedachte Beispiele haetten hier wenig Wert: der springende Punkt ist, dass
OpenAI bei aufgebrauchtem Guthaben denselben Code 429 schickt wie bei blosser
Drosselung. Nur der Wortlaut trennt die beiden, und der ist so, wie er ist,
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

# Anthropic. Woertlich aus der Doku, nachgesehen am 2026-08-22 auf
# https://platform.claude.com/docs/en/api/errors (402) und
# https://platform.claude.com/docs/en/api/rate-limits (400 und 429), in der
# Form, in der das Python-SDK sie als Fehlertext ausgibt.
#
# Der springende Punkt: bei Anthropic sind es DREI verschiedene Codes fuer
# dasselbe Geldproblem, und einer davon ist ein 429 mit demselben Typ wie eine
# gewoehnliche Drosselung.
ANTHROPIC_BILLING = (
    "Error code: 402 - {'type': 'error', 'error': {'type': 'billing_error', "
    "'message': \"There's an issue with your billing or payment information.\"}}"
)

ANTHROPIC_OWN_SPEND_LIMIT = (
    "Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', "
    "'message': 'You have reached your specified API usage limits. You will regain "
    "access on 2026-09-01 at 00:00 UTC.'}}"
)

ANTHROPIC_WORKSPACE_SPEND_LIMIT = (
    "Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', "
    "'message': 'You have reached your specified workspace API usage limits. You will "
    "regain access on 2026-09-01 at 00:00 UTC.'}}"
)

ANTHROPIC_TIER_SPEND_CAP = (
    "Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', "
    "'message': \"You have reached your API usage limits: your organization has "
    "crossed its monthly API usage threshold, set based on your organization's API "
    "tier. You will regain access on 2026-09-01 at 00:00 UTC.\", "
    "'details': {'error_code': 'enforced_spend_limit_reached'}}, "
    "'request_id': 'req_018EeWyXxfu5pfWkrYcMdjWG'}"
)

# Eine echte Drosselung bei Anthropic, also der Fall, der sich von allein loest.
ANTHROPIC_RATE_LIMIT = (
    "Error code: 429 - {'type': 'error', 'error': {'type': 'rate_limit_error', "
    "'message': 'Number of request tokens has exceeded your per-minute rate limit'}}"
)


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

    def test_429_nur_als_eigenstaendige_zahl(self):
        """Eine request_id, in der zufaellig '429' steckt, ist keine Drosselung.

        Anthropic haengt an jeden Fehler eine request_id der Form
        'req_018EeWyXxfu5pfWkrYcMdjWG'. Der frueher hier stehende blanke
        Teilstring '429' haette darin getroffen und einen gewoehnlichen Fehler
        still zurueckgestellt, statt ihn zu melden.
        """
        assert classify_error("req_011CS429abc parse failed") is None
        assert classify_error("read 1429 rows") is None


class TestAnthropicGuthaben:
    """Bei Anthropic ist die Guthaben-Meldung nicht ein Fall, sondern drei."""

    def test_402_billing_error(self):
        assert classify_error(ANTHROPIC_BILLING) == "out_of_credit"

    def test_400_eigenes_ausgabelimit(self):
        assert classify_error(ANTHROPIC_OWN_SPEND_LIMIT) == "out_of_credit"
        assert classify_error(ANTHROPIC_WORKSPACE_SPEND_LIMIT) == "out_of_credit"

    def test_429_monatsdeckel_ist_kein_ratelimit(self):
        """Der gefaehrlichste Fall: Code UND Typ sind die einer Drosselung.

        Laut Doku scheitert Wiederholen hier bis zum Monatswechsel, und es
        kommt kein retry-after-Header. Als 'rate_limited' eingestuft wuerde
        der Job seine Versuche gegen eine Wand fahren, genau wie am
        2026-08-03 bei OpenAI.
        """
        assert classify_error(ANTHROPIC_TIER_SPEND_CAP) == "out_of_credit"

    def test_echte_drosselung_bleibt_drosselung(self):
        assert classify_error(ANTHROPIC_RATE_LIMIT) == "rate_limited"


class TestProviderFromError:
    def test_aus_der_url(self):
        assert provider_from_error(HUNTER_RATE_LIMIT) == "hunter"
        assert provider_from_error("https://api.apollo.io/v1/x failed") == "apollo"
        assert provider_from_error("https://api.openai.com/v1/responses 500") == "openai"

    def test_url_schlaegt_job_typ(self):
        """Die URL ist die verlaesslichere Quelle, sie steht direkt im Fehler."""
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

    def test_hinweis_der_pipeline_schlaegt_den_job_typ(self):
        """personalize kann seit Migration 0097 auch ueber Claude laufen.

        Der Fehlertext des Anthropic-SDK traegt keine URL, der Job-Typ sagt
        weiterhin 'openai'. Ohne den Hinweis der Pipeline ginge der
        Guthaben-Alarm eines Claude-Workspaces an den falschen Anbieter, und
        der Nutzer wuerde ein OpenAI-Konto aufladen, das gar nicht leer ist.
        """
        assert (
            provider_from_error(ANTHROPIC_BILLING, "personalize", provider_hint="anthropic")
            == "anthropic"
        )
        assert (
            provider_from_error(ANTHROPIC_TIER_SPEND_CAP, "personalize", provider_hint="anthropic")
            == "anthropic"
        )

    def test_url_schlaegt_auch_den_hinweis(self):
        """Die URL steht direkt im Fehler und kann deshalb nicht veralten."""
        assert (
            provider_from_error(HUNTER_RATE_LIMIT, "personalize", provider_hint="anthropic")
            == "hunter"
        )

    def test_anthropic_url_wird_erkannt(self):
        """Verbindungsfehler meldet httpx mit URL, anders als das SDK."""
        assert provider_from_error("ConnectError for https://api.anthropic.com/v1/messages") == (
            "anthropic"
        )

    def test_ohne_hinweis_bleibt_openai_die_voreinstellung(self):
        """Der Regelfall darf seinen Alarm nicht verlieren."""
        assert provider_from_error(OPENAI_NO_CREDITS, "personalize") == "openai"
