"""Die Grenze zwischen "erfunden" und "echt mit Ziffern".

Der teuerste Fehler waere hier NICHT, eine erfundene Adresse durchzulassen,
sondern eine echte zu verwerfen: dann verliert ein Lead seinen Kontaktweg,
ohne dass es jemandem auffaellt. Die zweite Haelfte dieser Datei prueft
deshalb bewusst mehr Faelle als die erste.
"""
import pytest

from worker.profile_urls import clean_profile_url

# ── Was sicher erfunden ist ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "url",
    [
        # Der gemessene Fall: 52 Kontakte mit genau dieser Endung (2026-08-22).
        "https://www.linkedin.com/in/john-doe-12345678",
        "https://linkedin.com/in/maria-schmidt-12345678",
        "https://www.linkedin.com/in/12345678",
        # Dieselbe Folge, andere Laenge oder Richtung.
        "https://www.linkedin.com/in/anna-berger-123456789",
        "https://www.linkedin.com/in/anna-berger-87654321",
        # Immer dieselbe Ziffer.
        "https://www.linkedin.com/in/peter-mueller-00000000",
        "https://www.linkedin.com/in/peter-mueller-11111",
        # Platzhalter aus x.
        "https://www.linkedin.com/in/peter-mueller-xxxxxxxx",
        # Platzhalter-Wort statt eines Namens.
        "https://www.linkedin.com/in/username",
        "https://www.linkedin.com/in/your-name",
        "https://www.linkedin.com/in/example",
        "https://www.linkedin.com/in/NA",
        # Kein Profil, nur die Startseite.
        "https://www.linkedin.com",
        "https://www.linkedin.com/",
    ],
)
def test_platzhalter_werden_verworfen(url):
    assert clean_profile_url(url, "linkedin") is None


def test_falsche_plattform_im_feld():
    # Eine Instagram-Adresse im LinkedIn-Feld ist keine Fundstelle, sondern
    # eine Verwechslung -- und im Feld linkedin sicher falsch.
    assert clean_profile_url("https://www.instagram.com/annaberger", "linkedin") is None
    assert clean_profile_url("https://beispiel-gmbh.de/team", "linkedin") is None


def test_leere_werte():
    assert clean_profile_url(None, "linkedin") is None
    assert clean_profile_url("", "linkedin") is None
    assert clean_profile_url("   ", "linkedin") is None


# ── Was stehen bleiben MUSS ──────────────────────────────────────────────

@pytest.mark.parametrize(
    "url",
    [
        # Der Fall aus der Aufgabenstellung: echte Vanity-Endung aus Ziffern
        # UND Buchstaben.
        "https://www.linkedin.com/in/sander-volbeda-1a2b3c4",
        # Ohne Endung.
        "https://www.linkedin.com/in/williamhgates",
        "https://www.linkedin.com/in/anna-berger",
        # Laenderpraefix und Sprachparameter, wie LinkedIn sie selbst vergibt.
        "https://de.linkedin.com/in/anna-berger",
        "https://www.linkedin.com/in/anna-berger?originalSubdomain=de",
        "https://www.linkedin.com/in/anna-berger/",
        # Ohne Schema -- das Modell liefert das durchaus so.
        "linkedin.com/in/anna-berger",
        # Kurzlink.
        "https://lnkd.in/eK3xY9pQ",
        # ZIFFERNENDUNGEN, DIE ECHT SEIN KOENNEN. LinkedIn haengt an haeufige
        # Namen numerische Endungen an; nur eine gleichfoermige Folge ist ein
        # Platzhalter, eine beliebige nicht. Diese Zeilen sind der Grund, warum
        # "endet auf viele Ziffern" allein NICHT als Regel taugt.
        "https://www.linkedin.com/in/anna-berger-40719283",
        "https://www.linkedin.com/in/anna-berger-1234",
        "https://www.linkedin.com/in/anna-berger-2b8a1f",
        "https://www.linkedin.com/in/anna-berger-10432987",
    ],
)
def test_echte_profile_bleiben(url):
    assert clean_profile_url(url, "linkedin") == url


def test_wert_wird_nicht_umgeschrieben():
    # Zurueck kommt genau das Original (nur getrimmt), damit sich die Pruefung
    # spaeter an den Rohdaten nachvollziehen laesst.
    assert clean_profile_url("  https://www.linkedin.com/in/anna-berger  ", "linkedin") == (
        "https://www.linkedin.com/in/anna-berger"
    )


# ── Die anderen drei Felder ──────────────────────────────────────────────

@pytest.mark.parametrize(
    ("url", "platform"),
    [
        ("https://www.instagram.com/annaberger", "instagram"),
        ("https://twitter.com/annaberger", "twitter"),
        ("https://x.com/annaberger", "twitter"),
        ("https://www.facebook.com/anna.berger.9", "facebook"),
    ],
)
def test_weitere_plattformen_bleiben(url, platform):
    assert clean_profile_url(url, platform) == url


@pytest.mark.parametrize(
    ("url", "platform"),
    [
        ("https://www.instagram.com/anna-berger-12345678", "instagram"),
        ("https://x.com/username", "twitter"),
        ("https://www.facebook.com/your-name", "facebook"),
    ],
)
def test_weitere_plattformen_platzhalter(url, platform):
    assert clean_profile_url(url, platform) is None


def test_unbekannte_plattform_wird_durchgelassen():
    # Lieber ungeprueft als nach geratenen Regeln verworfen.
    assert clean_profile_url("https://xing.com/profile/Anna_Berger", "xing") == (
        "https://xing.com/profile/Anna_Berger"
    )
