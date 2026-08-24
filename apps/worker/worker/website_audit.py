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
FINDING_CODES: tuple[str, ...] = (
    "ssl_broken",
    "no_https",
    "no_viewport",
    "stale_copyright",
    "mixed_content",
    "site_builder",
    "legacy_markup",
    "no_meta_description",
)

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
    "ssl_broken": "Das SSL-Zertifikat der Website ist abgelaufen oder ungueltig.",
    "no_https": "Die Website laeuft ohne durchgehende HTTPS-Verschluesselung.",
    "no_viewport": "Die Website ist nicht fuer Mobilgeraete eingerichtet.",
    "stale_copyright": "Im Fussbereich der Website steht noch eine alte Jahreszahl.",
    "mixed_content": "Die Website laedt Teile von sich selbst noch unverschluesselt.",
    "site_builder": "Die Website ist mit einem Homepage-Baukasten gebaut.",
    "legacy_markup": "Die Website nutzt HTML-Technik, die seit Jahren abgekuendigt ist.",
    "no_meta_description": "Der Website fehlt die Beschreibung fuer Suchmaschinen.",
}

CONSEQUENCE_DE: dict[str, str] = {
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


def unreachable(checked_url: str) -> dict:
    """Der Befund fuer eine Seite, die sich nicht abrufen liess.

    Leere Befundliste statt geratener Maengel. Ein nicht erreichbarer Server
    ist ein Ergebnis, kein Fehler; deshalb gibt es dafuer auch keinen
    Status 'failed' und keinen zweiten Versuch.
    """
    return {"checked_url": checked_url, "findings": []}


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


def top_finding(audit: dict | None) -> dict | None:
    """Der EINE Befund, der in den Text geht.

    Nie eine Liste. Das Playbook (apps/web/lib/copy/playbook.ts) verlangt EINE
    Friction ueber alle vier Stufen hinweg; mehrere Befunde im Prompt-Kontext
    waeren eine Einladung ans Modell, sie aufzuzaehlen, und aus einem
    ueberpruefbaren Aufhaenger wuerde eine Maengelliste.
    """
    findings = (audit or {}).get("findings") or []
    known = [f for f in findings if f.get("code") in FINDING_CODES]
    if not known:
        return None
    return sort_by_rank(known)[0]
