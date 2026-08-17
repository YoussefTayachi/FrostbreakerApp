"""Unit-Tests fuer worker.email_classify (kein Netz, keine DB).

Hintergrund: sayhello@magnetik.com wurde als personenbezogen eingestuft und
landete so in einer Lead-Liste — obwohl die App ausdruecklich verspricht, nur
persoenliche Adressen zu liefern und keine info@/office@-Sammelpostfaecher.
"""
from worker.email_classify import classify_email


def test_hunter_typ_hat_vorrang():
    assert classify_email("irgendwas@x.com", hunter_type="generic") == "generic"
    assert classify_email("info@x.com", hunter_type="personal") == "personal"


def test_echte_personen_bleiben_personal():
    for email in [
        "john.smith@agency.com",
        "j.doe@agency.com",
        "maria@agency.com",
        "kim-sidoriak@agency.com",
        "saba.said@innergroup.com",
    ]:
        assert classify_email(email) == "personal", email


def test_klassische_rollenadressen():
    for email in ["info@x.com", "office@x.com", "kontakt@x.de", "no-reply@x.com"]:
        assert classify_email(email) == "generic", email


def test_rollenadresse_mit_fuellpraefix():
    """Real aufgetreten: sayhello@ rutschte als 'personal' durch."""
    for email in ["sayhello@magnetik.com", "getintouch@x.com", "letstalk@x.com", "weare@x.com"]:
        assert classify_email(email) == "generic", email


def test_rollenadresse_mit_trennzeichen():
    for email in ["new.business@x.com", "info-us@x.com", "hello_team@x.com"]:
        assert classify_email(email) == "generic", email


def test_rollenadresse_mit_ziffern():
    assert classify_email("info2024@x.com") == "generic"


def test_plus_adressierung_wird_abgeschnitten():
    assert classify_email("info+newsletter@x.com") == "generic"
    assert classify_email("john.smith+leads@x.com") == "personal"


def test_agentur_sammelpostfaecher():
    for email in ["newbusiness@x.com", "studio@x.com", "projects@x.com", "partnerships@x.com"]:
        assert classify_email(email) == "generic", email


def test_ohne_email_ist_unbekannt():
    assert classify_email(None) is None
    assert classify_email("") is None
    assert classify_email("kein-at-zeichen") is None
