"""Welche bereits bekannten Firmen eine neue Suche NICHT erneut aufnehmen soll.

Bisher sperrte die Dedupe-Pruefung gegen jede Firma des Workspaces,
unabhaengig davon, ob die zugehoerige Suche noch existiert. Praktische Folge:
wer seine Suchen in den Papierkorb legt und dieselbe Suche neu startet, bekommt
null Treffer, weil die App die geloeschten Firmen weiterhin kennt. Real
gemessen: 340 Firmen im Workspace, davon 340 aus geloeschten Suchen und keine
einzige aus einer aktiven. Die Leadsuche war damit komplett blockiert, ohne
dass die Oberflaeche einen Grund genannt haette.

"Papierkorb" heisst: diese Liste will ich nicht mehr. Es heisst NICHT: diese
Firma nie wieder kontaktieren. Dafuer gibt es die Blockliste
(suppression_list), die unabhaengig davon weiter greift.

Eine Ausnahme bleibt trotzdem gesperrt: Firmen, bei denen schon jemand
angeschrieben wurde (irgendein Kontakt nicht mehr auf "new"). Wuerde man die
erneut finden, entstuenden neue Kontaktzeilen mit Status "new", und der
Kampagnen-Filter, der sich genau auf diesen Status stuetzt, wuerde dieselbe
Person ein zweites Mal anschreiben. Der Verlauf haengt an der Kontaktzeile,
nicht an der E-Mail-Adresse, deshalb muss die Sperre hier greifen.

Genau diese Ausnahme hatte bis Migration 0095 ein Loch: sie stuetzt sich auf
Zeilen in businesses/contacts, und "Papierkorb leeren" loescht beide. Danach
war die Firma wieder unbekannt, wurde neu gekauft (bei Apollo rund 2 Credits
pro Lead) und dieselben Menschen bekamen dieselbe Mail ein zweites Mal.
public.contact_archive haelt deshalb Domain und Firmenname jedes bereits
angeschriebenen Kontakts fest, auch wenn seine Zeile laengst weg ist; diese
Eintraege werden hier mitgesperrt.
"""

from worker.db import sb


def filter_blocking(
    businesses: list[dict],
    active_search_ids: set[str],
    contacted_business_ids: set[str],
) -> list[dict]:
    """Reine Auswahl-Logik (ohne DB), damit sie testbar bleibt."""
    return [
        b
        for b in businesses
        if b.get("search_id") in active_search_ids or b.get("id") in contacted_business_ids
    ]


def archive_as_businesses(archive: list[dict]) -> list[dict]:
    """contact_archive-Zeilen in die Form bringen, die die Aufrufer erwarten.

    Dieselben Schluessel wie eine businesses-Zeile, damit die Aufrufer nicht
    zwei Quellen unterscheiden muessen, aber ohne id und place_id, denn
    beides gibt es zu einer geloeschten Firma nicht mehr. website traegt die
    blanke Domain (kein Schema); die Aufrufer vergleichen ohnehin ueber
    domain_of().

    Mehrere angeschriebene Kontakte derselben Firma ergeben mehrere
    Archiv-Zeilen, hier auf eine je Domain bzw. Name zusammengezogen, damit
    die Sperrmenge nicht unnoetig waechst.
    """
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for row in archive:
        domain = (row.get("domain") or "").strip().lower()
        name = (row.get("company_name") or "").strip()
        if not domain and not name:
            continue
        key = (domain, name.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "id": None,
                "name": name or None,
                "website": domain or None,
                "place_id": None,
                # Kennzeichen fuer Aufrufer, die NUR gegen das Archiv sperren
                # wollen: die Maps-Suche etwa darf Filialen einer Kette
                # weiterhin einzeln aufnehmen, eine bereits angeschriebene und
                # geloeschte Firma aber nicht erneut.
                "from_archive": True,
            }
        )
    return out


def businesses_to_skip(workspace_id: str) -> list[dict]:
    """Firmen, die eine neue Suche ueberspringen soll (id, name, website, place_id).

    name kam am 2026-08-09 dazu: Apollos kostenlose Vorschau liefert keine
    Domain, nur den Firmennamen. Ohne ihn liesse sich eine Dublette erst nach
    dem kostenpflichtigen Anreichern erkennen; siehe
    apollo.collect_people(known_companies).

    Zwei Quellen, eine Liste: die noch vorhandenen Firmen und das Archiv der
    bereits angeschriebenen Kontakte aus endgueltig geloeschten Listen
    (Migration 0095). Die Archiv-Eintraege tragen weder id noch place_id;
    Aufrufer, die darauf zugreifen, muessen .get() benutzen.
    """
    businesses = (
        sb()
        .table("businesses")
        .select("id, name, website, place_id, search_id")
        .eq("workspace_id", workspace_id)
        .execute()
        .data
        or []
    )
    active_search_ids = {
        s["id"]
        for s in (
            sb()
            .table("searches")
            .select("id")
            .eq("workspace_id", workspace_id)
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
    }
    contacted_business_ids = {
        c["business_id"]
        for c in (
            sb()
            .table("contacts")
            .select("business_id")
            .eq("workspace_id", workspace_id)
            .neq("outreach_status", "new")
            .execute()
            .data
            or []
        )
        if c.get("business_id")
    }
    archive = (
        sb()
        .table("contact_archive")
        .select("domain, company_name")
        .eq("workspace_id", workspace_id)
        .execute()
        .data
        or []
    )
    return filter_blocking(
        businesses, active_search_ids, contacted_business_ids
    ) + archive_as_businesses(archive)
