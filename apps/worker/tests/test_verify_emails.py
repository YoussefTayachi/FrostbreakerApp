"""NeverBounce je Liste: wer geprueft wird und wer in die Catch-all-Liste wandert."""

from worker.pipelines import verify_emails as ve


def test_apollo_status_zaehlt_nicht_als_geprueft():
    c = {"email": "a@shop.com", "email_verification_status": "verified", "source": "apollo"}
    assert ve.needs_neverbounce(c)


def test_nichts_wird_zweimal_bezahlt():
    c = {
        "email": "a@shop.com",
        "email_verification_status": "catchall",
        "email_verified_by": "neverbounce",
        "source": "apollo",
    }
    assert not ve.needs_neverbounce(c)


def test_instantly_bounce_wird_nicht_nochmal_geprueft():
    c = {
        "email": "a@shop.com",
        "email_verification_status": "invalid",
        "email_verified_by": "instantly_bounce",
        "source": "apollo",
    }
    assert not ve.needs_neverbounce(c)


def test_hunter_status_bleibt_stehen():
    c = {"email": "a@shop.com", "email_verification_status": "valid", "source": "hunter"}
    assert not ve.needs_neverbounce(c)


def test_ohne_status_und_ohne_adresse():
    assert ve.needs_neverbounce({"email": "a@shop.com", "source": "manual"})
    assert not ve.needs_neverbounce({"email": None, "source": "apollo"})


def _c(biz, status, email="x@y.com"):
    return {"business_id": biz, "email": email, "email_verification_status": status}


def test_catchall_firma_wandert():
    assert ve.risky_businesses([_c("b1", "catchall"), _c("b2", "valid")]) == {"b1"}


def test_unknown_gilt_als_riskant():
    assert ve.risky_businesses([_c("b1", "unknown"), _c("b1", "accept_all")]) == {"b1"}


def test_gemischte_firma_bleibt():
    """Eine belegte Adresse reicht: angeschrieben wird ohnehin eine Person je Firma."""
    assert ve.risky_businesses([_c("b1", "catchall"), _c("b1", "valid")]) == set()


def test_invalid_gehoert_nicht_in_die_catchall_liste():
    """invalid sortiert die Kampagne selbst aus (lib/contacts.ts)."""
    assert ve.risky_businesses([_c("b1", "invalid")]) == set()


def test_kontakte_ohne_adresse_zaehlen_nicht():
    assert ve.risky_businesses([_c("b1", "catchall"), _c("b1", None, email=None)]) == {"b1"}
