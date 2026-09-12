"""Die Auswertung einer Mail aus dem Gesendet-Ordner.

Geprueft wird hier ausschliesslich das, was ohne IMAP-Server und ohne
Datenbank entschieden wird: Kopfzeilen lesen, Fliesstext herausholen,
Empfaenger bestimmen, Ordner finden. Die Verdrahtung mit Queue und Datenbank
(_schon_vorhanden, run) braucht beides und ist hier absichtlich nicht dabei.
"""
import email

import pytest

from worker.pipelines import sync_sent

# Die Mail, um die es ging: Youssefs Antwort an Ken Vallens vom 2026-09-12,
# geschrieben in IONOS-Webmail und deshalb fuer Instantly unsichtbar.
KEN = """\
Message-ID: <abc123@marketing.frostbreaker.app>
Date: Sat, 12 Sep 2026 08:04:11 +0200
From: Kontakt Frostbreaker <kontakt@marketing.frostbreaker.app>
To: Ken Vallens <kvallens@CTSCEMENT.com>
Subject: RE: feedback on your site
Content-Type: text/plain; charset="utf-8"

Hi Ken,

That is worth a proper conversation rather than another sample.

Best,
Youssef
"""


def _mail(roh: str):
    return email.message_from_string(roh)


def test_empfaenger_kommen_klein_zurueck():
    # contacts.email steht in gemischter Schreibweise in der Datenbank, der
    # Abgleich laeuft deshalb ueber Kleinschreibung plus ilike.
    assert sync_sent._empfaenger(_mail(KEN)) == ["kvallens@ctscement.com"]


def test_cc_zaehlt_mit():
    roh = KEN.replace("Subject:", "Cc: zweiter@kunde.de\nSubject:")
    assert sync_sent._empfaenger(_mail(roh)) == ["kvallens@ctscement.com", "zweiter@kunde.de"]


def test_ohne_empfaenger_leere_liste():
    roh = "\n".join(z for z in KEN.splitlines() if not z.startswith("To:"))
    assert sync_sent._empfaenger(_mail(roh)) == []


def test_zeitpunkt_kommt_in_utc():
    # 08:04 in Berlin (+02:00) ist 06:04 UTC. Der Zeitstempel entscheidet
    # spaeter ueber den Abgleich mit Altbestand, eine Zeitzonenverschiebung
    # waere dort fuenf Minuten Fenster daneben.
    assert sync_sent._gesendet_am(_mail(KEN)).startswith("2026-09-12T06:04:11")


def test_kaputtes_datum_kippt_nichts():
    roh = KEN.replace("Date: Sat, 12 Sep 2026 08:04:11 +0200", "Date: irgendwann")
    assert sync_sent._gesendet_am(_mail(roh)) is None


def test_text_aus_reiner_textmail():
    assert "That is worth a proper conversation" in sync_sent._text_aus(_mail(KEN))


def test_text_bevorzugt_plain_vor_html():
    roh = (
        "Message-ID: <x@y>\r\n"
        'Content-Type: multipart/alternative; boundary="g"\r\n'
        "\r\n"
        "--g\r\n"
        'Content-Type: text/plain; charset="utf-8"\r\n'
        "\r\n"
        "Der echte Text.\r\n"
        "--g\r\n"
        'Content-Type: text/html; charset="utf-8"\r\n'
        "\r\n"
        "<p>Die HTML-Fassung.</p>\r\n"
        "--g--\r\n"
    )
    assert sync_sent._text_aus(_mail(roh)) == "Der echte Text."


def test_nur_html_faellt_auf_entkernten_text_zurueck():
    # Dieselbe Ueberlegung wie in lib/instantly/email-body.ts: eine
    # Nur-HTML-Mail ohne Rueckfall waere eine leere Zeile im Verlauf.
    roh = (
        "Message-ID: <x@y>\r\n"
        'Content-Type: text/html; charset="utf-8"\r\n'
        "\r\n"
        "<html><head><style>p{color:red}</style></head>"
        "<body><p>Hallo Ken</p><p>Bis morgen</p></body></html>\r\n"
    )
    text = sync_sent._text_aus(_mail(roh))
    assert "Hallo Ken" in text
    assert "Bis morgen" in text
    assert "color:red" not in text


def test_anhang_landet_nicht_im_text():
    roh = (
        "Message-ID: <x@y>\r\n"
        'Content-Type: multipart/mixed; boundary="g"\r\n'
        "\r\n"
        "--g\r\n"
        'Content-Type: text/plain; charset="utf-8"\r\n'
        "\r\n"
        "Anbei das Angebot.\r\n"
        "--g\r\n"
        'Content-Type: text/plain; charset="utf-8"\r\n'
        'Content-Disposition: attachment; filename="angebot.txt"\r\n'
        "\r\n"
        "GEHEIMER ANHANG\r\n"
        "--g--\r\n"
    )
    assert sync_sent._text_aus(_mail(roh)) == "Anbei das Angebot."


def test_betreff_wird_dekodiert():
    roh = KEN.replace(
        "Subject: RE: feedback on your site",
        "Subject: =?utf-8?B?UkU6IEdyw7zOsmU=?=",
    )
    assert sync_sent._dekodiere(_mail(roh).get("Subject")).startswith("RE: Gr")


class FakeImap:
    """Nur die beiden Methoden, die _sent_ordner benutzt."""

    def __init__(self, zeilen, oeffenbar=()):
        self._zeilen = zeilen
        self._oeffenbar = set(oeffenbar)

    def list(self):
        return "OK", self._zeilen

    def select(self, name, readonly=False):
        return ("OK" if name.strip('"') in self._oeffenbar else "NO"), [b""]


def test_sent_ordner_ueber_das_sent_merkmal():
    # RFC 6154: der Server sagt selbst, welcher Ordner es ist. Das geht jeder
    # Namensliste vor, weil Namen sprachabhaengig sind.
    zeilen = [
        rb'(\HasNoChildren) "." "INBOX"',
        rb'(\HasNoChildren \Sent) "." "INBOX.Gesendete Objekte"',
    ]
    assert sync_sent._sent_ordner(FakeImap(zeilen), None) == "INBOX.Gesendete Objekte"


def test_eigene_vorgabe_gewinnt():
    zeilen = [rb'(\HasNoChildren \Sent) "." "INBOX.Sent"']
    assert sync_sent._sent_ordner(FakeImap(zeilen), "Eigener Ordner") == "Eigener Ordner"


def test_ohne_merkmal_wird_die_namensliste_probiert():
    zeilen = [rb'(\HasNoChildren) "." "INBOX"', rb'(\HasNoChildren) "." "Sent Items"']
    assert sync_sent._sent_ordner(FakeImap(zeilen, {"Sent Items"}), None) == "Sent Items"


def test_kein_gesendet_ordner_ist_ein_fehler_mit_hinweis():
    # Lieber laut scheitern als still nichts holen: ein Postfach, dessen
    # Ordner niemand findet, soll die rote Zeile am Postfach bekommen.
    with pytest.raises(RuntimeError, match="von Hand"):
        sync_sent._sent_ordner(FakeImap([rb'(\HasNoChildren) "." "INBOX"']), None)
