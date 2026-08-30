"""Der Website-Check: harte Maengel aus dem HTML, deterministisch, ohne Modell.

WARUM OHNE KI

Ein Modell, das eine Website "bewertet", liefert Behauptungen. Der Empfaenger
einer Kaltakquise-Mail kann eine Behauptung nicht nachpruefen, er kann ihr nur
glauben oder nicht, und beim ersten Zweifel ist die Mail erledigt. Was hier
erhoben wird, kann er dagegen selbst nachsehen: entweder steht die Jahreszahl
2019 in seinem Fussbereich oder nicht. Deshalb ist dieses Modul reine
Zeichenkettenarbeit und ruft nichts auf, was Geld kostet.

Alles hier ist eine reine Funktion: HTML rein, Befunde raus. Das Netz steckt in
website_fetch.py, die Datenbank in pipelines/check_website.py. Diese Trennung
ist der Grund, warum der Katalog unten mit HTML-Schnipseln testbar ist.

WAS BEWUSST NICHT ERHOBEN WIRD

  Ladezeit / Core Web Vitals
      Ohne echten Browser nicht seriaes messbar. Ein httpx-Abruf misst die
      Antwortzeit EINES Dokuments aus einem Rechenzentrum, nicht das, was ein
      Besucher auf dem Handy erlebt. Eine geratene Ladezeit in einer Kaltmail
      ist genau die Sorte Behauptung, gegen die dieses Modul sonst ueberall
      geschrieben ist.

  "Sieht altmodisch aus" / Designqualitaet
      Geschmack. Nicht nachpruefbar, also kein Aufhaenger.

  DSGVO, eingebundene Google Fonts, fehlende Datenschutzhinweise
      Aus dem HTML sicher belegbar, trotzdem verworfen: eine Rechtsbehauptung
      in einer Kaltakquise-Mail ist Abmahn-Ton, keine Beratung. Wer so
      anfaengt, bekommt keine Antwort, sondern einen Anwalt.

  Defekte Links
      Braucht Crawling. Vervielfacht die Abrufe pro Lead von zwei auf
      Dutzende, fuer einen Befund, der oft auf eine einzelne veraltete
      Fussnote hinauslaeuft.

  Fehlende Alt-Texte
      Messbar, aber die betriebswirtschaftliche Folge ist fuer einen kleinen
      Betrieb nicht spuerbar. Als Aufhaenger schwach: "Ihren Bildern fehlen
      Alternativtexte" beantwortet die Frage "und?" nicht.
"""
import re
from datetime import date, datetime, timezone

# ═══════════════════════════════════════════════════════════════════════════
# DER KATALOG - REIHENFOLGE IST RANGFOLGE
# ═══════════════════════════════════════════════════════════════════════════
#
# Index 0 ist der staerkste Befund. Diese Reihenfolge entscheidet, welcher
# EINE Befund spaeter in den Icebreaker geht (top_finding), und sie ist damit
# eine inhaltliche Entscheidung, keine Aufzaehlung: oben steht, was ein
# Inhaber sofort versteht und was ihn Geld kostet (Browserwarnung, kaputtes
# Zertifikat, unbenutzbar auf dem Handy), unten das, was zwar stimmt, aber
# erklaerungsbeduerftig ist.
#
# Die Codes selbst sind stabil: sie landen unveraendert in
# businesses.website_audit und werden von apps/web/lib/website-audit.ts
# gespiegelt. Umbenennen hiesse, bereits gespeicherte Befunde zu entwerten.
#
# Die vier Eintraege vom 2026-08-27 sind nach demselben Massstab einsortiert,
# nicht hinten angehaengt: no_contact_route und no_tel_link kosten unmittelbar
# Anfragen und stehen deshalb weit oben, no_og_image und no_h1 sind wahr, aber
# erklaerungsbeduerftig, und stehen unten bei no_meta_description.
#
# site_unreachable steht seit dem 2026-08-27 GANZ OBEN, vor ssl_broken. Es gibt
# keinen staerkeren Befund: bei ssl_broken kommt der Besucher nach einer
# Warnseite noch durch, hier kommt er gar nicht an. Der Befund entsteht als
# einziger nicht aus dem HTML, sondern aus zwei getrennten Beobachtungen des
# Scheiterns; wie er abgesichert wird, steht in pipelines/confirm_unreachable.py.
FINDING_CODES: tuple[str, ...] = (
    "site_unreachable",
    "ssl_broken",
    "no_https",
    "no_viewport",
    # Aus der Browser-Stufe (website_browser.py). Sie stehen hier oben,
    # weil ein Besucher sie SOFORT sieht: eine Seite, auf der man
    # seitwaerts schieben muss, oder ein Abschnitt, an dessen Stelle ein
    # Loch klafft. Der Rang folgt derselben Regel wie der Rest des
    # Katalogs: was der Inhaber selbst nachsehen kann, zuerst.
    "mobile_overflow",
    "empty_section",
    "no_contact_route",
    "no_tel_link",
    "stale_copyright",
    "mixed_content",
    "site_builder",
    "no_og_image",
    "legacy_markup",
    "no_h1",
    "no_meta_description",
    # Gemessen, gespeichert, in der Oberflaeche sichtbar - aber NIE in
    # einer Mail, siehe MAILABLE_CODES.
    "render_blocked",
    "slow_load",
    "js_errors",
    "text_too_small",
    "tap_targets_small",
)

# Welche Codes ueberhaupt in eine Kaltmail duerfen.
#
# Der Empfaenger kennt seine Seite besser als wir. Was er in dreissig
# Sekunden widerlegen kann, darf nicht in die Mail, und zwar unabhaengig
# davon, wie sauber es gemessen wurde. Die fuenf ausgeschlossenen Codes
# scheitern jeder an einem eigenen Einwand:
#
#   render_blocked     Client-Rendering ist eine Entscheidung, kein Fehler.
#   slow_load          Er laedt aus dem Cache und sieht etwas anderes; den
#                      Messaufbau duerfen wir nicht nennen (website-finding).
#   js_errors          Kommen meist von fremden Skripten und stoeren nichts,
#                      was ein Kunde merkt.
#   text_too_small     Geschmack, solange es lesbar bleibt.
#   tap_targets_small  Traf am 2026-08-30 gemessen 28 von 40 Leads. Was fast
#                      jeder hat, ueberzeugt niemanden.
#   empty_section      Ein grosser verborgener Textblock ist nicht zwingend
#                      kaputt: responsive Seiten halten oft eine zweite,
#                      absichtlich verborgene Fassung vor, und nicht jedes
#                      Zustandssystem benutzt die Klassen, die hier
#                      ausgeschlossen sind. Der Canary am 2026-08-30 lieferte
#                      genau EINE Beobachtung, und die eigene Regel lautet:
#                      unter 15 wird erweitert, nicht entschieden. Bis dahin
#                      wird der Code gemessen und nicht behauptet.
MAILABLE_CODES: frozenset[str] = frozenset(FINDING_CODES) - frozenset({
    "render_blocked", "slow_load", "js_errors", "text_too_small",
    "tap_targets_small", "empty_section",
})

# ═══════════════════════════════════════════════════════════════════════════
# DIE TEXTE - EIN BLOCK, DAMIT SIE JEMAND UEBERARBEITEN KANN
# ═══════════════════════════════════════════════════════════════════════════
#
# FACT_DE nennt die Tatsache, CONSEQUENCE_DE die Folge fuers Unternehmen.
# Zusammen ergeben sie das Material, aus dem der write_website_finding-Job
# seinen Satz formuliert (siehe pipelines/website_finding.finding_context).
#
# Diese beiden Woerterbuecher sind Textarbeit, kein Programmcode: sie stehen
# absichtlich als ein zusammenhaengender Block hier und nicht verstreut bei
# den einzelnen Pruefungen, damit der Texter sie am Stueck ueberarbeiten kann,
# ohne die Pruefungen anzufassen.
#
# Zwei Vorgaben, die beim Umschreiben gelten:
#   - Keine Gedankenstriche. Sie stehen auf der Verbotsliste der
#     Personalisierung (DEFAULT_BANNED_WORDS), ein Strich hier wuerde also
#     eine Korrekturrunde beim Modell ausloesen, die Geld kostet.
#   - Die Folge muss betriebswirtschaftlich sein, nicht technisch. "Das
#     Viewport-Meta-Tag fehlt" ist kein Grund, warum jemand antwortet.
#
# Die Anzeigetexte der Oberflaeche stehen NICHT hier, sondern in
# lib/i18n/dict.ts unter leads.audit.<code>.*: das Frontend zeigt sie in zwei
# Sprachen, der Worker schreibt nur den deutschen Prompt-Kontext.
FACT_DE: dict[str, str] = {
    "site_unreachable": "Die Website laedt unter der hinterlegten Adresse gar nicht.",
    "ssl_broken": "Das SSL-Zertifikat der Website ist abgelaufen oder ungueltig.",
    "no_https": "Die Website laeuft ohne durchgehende HTTPS-Verschluesselung.",
    "no_viewport": "Die Website ist nicht fuer Mobilgeraete eingerichtet.",
    "mobile_overflow": (
        "Auf dem Handy ist die Seite breiter als der Bildschirm, man muss sie "
        "seitwaerts schieben."
    ),
    "empty_section": (
        "Ein Abschnitt der Startseite bleibt leer: der Text steht in der Seite, "
        "wird aber nicht angezeigt."
    ),
    "render_blocked": "Ohne aktives JavaScript zeigt die Seite keinen Inhalt.",
    "slow_load": "Die Seite braucht bis zur Anzeige laenger als ueblich.",
    "js_errors": "Im Browser laufen beim Aufruf Skriptfehler auf.",
    "text_too_small": "Teile des Fliesstextes sind auf dem Handy sehr klein gesetzt.",
    "tap_targets_small": "Mehrere Schaltflaechen sind kleiner als eine Fingerkuppe.",
    "stale_copyright": "Im Fussbereich der Website steht noch eine alte Jahreszahl.",
    "mixed_content": "Die Website laedt Teile von sich selbst noch unverschluesselt.",
    "site_builder": "Die Website ist mit einem Homepage-Baukasten gebaut.",
    "legacy_markup": "Die Website nutzt HTML-Technik, die seit Jahren abgekuendigt ist.",
    "no_meta_description": "Der Website fehlt die Beschreibung fuer Suchmaschinen.",
    "no_contact_route": "Von der Startseite aus gibt es keinen Weg zur Kontaktaufnahme.",
    "no_tel_link": "Die Telefonnummer steht als blosser Text da und laesst sich nicht antippen.",
    "no_og_image": "Beim Teilen des Links erscheint kein Vorschaubild.",
    "no_h1": "Die Startseite hat keine Hauptueberschrift.",
}

CONSEQUENCE_DE: dict[str, str] = {
    "site_unreachable": (
        "Wer die Adresse aufruft, landet auf einer Fehlermeldung, und jede Anfrage, "
        "die dort haette entstehen sollen, geht an den naechsten Anbieter."
    ),
    # KONDITIONAL UND OHNE GELD. Die beiden Browser-Folgen sagen, was ein
    # Besucher TUN MUSS, nicht was es kostet. Eine Umsatz- oder
    # Conversion-Aussage ist eine Kausalkette, die niemand belegen kann, und
    # in einer Kaltmail ist sie beim ersten Zweifel das Ende der Mail.
    "mobile_overflow": (
        "Wer auf dem Handy liest, muss dafuer hin und her schieben, und Text am "
        "rechten Rand steht ausserhalb des Bildschirms."
    ),
    "empty_section": (
        "An dieser Stelle sieht ein Besucher eine Luecke statt des Inhalts, der "
        "dort stehen soll."
    ),
    "render_blocked": (
        "Wer JavaScript blockiert oder es nicht ausfuehren kann, sieht eine leere Seite."
    ),
    "slow_load": "Bis etwas zu sehen ist, vergeht spuerbar Zeit.",
    "js_errors": "Einzelne Bereiche der Seite koennen dadurch nicht wie gedacht arbeiten.",
    "text_too_small": "Auf einem Handy muss man zum Lesen vergroessern.",
    "tap_targets_small": "Auf einem Handy trifft man daneben.",
    "ssl_broken": (
        "Jeder Browser blendet davor eine ganzseitige Warnung ein, die der Besucher "
        "erst wegklicken muss, bevor er die Seite ueberhaupt sieht."
    ),
    "no_https": (
        "Chrome zeigt seit 2018 'Nicht sicher' in der Adresszeile, Besucher springen ab."
    ),
    "no_viewport": (
        "Auf dem Handy erscheint die Seite winzig und muss zurechtgezogen werden, "
        "und ueber die Haelfte der Besucher kommt heute vom Handy."
    ),
    "stale_copyright": (
        "Wer das liest, haelt den Betrieb fuer eingeschlafen und fragt gar nicht erst an."
    ),
    "mixed_content": (
        "Browser blockieren diese Teile, dadurch fehlen auf der fertigen Seite "
        "Bilder oder ganze Gestaltungselemente."
    ),
    "site_builder": (
        "Individuelle Anpassungen sind nur im Rahmen des Baukastens moeglich, "
        "eigene Funktionen lassen sich kaum ergaenzen."
    ),
    "legacy_markup": (
        "Diese Technik stammt aus der Zeit vor Smartphones und wurde nie fuer "
        "kleine Bildschirme gebaut, auf dem Handy zerfaellt das Layout deshalb."
    ),
    "no_meta_description": (
        "Google zeigt dann einen zufaellig gewaehlten Satz von der Seite, der "
        "oft wenig mit dem eigentlichen Angebot zu tun hat."
    ),
    "no_contact_route": (
        "Wer anfragen will, muss erst suchen, und ein Teil davon sucht "
        "stattdessen den naechsten Anbieter."
    ),
    "no_tel_link": (
        "Auf dem Handy muss die Nummer abgeschrieben statt angetippt werden, "
        "und genau dabei brechen Anrufe ab."
    ),
    "no_og_image": (
        "Wer die Adresse weiterleitet, verschickt ein graues Rechteck statt "
        "eines Bildes, und gerade Empfehlungen laufen ueber solche Links."
    ),
    "no_h1": (
        "Suchmaschinen erfahren dadurch nirgends im Seiteninhalt, worum es "
        "geht, und ordnen die Seite entsprechend schlechter ein."
    ),
}


# ═══════════════════════════════════════════════════════════════════════════
# HTML-ZERLEGUNG (bewusst mit regulaeren Ausdruecken)
# ═══════════════════════════════════════════════════════════════════════════
#
# Kein Parser: gebraucht werden Meta-Tags, vier Ressourcen-Tags und der
# Fussbereich. Dafuer einen echten Parser einzuziehen hiesse, eine weitere
# Abhaengigkeit fuer eine Handvoll Zeichenketten mitzuschleppen. Der Preis
# davon ist bekannt und wird in Kauf genommen: kaputtes HTML kann einzelne
# Attribute verschlucken. Der Effekt geht immer Richtung "kein Befund", nie
# Richtung "erfundener Befund", und das ist die richtige Fehlerrichtung.
_META_RE = re.compile(r"<meta\b([^>]*)>", re.IGNORECASE)
_RESOURCE_RE = re.compile(r"<(script|img|link|iframe)\b([^>]*)>", re.IGNORECASE)
_ATTR_RE = re.compile(
    r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"""
)
_TAG_RE = re.compile(r"<[^>]+>")
_FOOTER_RE = re.compile(r"<footer\b[^>]*>(.*?)</footer>", re.IGNORECASE | re.DOTALL)


def _attrs(raw: str) -> dict[str, str]:
    """Attribute eines Tags, Namen kleingeschrieben."""
    out: dict[str, str] = {}
    for match in _ATTR_RE.finditer(raw):
        name = match.group(1).lower()
        value = match.group(2) or match.group(3) or match.group(4) or ""
        out.setdefault(name, value.strip())
    return out


def _meta_tags(html: str) -> list[dict[str, str]]:
    return [_attrs(m.group(1)) for m in _META_RE.finditer(html)]


def _meta_content(metas: list[dict[str, str]], key: str) -> str | None:
    """Inhalt des Meta-Tags mit diesem name/property (klein geschrieben).

    name UND property, weil die Open-Graph-Tags formal property nutzen, in
    freier Wildbahn aber oft als name auftauchen.
    """
    for meta in metas:
        ident = (meta.get("name") or meta.get("property") or "").strip().lower()
        if ident == key:
            return meta.get("content", "")
    return None


def _resources(html: str) -> list[tuple[str, dict[str, str]]]:
    """Die Ressourcen-Tags mit ihren Attributen: (tagname, attrs)."""
    return [(m.group(1).lower(), _attrs(m.group(2))) for m in _RESOURCE_RE.finditer(html)]


def _resource_url(tag: str, attrs: dict[str, str]) -> str | None:
    return attrs.get("href") if tag == "link" else attrs.get("src")


def _text_of(html: str) -> str:
    return " ".join(_TAG_RE.sub(" ", html).split())


# Skript- und Stilbloecke MIT Inhalt. _TAG_RE entfernt nur die Tags selbst und
# laesst dazwischen alles stehen, aus _text_of faellt also der komplette
# CSS- und JavaScript-Quelltext als vermeintlicher "Seitentext" heraus.
#
# ANLASS, GEMESSEN AM 2026-08-26: bei einer Telefonsuche ueber den sichtbaren
# Text meldete eine Squarespace-Seite achtzehn "Nummern", darunter
# ".fe-6a79b631970ccb22bceb0b8e" und "#block-yui_3_17_2_1_1732549573457_12051".
# Das waren Klassennamen aus einem <style>-Block. Wer daraus einen Befund
# baut, schreibt dem Empfaenger etwas ueber seine Seite, das dort niemand
# sieht -- also genau die erfundene Behauptung, gegen die dieses Modul
# geschrieben ist.
#
# Bewusst NUR fuer die neuen Pruefungen unten benutzt und nicht in _text_of
# selbst eingebaut: _text_of steckt in _footer_text und damit in
# stale_copyright, und eine Jahreszahl in einem CSS-Block wuerde dort zwar
# ebenfalls einen Fehlalarm ausloesen, aber diese Pruefung laeuft seit Wochen
# und ihre gespeicherten Befunde sollen sich nicht still aendern. Getrennt
# angehen, nicht nebenbei.
_NOISE_RE = re.compile(r"<(script|style|template|noscript)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)


def _visible_text(html: str) -> str:
    """Der Text, den ein Besucher tatsaechlich liest. Ohne CSS und JavaScript."""
    return _text_of(_NOISE_RE.sub(" ", html))


# ═══════════════════════════════════════════════════════════════════════════
# EINZELNE PRUEFUNGEN
# ═══════════════════════════════════════════════════════════════════════════

# Welche <link>-Beziehungen ueberhaupt eine Ressource NACHLADEN. Der Rest ist
# Metainformation und loest im Browser keine Mixed-Content-Warnung aus.
#
# Ohne diese Einschraenkung waere die Pruefung praktisch nutzlos: jedes
# WordPress-Theme traegt <link rel="profile" href="http://gmpg.org/xfn/11">
# im Kopf, dazu kommen rel="pingback", rel="EditURI" und diverse
# rel="alternate" auf http-Adressen. Das sind Verweise, keine Einbindungen,
# und sie wuerden bei fast jeder WordPress-Seite einen Befund erfinden, den
# der Empfaenger in seinem Browser nirgends sieht.
_LOADING_LINK_RELS = {"stylesheet", "icon", "shortcut icon", "apple-touch-icon", "preload", "manifest"}


def _check_mixed_content(resources: list[tuple[str, dict[str, str]]]) -> str | None:
    """Liefert die erste unverschluesselt eingebundene Ressourcen-URL."""
    for tag, attrs in resources:
        if tag == "link":
            rel = (attrs.get("rel") or "").strip().lower()
            if rel not in _LOADING_LINK_RELS:
                continue
        url = _resource_url(tag, attrs)
        if url and url.lower().startswith("http://"):
            return url
    return None


def _check_viewport(metas: list[dict[str, str]]) -> bool:
    """True, wenn ein viewport-Meta-Tag fehlt.

    Das war der Befund mit dem groessten Fehlalarm-Risiko: er haengt an einem
    einzigen Meta-Tag, und ein Parser-Fehler haette hier reihenweise gepflegte
    Seiten als "nicht fuer Mobilgeraete eingerichtet" gemeldet.

    Gemessen am 2026-08-23 gegen echte Startseiten: de.wix.com, www.jimdo.com,
    www.squarespace.com und example.com melden ihn allesamt NICHT.
    info.cern.ch, die tatsaechlich keinen hat, meldet ihn. Die
    Attributerkennung greift also auch bei den grossen, schwer gebauten
    Seiten.
    """
    return _meta_content(metas, "viewport") is None


def _check_meta_description(metas: list[dict[str, str]]) -> bool:
    """True, wenn weder description noch og:description mit Inhalt da ist.

    Ein leeres content-Attribut zaehlt wie gar keins: Google zeigt daraus
    genauso wenig einen Textausschnitt.
    """
    for key in ("description", "og:description"):
        value = _meta_content(metas, key)
        if value and value.strip():
            return False
    return True


# Abgekuendigte Elemente. <frameset> und <marquee> sind eindeutig; <center>
# und <font> sind es fast: sie tauchen praktisch nur in handgeschriebenem
# HTML aus den Neunzigern und in Exporten alter Editoren auf.
_LEGACY_TAG_RE = re.compile(r"<\s*(frameset|center|font|marquee)\b", re.IGNORECASE)


def _check_legacy_markup(html: str) -> str | None:
    match = _LEGACY_TAG_RE.search(html)
    return f"<{match.group(1).lower()}>" if match else None


# Homepage-Baukaesten. Zwei Wege, sie zu erkennen:
#
#   1. Das generator-Meta-Tag. Der verlaesslichste Weg, weil die Baukaesten
#      ihn selbst setzen und niemand ihn haendisch faelscht.
#   2. Die Hosts, von denen die Seite ihre Skripte und Stile laedt. Noetig,
#      weil manche Baukaesten das generator-Tag weglassen.
#
# BEIDE WEGE WERDEN GEBRAUCHT, gemessen am 2026-08-23 mit fetch_page +
# analyze gegen die Startseiten der Anbieter selbst:
#
#     de.wix.com            site_builder, Beleg "Wix.com Website Builder"
#                           -> aus dem generator-Meta
#     www.jimdo.com         site_builder, Beleg "Jimdo"
#                           -> aus der Skript-Signatur, KEIN generator-Meta
#     www.squarespace.com   site_builder, Beleg "Squarespace"
#                           -> aus der Skript-Signatur, KEIN generator-Meta
#
# Wer die Skript-Signaturen spaeter als vermeintlich redundant streicht,
# verliert damit zwei von drei geprueften Baukaesten. Wer umgekehrt nur die
# Signaturen behaelt, verliert den Fall, in dem der Beleg woertlich zitierbar
# ist. Die Zeilen unten sehen doppelt gemoppelt aus und sind es nicht.
#
# WordPress steht ABSICHTLICH NICHT auf dieser Liste, obwohl es der mit
# Abstand haeufigste generator-Wert ist. WordPress ist kein Baukasten in dem
# hier gemeinten Sinn: eine gepflegte WordPress-Seite ist voellig in Ordnung,
# und "Sie benutzen WordPress" waere als Aufhaenger eine Frechheit ohne Inhalt.
_SITE_BUILDERS: tuple[tuple[str, tuple[str, ...], tuple[str, ...]], ...] = (
    # (Anzeigename, Kennungen im generator-Tag, Hosts in Ressourcen-URLs)
    ("Wix", ("wix",), ("parastorage.com", "wixstatic.com")),
    ("Jimdo", ("jimdo",), ("jimstatic.com", "jimdo.com")),
    ("Squarespace", ("squarespace",), ("squarespace.com", "squarespace-cdn.com")),
    ("GoDaddy Website Builder", ("godaddy", "website builder"), ("wsimg.com",)),
    ("Weebly", ("weebly",), ("weebly.com", "editmysite.com")),
    ("IONOS MyWebsite", ("ionos", "1&1", "mywebsite"), ("mywebsite-editor.com", "ionos.space")),
)


def _check_site_builder(generator: str | None, resource_urls: list[str]) -> str | None:
    """Liefert den erkannten Baukasten (als Beleg) oder None."""
    gen = (generator or "").lower()
    for name, generator_marks, hosts in _SITE_BUILDERS:
        if gen and any(mark in gen for mark in generator_marks):
            # Der Beleg ist der Wert, der wirklich auf der Seite steht, nicht
            # unser Anzeigename: er soll nachschlagbar sein.
            return generator or name
        for url in resource_urls:
            if any(host in url for host in hosts):
                return name
    return None


# Ein Jahr im Fussbereich, moeglichst dicht an einem Copyright-Zeichen. Der
# Abstand von hoechstens 40 Zeichen haelt "© 2019 Musterfirma GmbH" und
# "Copyright 2018 - 2020 Muster" zusammen, ohne quer durch den Fusstext auf
# eine beliebige andere Jahreszahl zu greifen (Gruendungsjahr, Blogdatum).
_COPYRIGHT_RE = re.compile(
    r"(?:©|&copy;|&#169;|\(c\)|copyright)[^\d]{0,40}((?:19|20)\d{2})"
    r"(?:\s*[-–—/]\s*((?:19|20)\d{2}))?",
    re.IGNORECASE,
)

# Ab welchem Abstand die Jahreszahl als veraltet gilt.
#
# Bewusst konservativ und ausdruecklich KEIN Messwert, sondern eine gesetzte
# Grenze: mit 1 wuerde jede Seite, die ihr Copyright noch nicht auf das neue
# Jahr gehoben hat, im Januar angegangen. Das trifft im Zweifel eine gepflegte
# Seite und laesst den Absender ahnungslos aussehen. Mit 2 bleibt der Befund
# das, was er sein soll: ein Hinweis auf eine Seite, die seit Jahren niemand
# angefasst hat.
STALE_COPYRIGHT_MIN_AGE_YEARS = 2

# Wie viel vom Dokumentende als Fussbereich gilt, wenn es kein <footer>-Element
# gibt. Grosszuegig genug fuer Fusszeilen, die in verschachtelten <div>s
# stecken, und weit genug vom Seiteninhalt entfernt, um nicht das Datum eines
# Blogbeitrags einzufangen.
_FOOTER_TAIL_CHARS = 4000


def _footer_text(html: str) -> str:
    """Der Fussbereich als reiner Text.

    Bevorzugt echte <footer>-Elemente (alle, manche Seiten haben zwei),
    sonst das Dokumentende. Tags werden entfernt, damit "<span>©</span> 2019"
    genauso gefunden wird wie "© 2019".
    """
    footers = _FOOTER_RE.findall(html)
    if footers:
        return _text_of(" ".join(footers))
    return _text_of(html[-_FOOTER_TAIL_CHARS:])


def _check_stale_copyright(html: str, today: date) -> str | None:
    """Liefert die juengste im Fussbereich gefundene Jahreszahl, wenn sie zu alt ist."""
    years: list[int] = []
    for match in _COPYRIGHT_RE.finditer(_footer_text(html)):
        years += [int(y) for y in match.groups() if y]
    if not years:
        return None
    # Die JUENGSTE Zahl zaehlt: "© 2005 - 2024" ist eine aktuelle Seite mit
    # langer Geschichte, kein Befund.
    newest = max(years)
    if newest > today.year:
        return None  # Zahl aus der Zukunft: Tippfehler, kein Mangel
    if today.year - newest < STALE_COPYRIGHT_MIN_AGE_YEARS:
        return None
    return str(newest)


# ═══════════════════════════════════════════════════════════════════════════
# DER GESAMTBEFUND
# ═══════════════════════════════════════════════════════════════════════════

# Wie lang ein Beleg hoechstens sein darf. Ein Beleg ist ein Zitat von der
# Seite (die Jahreszahl, der Generator-Name, die erste http-URL), niemals ein
# Satz: er wandert spaeter in einen Prompt, und alles, was dort wie eine
# Formulierung aussieht, wird vom Modell uebernommen.
MAX_EVIDENCE_CHARS = 120


# ═══════════════════════════════════════════════════════════════════════════
# DIE VIER PRUEFUNGEN VOM 2026-08-27
# ═══════════════════════════════════════════════════════════════════════════
#
# Anlass ist eine Zaehlung, keine Idee: von 24 Leads der Bauliste bekamen nur
# NEUN einen Befund aus dem Katalog, obwohl beim Nachsehen von Hand fast jede
# Seite etwas hergab. Was von Hand gefunden wurde und der Katalog nicht kannte,
# war jedes Mal eines dieser vier Dinge. Alle vier sind aus dem HTML der
# Startseite belegbar, brauchen keinen Browser und kosten nichts.
#
# Die Fehlerrichtung bleibt: lieber kein Befund als ein erfundener. Deshalb
# sind alle vier strenger gefasst, als sie sein muessten, und die Begruendung
# steht jeweils daneben.

_FORM_RE = re.compile(r"<form\b", re.IGNORECASE)
_TEL_HREF_RE = re.compile(r"""href\s*=\s*["']?\s*tel:""", re.IGNORECASE)
_MAILTO_HREF_RE = re.compile(r"""href\s*=\s*["']?\s*mailto:""", re.IGNORECASE)
_H1_RE = re.compile(r"<h1\b", re.IGNORECASE)


def _check_contact_route(html: str) -> bool:
    """True, wenn die Startseite GAR KEINEN Weg zur Kontaktaufnahme bietet.

    Nicht "kein Formular": das waere ein Fehlalarm bei jeder Seite, die ihr
    Formular auf einer Unterseite hat, und der Check liest nur die Startseite.
    Gemessen am 2026-08-26: elysiumconstruction.co.uk hat auf der Startseite
    null Formulare und auf /contact eines mit sechs Feldern. Ein Befund
    "Ihnen fehlt ein Anfrageformular" waere dort schlicht falsch gewesen.

    Deshalb die harte Fassung: kein Formular UND kein mailto UND kein tel.
    Wer von der Startseite aus weder schreiben noch anrufen noch etwas
    absenden kann, hat wirklich keinen Weg, und das laesst sich nicht
    wegdiskutieren.
    """
    return not (_FORM_RE.search(html) or _MAILTO_HREF_RE.search(html) or _TEL_HREF_RE.search(html))


# Eine Nummer gilt nur als Nummer, wenn sie BESCHRIFTET ist. Neun bis fuenfzehn
# Ziffern allein wuerden Bestellnummern, Umsatzsteuer-IDs und
# Registergerichtsnummern mitnehmen, und aus einer Handelsregisternummer einen
# "nicht antippbaren Anruf" zu machen waere peinlich.
#
# Der Abstand von 40 Zeichen zwischen Beschriftung und Ziffern faengt die
# ueblichen Formen ab ("Telefon: 020 ...", "Call us on 020 ...", "T +44 ...")
# und ist kurz genug, dass die Beschriftung nicht zufaellig einen Absatz
# weiter oben steht.
_LABELLED_PHONE_RE = re.compile(
    r"(?:tel|telefon|telephone|phone|call\s+us|rufen\s+sie|mobil|mobile)\b[^0-9+]{0,40}"
    r"(\+?[\d][\d\s().\-/]{7,18}\d)",
    re.IGNORECASE,
)


def _check_untappable_phone(html: str) -> str | None:
    """Die erste beschriftete Nummer, die NICHT als tel:-Link hinterlegt ist.

    Auf dem Handy ist das der Unterschied zwischen einem Fingertipp und dem
    Abschreiben einer Nummer in die Telefon-App. Gemessen am 2026-08-26 an
    reaconstruction.co.uk: die Kontaktseite bittet woertlich darum anzurufen
    ("Whenever you call us you will talk to a friendly team"), nennt zwei
    Nummern, und keine davon ist verlinkt.

    Steht IRGENDWO auf der Seite ein tel:-Link, gibt es keinen Befund. Auch
    dann nicht, wenn daneben eine zweite Nummer unverlinkt steht: der Betrieb
    hat den Punkt dann grundsaetzlich verstanden, und der Aufhaenger waere
    Erbsenzaehlerei.
    """
    if _TEL_HREF_RE.search(html):
        return None
    match = _LABELLED_PHONE_RE.search(_visible_text(html))
    if not match:
        return None
    nummer = match.group(1).strip()
    # Nach dem Zusammenstreichen nochmal zaehlen: die Zeichenklasse oben
    # erlaubt Leerzeichen und Klammern, eine "Nummer" aus vier Ziffern und
    # zwoelf Leerzeichen soll nicht durchgehen.
    return nummer if 9 <= sum(c.isdigit() for c in nummer) <= 15 else None


def _check_h1(html: str) -> bool:
    """True, wenn die Seite keine einzige Hauptueberschrift hat.

    Der schwaechste der vier, deshalb steht er im Katalog auch weit unten: die
    Folge ist echt, aber sie braucht einen Satz Erklaerung. Gemessen am
    2026-08-26 an reaconstruction.co.uk: null h1 bei sechs h2, der Titel
    verspricht "Builders In London" und die Seite selbst sagt es nirgends in
    einer Form, die eine Suchmaschine als Ueberschrift liest.
    """
    return not _H1_RE.search(html)


def _check_og_image(metas: list[dict[str, str]]) -> bool:
    """True, wenn beim Teilen des Links kein Vorschaubild erscheint.

    Untergeschaetzt und gerade im Bau- und Handwerksbereich teuer: dort kommen
    Auftraege ueber Weiterempfehlung, und eine weitergeleitete Adresse ohne
    Bild ist in WhatsApp und LinkedIn ein graues Rechteck. Wer ein Gebaeude
    baut, hat Bilder. Sie fehlen nur an der Stelle, an der sie jemand sieht,
    der nicht danach gesucht hat.
    """
    value = _meta_content(metas, "og:image")
    return not (value and value.strip())


def _finding(code: str, evidence: str | None = None) -> dict:
    if evidence is not None:
        evidence = " ".join(str(evidence).split())[:MAX_EVIDENCE_CHARS] or None
    return {"code": code, "evidence": evidence}


def analyze(
    html: str,
    *,
    checked_url: str,
    final_url: str,
    page_bytes: int,
    http_redirects_to_https: bool | None = None,
    today: date | None = None,
) -> dict:
    """Der komplette Befund einer erreichbaren Seite, fertig fuer die Datenbank.

    http_redirects_to_https ist das Ergebnis der zweiten Anfrage aus
    website_fetch.redirects_to_https: True/False beantwortet, None nicht
    beantwortbar. Nur False erzeugt einen Befund; None fuehrt bewusst zu
    keinem, denn ein Server, der auf Port 80 gar nicht antwortet, hat kein
    HTTPS-Problem.
    """
    # UTC statt der lokalen Zeit des Servers: der Worker laeuft auf Railway,
    # und ein Jahreswechsel darf nicht davon abhaengen, in welcher Zone die
    # Replik gerade steht.
    today = today or datetime.now(timezone.utc).date()
    metas = _meta_tags(html)
    resources = _resources(html)
    resource_urls = [
        (_resource_url(tag, attrs) or "").lower() for tag, attrs in resources
    ]
    generator = _meta_content(metas, "generator") or None

    findings: list[dict] = []

    # Reihenfolge dieser Bloecke = FINDING_CODES = Rangfolge. Am Ende wird
    # trotzdem sortiert, damit ein spaeter eingefuegter Block die Rangfolge
    # nicht still verschiebt.
    # Der Schema-Weg ist am 2026-08-23 gegen echte Seiten gelaufen:
    # http://example.com/ liefert no_https mit dem Beleg "http://example.com/",
    # http://info.cern.ch/ dazu no_viewport und no_meta_description. Die
    # https-Fassung von example.com meldet nur no_meta_description, der Befund
    # entsteht also am Schema und nicht nebenbei am Inhalt.
    on_https = final_url.lower().startswith("https://")
    if not on_https:
        findings.append(_finding("no_https", final_url))
    elif http_redirects_to_https is False:
        findings.append(_finding("no_https", "http://" + final_url.split("://", 1)[1]))

    if _check_viewport(metas):
        findings.append(_finding("no_viewport"))

    stale_year = _check_stale_copyright(html, today)
    if stale_year:
        findings.append(_finding("stale_copyright", stale_year))

    if on_https:
        mixed = _check_mixed_content(resources)
        if mixed:
            findings.append(_finding("mixed_content", mixed))

    builder = _check_site_builder(generator, resource_urls)
    if builder:
        findings.append(_finding("site_builder", builder))

    legacy = _check_legacy_markup(html)
    if legacy:
        findings.append(_finding("legacy_markup", legacy))

    if _check_meta_description(metas):
        findings.append(_finding("no_meta_description"))

    # Die vier vom 2026-08-27. Reihenfolge hier ist egal, sort_by_rank raeumt
    # am Ende nach FINDING_CODES.
    if _check_contact_route(html):
        findings.append(_finding("no_contact_route"))

    untappable = _check_untappable_phone(html)
    if untappable:
        findings.append(_finding("no_tel_link", untappable))

    if _check_og_image(metas):
        findings.append(_finding("no_og_image"))

    if _check_h1(html):
        findings.append(_finding("no_h1"))

    return {
        "checked_url": checked_url,
        "final_url": final_url,
        "findings": sort_by_rank(findings),
        # Gespeichert, aber KEIN Befund: "Euer HTML ist 300 KB gross" ist kein
        # Satz, den ein Inhaber fuehlt, und die Groesse der SEITE (Bilder,
        # Skripte, Schriften) messen wir damit gerade nicht. Der Wert steht
        # hier fuer den Fall, dass sich das spaeter jemand ansehen will.
        #
        # Warum daraus nie ein Befund werden sollte, zeigt die Messung vom
        # 2026-08-23: die Startseite von de.wix.com liefert 2.398.958 Bytes
        # HTML, also 2,4 MB in EINEM Dokument, und ist trotzdem eine voellig
        # normale, schnell ladende Seite. Eine Schwelle auf diesen Wert haette
        # sie als Mangel gemeldet. Seitengroesse allein sagt nichts.
        "page_bytes": page_bytes,
        "generator": generator,
    }


def unreachable(
    checked_url: str,
    *,
    kind: str,
    first_seen_at: str | None = None,
    confirmed_at: str | None = None,
) -> dict:
    """Der Befund fuer eine Seite, die sich nicht abrufen liess.

    EINE BEOBACHTUNG IST KEIN BEFUND. Ohne confirmed_at bleibt die Liste leer,
    genau wie vor dem 2026-08-27: der erste Fehlschlag wird festgehalten, aber
    er behauptet nichts. Erst wenn ein zweiter Abruf spaeter dasselbe sagt,
    setzt pipelines/confirm_unreachable.py confirmed_at, und dann steht hier
    site_unreachable.

    Warum das noetig ist: "eure Seite laedt gar nicht" ist die staerkste
    Aussage des ganzen Katalogs und zugleich die einzige, die ein einzelner
    Netzaussetzer erfinden kann. Alle anderen Befunde stehen im HTML und
    aendern sich nicht dadurch, dass man zweimal hinsieht.

    kind ist die Fehlerart aus website_fetch.classify_failure. Sie wird
    mitgeschrieben, damit spaeter nachvollziehbar bleibt, WORAN es lag (Name
    loest nicht auf, niemand lauscht, TLS bricht ab); ein Befund ohne diese
    Angabe waere von aussen nicht mehr nachpruefbar.

    KEIN evidence am Befund. Der Beleg ist sonst ein woertliches Zitat von der
    Seite, und website_finding.finding_context beschriftet ihn auch so ("Wörtlich
    auf der Seite gefunden"). Hier gibt es keine Seite, aus der zitiert werden
    koennte; die gepruefte Adresse steht ohnehin in checked_url.
    """
    findings = [_finding("site_unreachable")] if confirmed_at else []
    return {
        "checked_url": checked_url,
        "findings": findings,
        "unreachable_kind": kind,
        "unreachable_first_seen_at": first_seen_at,
        "unreachable_confirmed_at": confirmed_at,
    }


def ssl_broken(checked_url: str) -> dict:
    """Der Befund fuer ein kaputtes Zertifikat.

    Kommt aus dem Ausnahmezweig und nicht aus dem HTML: bei einem
    Zertifikatsfehler gibt es kein HTML, der Browser des Besuchers kommt ja
    genauso wenig an die Seite. Genau das ist der Befund.
    """
    return {"checked_url": checked_url, "findings": [_finding("ssl_broken")]}


def sort_by_rank(findings: list[dict]) -> list[dict]:
    """Befunde in Katalogreihenfolge. Unbekannte Codes ans Ende."""
    return sorted(findings, key=lambda f: _rank(f.get("code")))


def _rank(code: str | None) -> int:
    try:
        return FINDING_CODES.index(code or "")
    except ValueError:
        return len(FINDING_CODES)


# ═══════════════════════════════════════════════════════════════════════════
# DIE BROWSER-STUFE
# ═══════════════════════════════════════════════════════════════════════════
#
# website_browser.py misst, dieses Modul entscheidet. Dieselbe Trennung wie
# zwischen website_fetch.py und dem Katalog oben, und aus demselben Grund:
# die Auswertung ist eine reine Funktion und damit ohne Browser testbar.

# Ab wann eine Zahl ein Befund ist. Alle fuenf sind GESETZT und nicht
# gemessen, abgeleitet aus 40 echten Leads am 2026-08-30. Sie stehen hier
# beisammen, damit sie nach dem Canary an einer Stelle nachgezogen werden.
MOBILE_OVERFLOW_MIN_PX = 8      # darunter ist es Rundung, kein Ueberlauf
JS_ERRORS_MIN = 3
TEXT_TOO_SMALL_MIN = 5
TAP_TARGETS_MIN = 15
SLOW_LOAD_MIN_MS = 3000


def browser_findings(measurement: dict | None) -> list[dict]:
    """Aus einer Messung von website_browser.measure() Befunde machen.

    Ausgewertet wird nur ein `completed`-Ergebnis. `inconclusive` heisst, dass
    eine Consent- oder Bot-Wand davorstand; daraus einen Mangel zu machen
    hiesse, einem Inhaber zu schreiben, seine Seite sei leer, weil ein
    Cookie-Banner davor war.
    """
    if not measurement or measurement.get("status") != "completed":
        return []

    desktop = measurement.get("desktop") or {}
    handy = measurement.get("handy") or {}
    findings: list[dict] = []

    # Waagrechter Ueberlauf zaehlt nur MIT benanntem Element. Ohne Beleg ist
    # es eine Zahl ohne Ort, und der Skill website-finding verlangt zwei
    # unabhaengige Belege je Befund: hier die Messung und der Screenshot.
    ueberstehend = handy.get("ueberstehend") or []
    if (handy.get("ueberbreite") or 0) >= MOBILE_OVERFLOW_MIN_PX and ueberstehend:
        findings.append(_finding(
            "mobile_overflow",
            f"{handy['ueberbreite']}px ueber die Bildschirmbreite hinaus, bei {ueberstehend[0]}",
        ))

    loecher = desktop.get("loecher") or []
    if loecher:
        findings.append(_finding("empty_section", f"unsichtbarer Bereich: {loecher[0]}"))

    if (desktop.get("hauptTextLaenge") or 0) < 200 and (desktop.get("textLaenge") or 0) < 400:
        findings.append(_finding("render_blocked", "ohne Skript bleibt der Hauptbereich leer"))

    zeiten = measurement.get("timing_ms") or []
    if zeiten:
        median = sorted(zeiten)[len(zeiten) // 2]
        if median >= SLOW_LOAD_MIN_MS:
            findings.append(_finding("slow_load", f"{median} ms bis zum Anzeigen"))

    if (measurement.get("console_error_count") or 0) >= JS_ERRORS_MIN:
        findings.append(_finding(
            "js_errors", f"{measurement['console_error_count']} Fehler beim Aufruf"))

    if (handy.get("textUnter12px") or 0) >= TEXT_TOO_SMALL_MIN:
        findings.append(_finding(
            "text_too_small", f"{handy['textUnter12px']} Textstellen unter 12px"))

    if (handy.get("zielZuKlein") or 0) >= TAP_TARGETS_MIN:
        findings.append(_finding(
            "tap_targets_small", f"{handy['zielZuKlein']} Ziele unter 44px"))

    return findings


# Welcher HTML-Befund von welcher Beobachtung im Browser widerlegt wird.
#
# DAS IST DER EIGENTLICHE ERTRAG DER ZWEITEN STUFE, und er hat gefehlt, bis
# Codex am 2026-08-30 darauf gestossen ist: einen zweiten Katalog daneben zu
# stellen aendert nichts daran, dass ein falsches no_h1 aus rohem HTML
# weiterhin gewinnt. Gemessen an 38 Leads meldete ekomenu.nl "kein h1, keine
# description"; im gerenderten DOM stehen drei sichtbare h1 und eine
# description, das Skript setzt sie ein.
#
# Der Wert ist eine Funktion auf dem Desktop-Teil der Messung: liefert sie
# True, sieht der Browser das Element, und der HTML-Befund faellt weg.
_WIDERLEGT_VON_BROWSER = {
    "no_h1": lambda d: (d.get("h1Sichtbar") or 0) > 0,
    "no_meta_description": lambda d: bool((d.get("beschreibung") or "").strip()),
    "no_contact_route": lambda d: bool(
        (d.get("formulare") or 0) or (d.get("mailLinks") or 0) or (d.get("telLinks") or 0)
    ),
    "no_tel_link": lambda d: (d.get("telLinks") or 0) > 0,
    "no_og_image": lambda d: bool(d.get("ogImage")),
}


def invalidate_with_browser(findings: list[dict], measurement: dict | None) -> list[dict]:
    """HTML-Befunde entfernen, die der Browser widerlegt.

    Die uebrigen Codes bleiben unberuehrt: ssl_broken, no_https, no_viewport,
    stale_copyright, mixed_content, site_builder und legacy_markup haengen am
    Transport oder am gelieferten Dokument, und ein gerendertes DOM sagt
    darueber nichts.

    site_unreachable ist der Sonderfall in die andere Richtung: erreicht der
    Browser die Seite, ist sie nicht unerreichbar. Gemessen betraf das 3 von
    38 Leads, und "eure Seite laedt gar nicht" ueber eine Seite, die laedt,
    ist der teuerste Satz im ganzen Katalog.
    """
    if not measurement or measurement.get("status") != "completed":
        return list(findings)

    desktop = measurement.get("desktop") or {}
    erreicht = bool(measurement.get("http_status"))
    behalten = []
    for f in findings:
        code = f.get("code")
        if code == "site_unreachable" and erreicht:
            continue
        pruefung = _WIDERLEGT_VON_BROWSER.get(code)
        if pruefung is not None:
            try:
                if pruefung(desktop):
                    continue
            except Exception:
                # Eine unvollstaendige Messung darf nicht dazu fuehren, dass
                # ein Befund verschwindet, den niemand geprueft hat.
                pass
        behalten.append(f)
    return behalten


def html_hat_ausgewertet(html_audit: dict | None) -> bool:
    """Konnte die HTML-Stufe die Seite ueberhaupt ansehen?

    Nein heisst: sie war nicht erreichbar (dann steht unreachable_kind darin),
    sie lieferte kein HTML, oder es gibt gar kein Audit. In allen drei Faellen
    ist eine leere Befundliste KEINE Aussage ueber die Seite, sondern das
    Fehlen einer Aussage.
    """
    if not html_audit:
        return False
    # Wer Befunde geliefert hat, hat offensichtlich hingesehen. Diese Zeile
    # steht vor der Formpruefung darunter, damit ein Audit aus einer alten
    # Migration oder aus einem Test nicht faelschlich als "nichts gesehen"
    # gilt und dann DOM-Codes bekommt, die niemand gemessen hat.
    if html_audit.get("findings"):
        return True
    if html_audit.get("unreachable_kind"):
        return False
    return "checked_url" in html_audit


# Dieselben fuenf Codes wie in _WIDERLEGT_VON_BROWSER, nur andersherum: was
# der Browser widerlegen kann, kann er auch belegen.
_BELEGT_VOM_BROWSER = {
    "no_h1": lambda d: (d.get("h1Sichtbar") or 0) == 0,
    "no_meta_description": lambda d: not (d.get("beschreibung") or "").strip(),
    "no_og_image": lambda d: not d.get("ogImage"),
    "no_contact_route": lambda d: not (
        (d.get("formulare") or 0) or (d.get("mailLinks") or 0) or (d.get("telLinks") or 0)
    ),
    "no_tel_link": lambda d: (d.get("telLinks") or 0) == 0,
}


def dom_findings(measurement: dict | None) -> list[dict]:
    """Die DOM-abhaengigen Codes aus dem gerenderten Dokument erheben.

    Gebraucht wird das genau dann, wenn die HTML-Stufe die Seite nicht
    bekommen hat. Gemessen am 2026-08-30 an einem echten Lead (Rose Line
    Premier): httpx meldete unreachable, der Browser antwortete mit HTTP 200
    und sah eine Seite ganz ohne h1. Ohne diese Funktion war das Ergebnis KEIN
    Befund und damit auch kein Satz, obwohl beides vor Augen lag.

    Genau diese Faelle waren als Gewinn der zweiten Stufe angekuendigt: 3 von
    38 Seiten erreicht nur der Browser. Sie haetten nichts geliefert ausser
    dem Wegfall eines falschen site_unreachable.

    no_contact_route wird nur erhoben, wenn der Hauptbereich ueberhaupt Text
    traegt: auf einer Seite, die nichts anzeigt, ist der fehlende Kontaktweg
    nicht der Befund.
    """
    if not measurement or measurement.get("status") != "completed":
        return []
    d = measurement.get("desktop") or {}
    if not d:
        return []
    gefunden = []
    for code, pruefung in _BELEGT_VOM_BROWSER.items():
        if code == "no_contact_route" and (d.get("hauptTextLaenge") or 0) < 200:
            continue
        try:
            if pruefung(d):
                # OHNE Beleg, und das ist Absicht. Der Beleg-Slot traegt ein
                # woertliches Zitat von der Seite; website_finding.finding_context
                # beschriftet ihn mit "Woertlich auf der Seite gefunden". Beim
                # ersten echten Lauf am 2026-08-30 stand dort deshalb
                # "Woertlich auf der Seite gefunden: im gerenderten Dokument
                # nicht vorhanden", also ein Zitat des Nichtvorhandenen. Fuer
                # ein fehlendes Element gibt es nichts zu zitieren; die Zeile
                # faellt dann ganz weg.
                gefunden.append(_finding(code))
        except Exception:
            continue
    return gefunden


def combine(html_audit: dict | None, measurement: dict | None) -> dict:
    """Beide Stufen zu einer Befundliste, in Katalogreihenfolge.

    Drei Faelle, und der dritte ist erst durch einen echten Lead aufgefallen:

      1. Beide Stufen haben etwas gesehen. Der Browser nimmt weg, was er
         widerlegt, und legt seine eigenen Codes dazu.
      2. Nur die HTML-Stufe. Alles bleibt wie vor der Browser-Stufe.
      3. Nur der Browser. Dann traegt er auch die DOM-Codes, die sonst aus dem
         HTML gekommen waeren; ohne das bliebe von einer Seite, die nur er
         erreicht, gar nichts uebrig.
    """
    html_findings = list((html_audit or {}).get("findings") or [])
    bereinigt = invalidate_with_browser(html_findings, measurement)
    zusammen = bereinigt + browser_findings(measurement)
    if not html_hat_ausgewertet(html_audit):
        # Doppelte kann es nicht geben: die HTML-Stufe hat hier nichts
        # geliefert, und ein Code steht in genau einer der beiden Listen.
        zusammen += dom_findings(measurement)
    return {
        **(html_audit or {}),
        "findings": sort_by_rank(zusammen),
        "browser_status": (measurement or {}).get("status"),
    }


def top_finding(audit: dict | None, measurement: dict | None = None) -> dict | None:
    """Der EINE Befund, der in den Text geht.

    Nie eine Liste. Das Playbook (apps/web/lib/copy/playbook.ts) verlangt EINE
    Friction ueber alle vier Stufen hinweg; mehrere Befunde im Prompt-Kontext
    waeren eine Einladung ans Modell, sie aufzuzaehlen, und aus einem
    ueberpruefbaren Aufhaenger wuerde eine Maengelliste.

    Mit `measurement` wird vorher die Browser-Stufe verrechnet: widerlegte
    HTML-Befunde fallen weg, Browser-Befunde kommen dazu. Ohne bleibt das
    Verhalten exakt wie bisher, was fuer alle Zeilen ohne Browser-Stufe gilt.

    Gewaehlt wird nur aus MAILABLE_CODES. Fuenf Codes werden gemessen und
    gespeichert, duerfen aber nie behauptet werden; ohne diesen Filter
    gewaenne frueher oder spaeter tap_targets_small, den 28 von 40 Leads haben.
    """
    if measurement is not None:
        audit = combine(audit, measurement)
    findings = (audit or {}).get("findings") or []
    known = [f for f in findings if f.get("code") in MAILABLE_CODES]
    if not known:
        return None
    return sort_by_rank(known)[0]
