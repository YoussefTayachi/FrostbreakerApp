"""Pipeline 8: der Gesendet-Ordner eines Postfachs, per IMAP.

WARUM ES DIESEN JOB GIBT

Gemessen am 2026-09-12 an Ken Vallens: Instantly kannte zu dem Thread fuenf
Mails, Frostbreaker dieselben fuenf, und keine der vier Antworten, die
Youssef zwischen dem 30.08. und dem 12.09. ueber IONOS geschrieben hatte.
Instantlys Hilfeseite zu Unibox V2 sagt, was synchronisiert wird:
EINGEHENDE Mails. Der Gesendet-Ordner eines verbundenen Postfachs wird nicht
gelesen, und damit sieht Instantly nie, was ueber Webmail, Handy oder einen
anderen Client hinausgeht.

Die Folge war nicht bloss eine Luecke im Verlauf. In der Pipeline stand als
letzter eigener Kontakt bei Ken der 28.08., die Kampagnenmail, obwohl am
selben Morgen eine Antwort rausgegangen war. Die Erinnerungs-Automatik
haette ihn als liegengeblieben gemeldet.

NUR DER GESENDET-ORDNER

Die Eingaenge liefert Instantly vollstaendig und mit seiner Einstufung
(ai_interest). Sie ein zweites Mal ueber IMAP zu holen hiesse, zwei Quellen
fuer dasselbe zu pflegen, mit zwei Fehlerquellen und einer Dublettenfrage
bei jeder einzelnen Antwort. Dieser Job holt genau das, was sonst niemand
holt.

NUR MAILS AN BEKANNTE KONTAKTE

Ein Gesendet-Ordner enthaelt auch Privates, Rechnungen und Antworten an den
Steuerberater. Uebernommen wird eine Mail nur, wenn mindestens ein Empfaenger
ein Kontakt dieses Workspace ist. Das ist genau die Luecke, um die es geht,
und es macht aus dem Posteingang der App kein zweites Privatpostfach.
"""
import contextlib
import email
import email.utils
import imaplib
import logging
import re
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import Message

from worker.crypto import decrypt
from worker.db import sb

log = logging.getLogger("worker.sync_sent")

# Wie weit der ERSTE Lauf zurueckgeht. Danach zaehlt allein der Wasserstand
# (last_uid). Neunzig Tage decken die Vorgeschichte eines laufenden
# Postfachs ab, ohne beim Anschliessen Jahre alter Korrespondenz durch die
# Kontaktpruefung zu schicken.
ERSTLAUF_TAGE = 90

# Obergrenze je Lauf. Der Job wird alle fuenf Minuten neu eingereiht und der
# Wasserstand wandert mit, ein grosser Ordner wird also ueber mehrere Laeufe
# aufgeholt, statt eine Replik minutenlang zu binden.
MAX_PRO_LAUF = 200

# Zeitfenster fuer den Abgleich mit Altbestand, siehe _schon_vorhanden.
ALTBESTAND_FENSTER_S = 300

IMAP_TIMEOUT_S = 30

# Ordnernamen als Rueckfall, falls der Server den Gesendet-Ordner nicht ueber
# das \Sent-Merkmal auszeichnet (RFC 6154). Die Liste ist bewusst kurz und
# enthaelt nur, was bei den hier verwendeten Anbietern tatsaechlich vorkommt.
SENT_NAMEN = [
    "Sent",
    "INBOX.Sent",
    "Sent Items",
    "Sent Messages",
    "Gesendet",
    "Gesendete Objekte",
    "Gesendete Elemente",
    "INBOX.Gesendet",
]


def _dekodiere(wert: str | None) -> str:
    """Kopfzeile in lesbaren Text. Kaputte Kodierung darf keinen Job kippen."""
    if not wert:
        return ""
    try:
        return str(make_header(decode_header(wert))).strip()
    except Exception:
        return wert.strip()


def _text_aus(msg: Message) -> str:
    """Der Fliesstext einer Mail, text/plain bevorzugt.

    Dieselbe Rangfolge wie lib/instantly/email-body.ts auf der Web-Seite:
    Nur-HTML-Mails sonst mit leerem Text zu speichern hat dort schon einmal
    184 Zeilen ohne Inhalt erzeugt.
    """
    html = ""
    for teil in msg.walk() if msg.is_multipart() else [msg]:
        if teil.get_content_maintype() == "multipart":
            continue
        # Anhaenge tragen nichts zum Verlauf bei und koennen gross sein.
        if (teil.get("Content-Disposition") or "").lower().startswith("attachment"):
            continue
        typ = teil.get_content_type()
        if typ not in ("text/plain", "text/html"):
            continue
        try:
            roh = teil.get_payload(decode=True) or b""
            text = roh.decode(teil.get_content_charset() or "utf-8", errors="replace")
        except Exception:
            continue
        if typ == "text/plain" and text.strip():
            return text.strip()
        if typ == "text/html" and not html:
            html = text
    if html:
        ohne_tags = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        ohne_tags = re.sub(r"<br\s*/?>|</p>", "\n", ohne_tags, flags=re.IGNORECASE)
        ohne_tags = re.sub(r"<[^>]+>", " ", ohne_tags)
        return re.sub(r"[ \t]+", " ", ohne_tags).strip()
    return ""


def _empfaenger(msg: Message) -> list[str]:
    roh = []
    for feld in ("To", "Cc"):
        for wert in msg.get_all(feld, []):
            roh.extend(a for _, a in email.utils.getaddresses([wert]))
    return [a.lower() for a in roh if a and "@" in a]


def _gesendet_am(msg: Message) -> str | None:
    try:
        dt = email.utils.parsedate_to_datetime(msg.get("Date", ""))
    except Exception:
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _sent_ordner(imap: imaplib.IMAP4_SSL, vorgabe: str | None) -> str:
    """Den Gesendet-Ordner finden.

    Zuerst die eingetragene Vorgabe, dann das \\Sent-Merkmal aus RFC 6154,
    dann die Namensliste. Das Merkmal steht vor den Namen: es ist die einzige
    Angabe, die der Server selbst macht, und Namen sind sprachabhaengig.
    """
    if vorgabe:
        return vorgabe
    status, zeilen = imap.list()
    if status == "OK":
        for zeile in zeilen or []:
            text = zeile.decode(errors="replace") if isinstance(zeile, bytes) else str(zeile)
            if "\\Sent" in text:
                # Format: (\HasNoChildren \Sent) "/" "INBOX.Sent"
                treffer = re.search(r'"([^"]*)"\s*$', text) or re.search(r"(\S+)\s*$", text)
                if treffer:
                    return treffer.group(1)
    for name in SENT_NAMEN:
        status, _ = imap.select(f'"{name}"', readonly=True)
        if status == "OK":
            return name
    raise RuntimeError(
        "Kein Gesendet-Ordner gefunden. Trag den Ordnernamen beim Postfach von Hand ein."
    )


def _kontakt_zu(workspace_id: str, adresse: str, merker: dict) -> dict | None:
    """Der Kontakt zu einer Empfaengeradresse, mit Merker fuer diesen Lauf.

    ilike statt eq: contacts.email steht in gemischter Schreibweise in der
    Datenbank (der Instantly-Sync sucht aus demselben Grund mit ilike).
    """
    if adresse in merker:
        return merker[adresse]
    zeilen = (
        sb()
        .table("contacts")
        .select("id, email")
        .eq("workspace_id", workspace_id)
        .ilike("email", adresse)
        .limit(1)
        .execute()
        .data
    )
    merker[adresse] = zeilen[0] if zeilen else None
    return merker[adresse]


def _schon_vorhanden(workspace_id: str, message_id: str, contact_id: str, gesendet_am: str | None) -> bool:
    """Steht diese Mail bereits in messages?

    ZWEI STUFEN, UND DIE ZWEITE IST EINE HEURISTIK.

    1. Ueber die Message-ID. Instantly liefert sie in jedem Mailobjekt mit,
       der Sync schreibt sie seit Migration 0114 mit, und im IMAP-Kopf steht
       dieselbe. Das ist die belastbare Auskunft.

    2. Fuer den Altbestand. Die 6172 ausgehenden Zeilen von vor Migration
       0114 haben keine Message-ID; ohne zweite Stufe wuerde jede
       Kampagnenmail, die auch im Gesendet-Ordner liegt, ein zweites Mal
       auftauchen. Verglichen wird deshalb Kontakt und Zeitpunkt in einem
       Fenster von fuenf Minuten. Bei einem Treffer wird die Message-ID
       nachgetragen, womit die Zeile ab dem naechsten Lauf ueber Stufe 1
       laeuft. Die Heuristik heilt sich also selbst und verliert mit jedem
       Lauf an Bedeutung.

    Die Fehlerrichtung ist Absicht: im Zweifel NICHT einfuegen. Eine fehlende
    Zeile faellt auf und laesst sich nachholen, eine doppelte Zeile im
    Verlauf eines Leads sieht aus wie zweimal geschrieben.
    """
    treffer = (
        sb()
        .table("messages")
        .select("id")
        .eq("workspace_id", workspace_id)
        .eq("message_id", message_id)
        .limit(1)
        .execute()
        .data
    )
    if treffer:
        return True

    if not gesendet_am:
        return False
    mitte = datetime.fromisoformat(gesendet_am)
    frueh = (mitte - timedelta(seconds=ALTBESTAND_FENSTER_S)).isoformat()
    spaet = (mitte + timedelta(seconds=ALTBESTAND_FENSTER_S)).isoformat()
    alt = (
        sb()
        .table("messages")
        .select("id, message_id")
        .eq("workspace_id", workspace_id)
        .eq("contact_id", contact_id)
        .eq("direction", "outbound")
        .gte("sent_at", frueh)
        .lte("sent_at", spaet)
        .limit(1)
        .execute()
        .data
    )
    if not alt:
        return False
    if not alt[0].get("message_id"):
        sb().table("messages").update({"message_id": message_id}).eq("id", alt[0]["id"]).execute()
    return True


def _suchbereich(imap: imaplib.IMAP4_SSL, last_uid: int | None) -> list[bytes]:
    if last_uid:
        status, daten = imap.uid("SEARCH", None, f"UID {last_uid + 1}:*")
    else:
        seit = (datetime.now(timezone.utc) - timedelta(days=ERSTLAUF_TAGE)).strftime("%d-%b-%Y")
        status, daten = imap.uid("SEARCH", None, f'SINCE {seit}')
    if status != "OK":
        raise RuntimeError(f"IMAP-Suche fehlgeschlagen: {status}")
    return (daten[0] or b"").split()


def run(job: dict) -> None:
    workspace_id = job["workspace_id"]
    mailbox_id = job["payload"]["mailbox_id"]

    zeilen = (
        sb()
        .table("imap_mailboxes")
        .select("*")
        .eq("id", mailbox_id)
        .eq("workspace_id", workspace_id)
        .limit(1)
        .execute()
        .data
    )
    if not zeilen:
        log.info("Postfach %s gibt es nicht mehr, nichts zu tun", mailbox_id)
        return
    box = zeilen[0]
    if not box["enabled"]:
        return

    try:
        uebernommen, gesehen, neuer_uid, uid_validity = _lauf(workspace_id, box)
    except Exception as exc:
        # Der Fehler gehoert an das Postfach, nicht nur ins Protokoll: ein
        # falsches Passwort soll der Nutzer dort sehen, wo er es eingetragen
        # hat. Danach trotzdem weiterwerfen, damit der Queue-Retry greift.
        sb().table("imap_mailboxes").update(
            {"last_error": str(exc)[:500], "last_sync_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", mailbox_id).execute()
        raise

    aenderung = {
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
        "last_error": None,
        "uid_validity": uid_validity,
    }
    if neuer_uid:
        aenderung["last_uid"] = neuer_uid
    sb().table("imap_mailboxes").update(aenderung).eq("id", mailbox_id).execute()
    log.info(
        "Gesendet-Sync %s: %s von %s Mails uebernommen, Wasserstand %s",
        box["email"],
        uebernommen,
        gesehen,
        neuer_uid,
    )


def _lauf(workspace_id: str, box: dict) -> tuple[int, int, int | None, int | None]:
    passwort = decrypt(box["password_ciphertext"])
    imap = imaplib.IMAP4_SSL(box["host"], box["port"], timeout=IMAP_TIMEOUT_S)
    try:
        imap.login(box["username"], passwort)
        ordner = _sent_ordner(imap, box.get("sent_folder"))
        status, _ = imap.select(f'"{ordner}"', readonly=True)
        if status != "OK":
            raise RuntimeError(f"Ordner '{ordner}' laesst sich nicht oeffnen")

        # UIDVALIDITY zaehlt mit: benennt der Server den Ordner um oder baut
        # ihn neu auf, beginnt die UID-Zaehlung von vorn. Ein alter
        # Wasserstand wuerde dann alles Neue ueberspringen, still.
        status, daten = imap.status(f'"{ordner}"', "(UIDVALIDITY)")
        uid_validity = None
        if status == "OK" and daten and daten[0]:
            treffer = re.search(rb"UIDVALIDITY (\d+)", daten[0])
            if treffer:
                uid_validity = int(treffer.group(1))
        last_uid = box.get("last_uid")
        if uid_validity and box.get("uid_validity") and uid_validity != box["uid_validity"]:
            log.warning("UIDVALIDITY von %s hat sich geaendert, Wasserstand faellt weg", box["email"])
            last_uid = None

        uids = _suchbereich(imap, last_uid)
        if not uids:
            return 0, 0, last_uid, uid_validity

        # Aufsteigend und gedeckelt: der Wasserstand darf nur so weit
        # wandern, wie tatsaechlich gelesen wurde.
        geordnet = sorted(int(u) for u in uids)[:MAX_PRO_LAUF]
        merker: dict = {}
        uebernommen = 0
        hoechste = last_uid

        for uid in geordnet:
            status, daten = imap.uid("FETCH", str(uid), "(BODY.PEEK[])")
            hoechste = uid
            if status != "OK" or not daten or not isinstance(daten[0], tuple):
                continue
            msg = email.message_from_bytes(daten[0][1])

            message_id = (msg.get("Message-ID") or "").strip()
            if not message_id:
                # Ohne Message-ID gibt es keinen verlaesslichen Abgleich, und
                # eine Dublette im Verlauf ist schlimmer als eine Luecke.
                continue

            kontakt = None
            for adresse in _empfaenger(msg):
                kontakt = _kontakt_zu(workspace_id, adresse, merker)
                if kontakt:
                    break
            if not kontakt:
                continue

            gesendet_am = _gesendet_am(msg)
            if _schon_vorhanden(workspace_id, message_id, kontakt["id"], gesendet_am):
                continue

            sb().table("messages").insert(
                {
                    "workspace_id": workspace_id,
                    "contact_id": kontakt["id"],
                    "direction": "outbound",
                    "status": "sent",
                    "subject": _dekodiere(msg.get("Subject")) or None,
                    "body": _text_aus(msg),
                    "sent_at": gesendet_am,
                    "eaccount": box["email"],
                    "message_id": message_id,
                }
            ).execute()
            uebernommen += 1

        return uebernommen, len(geordnet), hoechste, uid_validity
    finally:
        # Ein misslungenes logout darf einen erfolgreichen Lauf nicht kippen:
        # die Mails sind an dieser Stelle laengst geschrieben.
        with contextlib.suppress(Exception):
            imap.logout()
