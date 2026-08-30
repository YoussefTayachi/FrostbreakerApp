"""Die zweite Stufe des Website-Checks: dieselbe Seite in einem echten Browser.

WARUM UEBERHAUPT EIN BROWSER

website_audit.py liest rohes HTML und sagt im eigenen Docstring, was ihm damit
verwehrt bleibt: Ladezeit, alles Gerenderte, alles Mobile. Gemessen am
2026-08-30 an 38 echten Leads aus der Produktionsdatenbank kostet das nicht nur
Befunde, es erzeugt falsche:

  - 3 von 38 Seiten waren per rohem HTTP nicht abrufbar und im Browser schon.
    Sie sind auf dem Weg zu site_unreachable, also zu "eure Seite laedt gar
    nicht" fuer eine Seite, die laedt.
  - 1 von 38 (ekomenu.nl) meldete "kein h1, keine description", beides steht
    im gerenderten DOM. Das Skript setzt es ein.

Dieses Modul misst deshalb im Chromium nach. Es ist die reine Messung: HTML
und DOM rein, Zahlen raus. Was davon ein Mangel ist, entscheidet
website_audit.py, und was in eine Mail darf, entscheidet der Katalog dort.
Dieselbe Trennung wie zwischen website_fetch.py und website_audit.py, und aus
demselben Grund: eine Regelaenderung darf nicht 4365 Seiten neu laden.

WAS HIER NICHT ENTSCHIEDEN WIRD

Ob ein Messwert einen Vorwurf traegt. `measure()` liefert auch Zahlen, die
NIE in eine Mail duerfen (Konsolenfehler, Schriftgroessen, Trefferflaechen,
Ladezeit). Sie sind in der Oberflaeche etwas wert und als Behauptung
gegenueber einem Fremden wertlos, weil er sie in dreissig Sekunden widerlegt.

SICHERHEIT

Eine Lead-URL ist eine fremde Adresse, und ein Browser folgt ihr weiter als
ein httpx-Abruf: er loest DNS selbst auf, folgt Weiterleitungen und laedt
Unterressourcen nach. Deshalb zwei Sperren. Vorab wird die Ziel-IP geprueft,
und zusaetzlich haengt ein Handler an JEDER Anfrage des Kontexts und bricht
sie ab, wenn ihr Ziel nicht oeffentlich ist.

Das schliesst DNS-Rebinding nicht restlos aus: zwischen der Pruefung des
Namens und der Verbindung liegt ein Fenster, und dicht bekaeme man es nur
ueber einen erzwingenden Proxy. Diese Luecke ist im Plan benannt und bewusst
in Kauf genommen, weil dieser Worker auf einem Einzelplatzrechner laeuft und
der bestehende httpx-Weg dasselbe Risiko ohne jede Pruefung traegt. Zieht der
Worker je in eine Umgebung mit erreichbaren internen Diensten, gehoert der
Proxy davor.
"""
from __future__ import annotations

import ipaddress
import logging
import socket
from dataclasses import dataclass, field
from urllib.parse import urlparse

log = logging.getLogger("worker.website_browser")

# Zeitgrenzen. Grosszuegiger als beim HTTP-Abruf, weil ein Browser rendert,
# und trotzdem hart: eine fremde Seite darf den Worker nicht besetzen.
NAV_TIMEOUT_MS = 30_000
TOTAL_TIMEOUT_MS = 90_000
SETTLE_MS = 2_500

# Wie viele Jobs ein Chromium-Prozess traegt, bevor er ersetzt wird. Ein
# Kaltstart kostet rund eine Sekunde, also mehr als die halbe Messung; ihn je
# Job zu zahlen halbiert den Durchsatz. Ihn nie zu zahlen sammelt Speicher.
PROCESS_ROTATE_AFTER = 50

HANDY = {
    "viewport": {"width": 390, "height": 844},
    "device_scale_factor": 3,
    "is_mobile": True,
    "has_touch": True,
    "user_agent": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ),
}
DESKTOP = {"viewport": {"width": 1440, "height": 900}}

# Woran eine Wand erkannt wird, hinter der die eigentliche Seite liegt. Ein
# Consent-Dialog, eine Anmeldung oder eine Bot-Pruefung sind KEIN Mangel: sie
# sind eine Messung, die nichts ueber die Seite sagt. Wer daraus einen Befund
# macht, schreibt einem Inhaber, seine Seite sei leer, weil ein Cookie-Banner
# davor stand.
_WALL_MARKERS = (
    "just a moment",
    "checking your browser",
    "enable javascript and cookies to continue",
    "verifying you are human",
    "attention required! | cloudflare",
    "access denied",
    "are you a robot",
)
_WALL_SELECTORS = (
    "#challenge-form",
    "#cf-challenge-running",
    "iframe[src*='challenges.cloudflare.com']",
    "#px-captcha",
)

# Ab wieviel sichtbarem Text eine Seite als benutzbar gilt, egal was sonst
# darauf steht.
#
# Gemessen am 2026-08-30: mit `iframe[title*='recaptcha']` in der Liste oben
# galten 3 von 25 Leads als unpruefbar (wuzzon.com, hypd.nl, sightkick.nl),
# und alle drei sind voellig normale Seiten. reCAPTCHA v3 laedt unsichtbar auf
# JEDER Seite, und die v2-Fassung steckt in fast jedem Kontaktformular. Ein
# Widget auf einer funktionierenden Seite ist keine Wand davor.
#
# Die Regel lautet deshalb: eine Wand ist es nur, wenn ausser der Wand kaum
# etwas da ist. Bei einer echten Cloudflare-Pruefung steht "Just a moment" auf
# einer sonst leeren Seite, das trifft sicher zu. Ein Fehlalarm hier kostet
# einen Befund, den es gegeben haette.
WALL_MAX_TEXT = 600


@dataclass
class Messung:
    """Was eine Seite hergegeben hat. Immer vollstaendig, auch nach einem Fehler."""

    url: str
    status: str = "failed"  # completed | inconclusive | failed | skipped
    reason: str | None = None
    http_status: int | None = None
    final_url: str | None = None
    desktop: dict = field(default_factory=dict)
    handy: dict = field(default_factory=dict)
    timing_ms: list[int] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    blocked_requests: list[str] = field(default_factory=list)
    screenshot: str | None = None
    duration_ms: int = 0

    def as_dict(self) -> dict:
        return {
            "url": self.url,
            "status": self.status,
            "reason": self.reason,
            "http_status": self.http_status,
            "final_url": self.final_url,
            "desktop": self.desktop,
            "handy": self.handy,
            "timing_ms": self.timing_ms,
            "console_errors": self.console_errors[:5],
            "console_error_count": len(self.console_errors),
            "blocked_requests": self.blocked_requests[:5],
            "screenshot": self.screenshot,
            "duration_ms": self.duration_ms,
        }


# ───────────────────────────────────────────────────────── Zieladressen


def is_public_host(host: str) -> bool:
    """Loest einen Hostnamen auf und sagt, ob ALLE Ziele oeffentlich sind.

    Alle und nicht eines: ein Name kann auf mehrere Adressen zeigen, und es
    reicht, wenn eine davon ins eigene Netz fuehrt. Ist der Name nicht
    aufloesbar, gilt er als nicht oeffentlich - dann laedt die Seite ohnehin
    nicht, und ein Fehlschlag ist hier die sichere Richtung.
    """
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        roh = info[4][0]
        try:
            adresse = ipaddress.ip_address(roh)
        except ValueError:
            return False
        if (
            adresse.is_private
            or adresse.is_loopback
            or adresse.is_link_local
            or adresse.is_reserved
            or adresse.is_multicast
            or adresse.is_unspecified
        ):
            return False
    return True


def is_public_url(url: str) -> bool:
    """Wie is_public_host, aber fuer eine ganze Adresse. Nur http und https."""
    try:
        teile = urlparse(url)
    except ValueError:
        return False
    if teile.scheme not in ("http", "https"):
        return False
    return is_public_host(teile.hostname or "")


# ───────────────────────────────────────────────────────── die Sonden

# Laeuft im Seitenkontext. Bewusst ein Block und keine Schleife mit Wartezeiten:
# lange Schleifen haben den Renderer beim Handbetrieb zweimal eingefroren.
SONDEN_JS = r"""
() => {
  const meta = n => (document.querySelector(`meta[name='${n}']`) || {}).content || null;
  const prop = p => (document.querySelector(`meta[property='${p}']`) || {}).content || null;

  /* Der Hauptinhalt, nicht die ganze Seite. Ein Befund ueber eine Fussnote
     oder ein Cookie-Banner traegt keine Mail. */
  const haupt = document.querySelector("main, [role='main'], #main, #content, .main, article")
             || document.body;

  const sichtbar = e => {
    const s = getComputedStyle(e);
    if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) === 0) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  /* Eine blanke Telefonnummer ist ein guter Befund, eine erfundene ein teurer
     Fehler. Skript- und CSS-Inhalte sind Textknoten ohne Kinder und stecken
     voller Ziffern; ausserdem muss der Text UEBERWIEGEND aus der Nummer
     bestehen, sonst ist es Fliesstext, in dem zufaellig Zahlen stehen. */
  const phoneRe = /(\+?\d[\d\s/().-]{7,})/;
  const blanke = [...document.querySelectorAll("body *")]
    .filter(e => e.children.length === 0 && !e.closest("a")
                 && !e.closest("script, style, noscript, template"))
    .map(e => e.textContent.trim())
    .filter(t => {
      if (!phoneRe.test(t)) return false;
      const z = (t.match(/\d/g) || []).length;
      return z >= 7 && z <= 15 && t.length <= z * 2.5;
    })
    .map(t => t.slice(0, 40));

  /* Ein Abschnitt, an dessen Stelle ein Loch klafft. Nicht jede verborgene
     Schublade: Menues, Dialoge, Tabs, Akkordeons und Cookie-Zustaende sind
     absichtlich zu. Gemessen am 2026-08-30 meldete die Rohzahl 19 von 40
     Leads, und die Sichtpruefung des staerksten Falls zeigte eine voellig
     intakte Seite. */
  const istAbsicht = e => !!e.closest(
    "nav, dialog, details, [role='dialog'], [role='tabpanel'], [role='menu'], " +
    "[aria-modal='true'], [aria-hidden='true'], [hidden], " +
    "[class*='menu'], [class*='modal'], [class*='popup'], [class*='overlay'], " +
    "[class*='cookie'], [class*='consent'], [class*='drawer'], [class*='tab'], " +
    "[class*='accordion'], [class*='collapse'], [class*='slider'], [class*='carousel']");

  const verborgen = [...haupt.querySelectorAll("*")].filter(
    e => getComputedStyle(e).visibility === "hidden" && e.getBoundingClientRect().width > 50);
  const wurzeln = verborgen.filter(
    e => e.parentElement && getComputedStyle(e.parentElement).visibility !== "hidden");
  const loecher = wurzeln.filter(e => {
    const r = e.getBoundingClientRect();
    return r.height > 150 && r.width > window.innerWidth * 0.4
        && !istAbsicht(e) && (e.textContent || "").trim().length > 40;
  }).map(e => (e.tagName.toLowerCase() + (e.id ? "#" + e.id : "")
               + (e.className && typeof e.className === "string"
                  ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "")).slice(0, 60));

  /* Waagrechter Ueberlauf im Hauptinhalt, und zwar von etwas, das nicht
     absichtlich seitwaerts scrollt. Ein Karussell ist kein Mangel. */
  const ueberbreite = Math.max(0, document.documentElement.scrollWidth - window.innerWidth - 4);
  /* Ein Element allein reicht nicht. Ausgeschlossen werden zusaetzlich:
     jeder VORFAHR mit waagrechtem Scrollen (ein Kind in einem Karussell
     steht absichtlich ueber den Rand hinaus), alles Interaktive (ein zu
     breiter Knopf ist ein anderer Mangel als eine zu breite Seite) und
     alles, was sichtbar in einem Schieber sitzt. Bei der Diff-Inspektion
     am 2026-08-30 als moeglicher Fehlalarm in einer Kaltmail benannt. */
  const inScroller = e => {
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === "auto" || s.overflowX === "scroll") return true;
    }
    return false;
  };
  const INTERAKTIV = "a, button, input, select, textarea, label, [role='button'], "
                   + "[role='tab'], [onclick], [tabindex]";
  const ueberstehend = ueberbreite > 0
    ? [...haupt.querySelectorAll("*")].filter(e => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.right <= window.innerWidth + 4) return false;
        if (!sichtbar(e)) return false;
        const s = getComputedStyle(e);
        if (s.overflowX === "auto" || s.overflowX === "scroll") return false;
        if (e.matches(INTERAKTIV) || e.closest(INTERAKTIV)) return false;
        if (inScroller(e)) return false;
        if (e.closest("[class*='slider'], [class*='carousel'], [class*='marquee'], "
                    + "[class*='ticker'], [class*='scroll']")) return false;
        /* Nur echter Inhalt, kein leerer Layout-Kasten. */
        if ((e.textContent || "").trim().length < 15) return false;
        return true;
      }).map(e => (e.tagName.toLowerCase() + (e.id ? "#" + e.id : "")).slice(0, 60)).slice(0, 3)
    : [];

  const h1s = [...document.querySelectorAll("h1")];
  const txt = (document.body.innerText || "").replace(/\s+/g, " ").trim();

  return {
    titel: document.title || null,
    titelIstDomain: /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test((document.title || "").trim()),
    beschreibung: meta("description"),
    viewport: meta("viewport"),
    h1: h1s.length,
    h1Sichtbar: h1s.filter(sichtbar).length,
    h1Text: (h1s[0]?.innerText || "").trim().slice(0, 80) || null,
    ogImage: !!prop("og:image"),
    sprache: document.documentElement.lang || null,
    telLinks: document.querySelectorAll("a[href^='tel:']").length,
    mailLinks: document.querySelectorAll("a[href^='mailto:']").length,
    formulare: document.querySelectorAll("form").length,
    knoepfe: document.querySelectorAll("a.elementor-button, button, .btn, [role='button']").length,
    blankeNummern: blanke.slice(0, 3),
    loecher: loecher.slice(0, 3),
    loecherAnzahl: loecher.length,
    ueberbreite: ueberbreite,
    ueberstehend: ueberstehend,
    textUnter12px: [...haupt.querySelectorAll("p, li, a, span")].slice(0, 400)
      .filter(e => (e.textContent || "").trim().length > 15
                   && (parseFloat(getComputedStyle(e).fontSize) || 99) < 12).length,
    zielZuKlein: [...haupt.querySelectorAll("a, button")].slice(0, 200)
      .filter(e => { const r = e.getBoundingClientRect();
                     return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44); }).length,
    hauptTextLaenge: (haupt.innerText || "").trim().length,
    textLaenge: txt.length,
  };
}
"""

SCROLL_JS = r"""
async () => {
  const schritt = Math.max(400, window.innerHeight * 0.8);
  for (let y = 0; y < document.body.scrollHeight; y += schritt) {
    window.scrollTo(0, y);
    await new Promise(w => setTimeout(w, 120));
  }
  window.scrollTo(0, 0);
  await new Promise(w => setTimeout(w, 200));
}
"""

WAND_JS = """
(sel) => {
  const text = (document.body.innerText || "").toLowerCase().slice(0, 3000);
  return {
    text: text,
    treffer: sel.filter(s => !!document.querySelector(s)),
  };
}
"""


def wall_reason(text: str, treffer: list[str], sichtbarer_text: int | None = None) -> str | None:
    """Steht eine Wand vor der Seite? Dann sagt die Messung nichts aus.

    `sichtbarer_text` ist die Laenge des sichtbaren Textes. Liegt sie ueber
    WALL_MAX_TEXT, ist die Seite da, und ein Challenge-Element darauf ist ein
    Widget und keine Wand. Ohne den Wert wird nur nach Merkmalen entschieden,
    wie in den Tests.
    """
    unten = (text or "").lower()
    gefunden = None
    if treffer:
        gefunden = f"challenge-element: {treffer[0]}"
    else:
        for marke in _WALL_MARKERS:
            if marke in unten:
                gefunden = f"challenge-text: {marke}"
                break
    if gefunden is None:
        return None
    if sichtbarer_text is not None and sichtbarer_text > WALL_MAX_TEXT:
        return None
    return gefunden


# ───────────────────────────────────────────────────────── der Browser


class BrowserPool:
    """Ein Chromium, der mehrere Messungen traegt und sich selbst ersetzt.

    Playwright wird erst hier importiert. Der Rest des Moduls, insbesondere die
    Auswertung und die Adresspruefung, laesst sich damit ohne installierten
    Browser testen, und ein Worker, der nie eine Seite misst, zahlt den Import
    nicht.
    """

    def __init__(self, rotate_after: int = PROCESS_ROTATE_AFTER):
        self._pw = None
        self._browser = None
        self._benutzt = 0
        self._rotate_after = rotate_after

    def browser(self):
        if self._browser is not None and self._benutzt >= self._rotate_after:
            self.close()
        if self._browser is None:
            from playwright.sync_api import sync_playwright

            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(
                args=["--disable-dev-shm-usage", "--no-sandbox"]
            )
            self._benutzt = 0
        self._benutzt += 1
        return self._browser

    def close(self) -> None:
        if self._browser is not None:
            try:
                self._browser.close()
            except Exception as e:  # ein sterbender Browser darf nichts abbrechen
                log.warning("Konnte den Browser nicht schliessen: %s", e)
        if self._pw is not None:
            try:
                self._pw.stop()
            except Exception as e:
                log.warning("Konnte Playwright nicht stoppen: %s", e)
        self._browser = None
        self._pw = None
        self._benutzt = 0

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _sperre_fremde_ziele(kontext, gesperrt: list[str]) -> None:
    """Jede Anfrage des Kontexts gegen nicht-oeffentliche Ziele abbrechen.

    Nicht nur das Dokument: ein Bild, ein Skript oder ein iframe kann genauso
    auf eine interne Adresse zeigen. Der Handler ist die zweite Sperre neben
    der Vorabpruefung; zusammen decken sie alles ab ausser dem Fenster
    zwischen Namensaufloesung und Verbindung (siehe Modul-Docstring).
    """

    def handler(route, request):
        try:
            if is_public_url(request.url):
                route.continue_()
                return
            gesperrt.append(request.url[:120])
            route.abort()
        except Exception:
            # Ein Fehler im Handler darf die Messung nicht aufhaengen. Im
            # Zweifel wird abgebrochen und nicht durchgelassen.
            try:
                route.abort()
            except Exception:
                pass

    kontext.route("**/*", handler)


def _oeffne(browser, url: str, geraet: dict, gesperrt: list[str]):
    """Ein frischer Kontext mit allen Sperren, dazu geladene Seite und Antwort."""
    kontext = browser.new_context(accept_downloads=False, ignore_https_errors=False, **geraet)
    kontext.set_default_timeout(NAV_TIMEOUT_MS)
    _sperre_fremde_ziele(kontext, gesperrt)
    seite = kontext.new_page()
    antwort = seite.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
    return kontext, seite, antwort


def measure(url: str, *, pool=None, screenshot_dir=None, screenshot_name: str | None = None,
            timing_runs: int = 0):
    """Eine Seite messen. Wirft nie: ein Fehlschlag ist selbst ein Ergebnis.

    Die Reihenfolge ist die Beweisfuehrung: laden, warten, DURCHSCROLLEN, dann
    messen. Ohne das Scrollen meldet jedes Bild unterhalb des sichtbaren
    Bereichs, es sei nicht geladen; daraus einen Vorwurf zu bauen hiesse, Lazy
    Loading als Mangel zu verkaufen.
    """
    import time
    from pathlib import Path

    start = time.monotonic()
    m = Messung(url=url)

    if not is_public_url(url):
        m.status = "skipped"
        m.reason = "Ziel ist nicht oeffentlich erreichbar oder kein http(s)"
        return m

    eigener_pool = pool is None
    pool = pool or BrowserPool()
    kontext = None
    try:
        browser = pool.browser()
        kontext, seite, antwort = _oeffne(browser, url, DESKTOP, m.blocked_requests)
        # status ist in der Python-API ein Property, keine Methode. Als
        # Methodenaufruf endet jede Messung mit "'int' object is not callable",
        # und weil measure() nie wirft, sieht man nur status=failed.
        m.http_status = antwort.status if antwort else None
        m.final_url = seite.url

        konsole: list[str] = []
        seite.on("console", lambda n: konsole.append(n.text[:160]) if n.type == "error" else None)
        seite.on("pageerror", lambda e: konsole.append(f"pageerror: {str(e)[:160]}"))

        seite.wait_for_timeout(SETTLE_MS)

        # Steht eine Wand davor, ist jede weitere Zahl wertlos. Geprueft wird
        # VOR den Sonden, damit ein Cookie-Banner nicht als leere Seite in die
        # Auswertung geht.
        wand = seite.evaluate(WAND_JS, list(_WALL_SELECTORS))
        grund = wall_reason(
            wand.get("text", ""), wand.get("treffer", []), len(wand.get("text", "")))
        if grund:
            m.status = "inconclusive"
            m.reason = grund
            return m

        seite.evaluate(SCROLL_JS)
        m.desktop = seite.evaluate(SONDEN_JS)
        m.console_errors = konsole

        if screenshot_dir and screenshot_name:
            ziel = Path(screenshot_dir)
            ziel.mkdir(parents=True, exist_ok=True)
            pfad = ziel / f"{screenshot_name}.png"
            seite.screenshot(path=str(pfad), full_page=False)
            m.screenshot = str(pfad)

        # Ladezeit, standardmaessig AUS.
        #
        # Sie geht nie in eine Mail (siehe PLAN.md): ein Inhaber laedt seine
        # Seite aus dem Cache und sieht etwas anderes, und den Messaufbau
        # duerfen wir nicht nennen. Fuer die Oberflaeche taugt sie, und wer
        # sie will, schaltet sie ein.
        #
        # Gemessen am 2026-08-30 kostete jeder zusaetzliche Ladevorgang rund
        # 40 Prozent der Messzeit je Seite (11 s statt 7 s). Auf 4365 Leads
        # sind das Stunden fuer eine Zahl, die niemand versenden darf.
        for _ in range(max(0, timing_runs)):
            try:
                seite.reload(wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                wert = seite.evaluate(
                    "() => { const n = performance.getEntriesByType('navigation')[0];"
                    " return n ? Math.round(n.domContentLoadedEventEnd) : null; }"
                )
                if wert:
                    m.timing_ms.append(int(wert))
            except Exception:
                break
        kontext.close()
        kontext = None

        # TOTAL_TIMEOUT_MS ist eine Frist ueber BEIDE Ansichten, nicht je
        # Navigation. Ohne diese Pruefung koennen 30 Sekunden Desktop, langes
        # Scrollen und 30 Sekunden Handy zusammen deutlich darueber liegen;
        # die Konstante stand da und tat nichts. Bei der Diff-Inspektion am
        # 2026-08-30 gefunden.
        verbraucht = (time.monotonic() - start) * 1000
        if verbraucht > TOTAL_TIMEOUT_MS * 0.6:
            m.status = "completed"
            m.reason = "Handy-Ansicht wegen Zeitbudget ausgelassen"
            return m

        # Das Handy ist ein eigener Kontext und keine Groessenaenderung:
        # Baukaesten haengen ihre Weiche am User-Agent, nicht an der Breite.
        mk, mseite, _ = _oeffne(browser, url, HANDY, m.blocked_requests)
        try:
            mseite.wait_for_timeout(SETTLE_MS)
            mseite.evaluate(SCROLL_JS)
            m.handy = mseite.evaluate(SONDEN_JS)
            if screenshot_dir and screenshot_name:
                mseite.screenshot(
                    path=str(Path(screenshot_dir) / f"{screenshot_name}-handy.png"),
                    full_page=False,
                )
        finally:
            mk.close()

        m.status = "completed"
    except Exception as e:
        m.status = "failed"
        m.reason = str(e).split("\n")[0][:200]
    finally:
        if kontext is not None:
            try:
                kontext.close()
            except Exception:
                pass
        if eigener_pool:
            pool.close()
        m.duration_ms = int((time.monotonic() - start) * 1000)
    return m
