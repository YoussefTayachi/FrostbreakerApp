"""Welche bereits bekannten Firmen eine neue Suche NICHT erneut aufnehmen soll.

Bisher sperrte die Dedupe-Pruefung gegen jede Firma des Workspaces --
unabhaengig davon, ob die zugehoerige Suche noch existiert. Praktische Folge:
wer seine Suchen in den Papierkorb legt und dieselbe Suche neu startet, bekommt
null Treffer, weil die App die geloeschten Firmen weiterhin kennt. Real
gemessen: 340 Firmen im Workspace, davon 340 aus geloeschten Suchen und keine
einzige aus einer aktiven -- die Leadsuche war damit komplett blockiert, ohne
dass die Oberflaeche einen Grund genannt haette.

"Papierkorb" heisst: diese Liste will ich nicht mehr. Es heisst NICHT: diese
Firma nie wieder kontaktieren -- dafuer gibt es die Blockliste
(suppression_list), die unabhaengig davon weiter greift.

Eine Ausnahme bleibt trotzdem gesperrt: Firmen, bei denen schon jemand
angeschrieben wurde (irgendein Kontakt nicht mehr auf "new"). Wuerde man die
erneut finden, entstuenden neue Kontaktzeilen mit Status "new" -- und der
Kampagnen-Filter, der sich genau auf diesen Status stuetzt, wuerde dieselbe
Person ein zweites Mal anschreiben. Der Verlauf haengt an der Kontaktzeile,
nicht an der E-Mail-Adresse, deshalb muss die Sperre hier greifen.
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


def businesses_to_skip(workspace_id: str) -> list[dict]:
    """Firmen, die eine neue Suche ueberspringen soll (id, website, place_id)."""
    businesses = (
        sb()
        .table("businesses")
        .select("id, website, place_id, search_id")
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
    return filter_blocking(businesses, active_search_ids, contacted_business_ids)
