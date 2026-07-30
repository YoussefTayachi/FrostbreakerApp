"""Unit-Tests fuer worker.http_safety (kein Netz, keine DB)."""
import httpx

from worker.http_safety import raise_for_status_safe, redact_url


def test_redact_url_strips_hunter_api_key():
    url = "https://api.hunter.io/v2/discover?api_key=e367bdf7937ea738465571351bd61a707a2c8ee2&limit=100&offset=100"
    result = redact_url(url)
    assert "e367bdf7937ea738465571351bd61a707a2c8ee2" not in result
    assert "api_key=***" in result
    assert "limit=100" in result
    assert "offset=100" in result


def test_redact_url_strips_google_maps_key():
    url = "https://maps.googleapis.com/maps/api/geocode/json?address=Vienna&key=AIzaSyABCDEF1234567890"
    result = redact_url(url)
    assert "AIzaSyABCDEF1234567890" not in result
    assert "key=***" in result
    assert "address=Vienna" in result


def test_redact_url_noop_without_secret_params():
    url = "https://api.hunter.io/v2/discover?limit=100&offset=100"
    assert redact_url(url) == url


def test_raise_for_status_safe_redacts_key_in_exception_message():
    request = httpx.Request("GET", "https://api.hunter.io/v2/discover?api_key=SECRET123&offset=100")
    response = httpx.Response(400, request=request)
    try:
        raise_for_status_safe(response)
        assert False, "sollte werfen"
    except httpx.HTTPStatusError as e:
        assert "SECRET123" not in str(e)
        assert "400" in str(e)


def test_raise_for_status_safe_includes_response_body():
    """Ohne den Body steht in searches.error nur '400 Bad Request' -- und man
    raet, welcher Filter schuld war."""
    request = httpx.Request("POST", "https://api.hunter.io/v2/discover?api_key=SECRET123")
    response = httpx.Response(
        400,
        request=request,
        json={"errors": [{"details": "Invalid value for headquarters_location.city"}]},
    )
    try:
        raise_for_status_safe(response)
        assert False, "sollte werfen"
    except httpx.HTTPStatusError as e:
        assert "headquarters_location.city" in str(e)
        assert "SECRET123" not in str(e)


def test_raise_for_status_safe_redacts_key_echoed_in_body():
    request = httpx.Request("POST", "https://api.hunter.io/v2/discover?api_key=SECRET123")
    response = httpx.Response(
        400, request=request, text="Bad request: /v2/discover?api_key=SECRET123&offset=100"
    )
    try:
        raise_for_status_safe(response)
        assert False, "sollte werfen"
    except httpx.HTTPStatusError as e:
        assert "SECRET123" not in str(e)


def test_raise_for_status_safe_truncates_long_body():
    request = httpx.Request("POST", "https://api.hunter.io/v2/discover")
    response = httpx.Response(500, request=request, text="x" * 5000)
    try:
        raise_for_status_safe(response)
        assert False, "sollte werfen"
    except httpx.HTTPStatusError as e:
        assert len(str(e)) < 1000


def test_raise_for_status_safe_noop_on_success():
    request = httpx.Request("GET", "https://api.hunter.io/v2/discover?api_key=SECRET123")
    response = httpx.Response(200, request=request)
    raise_for_status_safe(response)  # soll nicht werfen
