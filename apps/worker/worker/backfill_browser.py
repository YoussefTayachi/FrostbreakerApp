"""Die Browser-Stufe fuer Leads nachholen, die es noch nicht gab.

    python -m worker.backfill_browser --limit 50            # Canary
    python -m worker.backfill_browser --alle --parallel 4    # Vollbatch

WARUM NICHT UEBER DIE JOB-QUEUE

4365 Messungen zu je mehreren Sekunden waeren dort ein Stau, hinter dem jede
laufende Leadsuche wartet. Der Backfill laeuft deshalb daneben, mit eigenem
Deckel, und kann jederzeit abgebrochen und fortgesetzt werden. Neue Leads
gehen weiter ueber die Queue: dort ist es EIN Job neben anderen.

WAS DER LAUF EINHAELT

Der Ressourcenvertrag steht fest und nicht im Ermessen: hoechstens PARALLEL
Faeden, JE FADEN ein Chromium-Prozess mit einem Kontext, Rotation nach 50
Messungen, 30 Sekunden je Seite und 90 je Lead.

Dass es ein Prozess je Faden ist und nicht einer fuer alle, ist keine
Bequemlichkeit: Playwrights synchrone API haengt an dem Faden, der sie
gestartet hat. Ein geteilter Browser liefert 'Expected: <greenlet.greenlet
object ...>' und misst nichts. Der Plan sprach von einem Prozess und vier
Kontexten; das war technisch nicht haltbar, und die ehrliche Fassung steht
hier statt einer Zahl, die niemand einhaelt. Vier Prozesse sind rund vier
Gigabyte Hochstand, deshalb ist PARALLEL_MAX hart begrenzt.

DEDUPLIZIERT WIRD NACH ADRESSE

Mehrere Leads teilen sich eine Website. Dieselbe Seite fuenfmal zu laden
kostet nicht nur Zeit, es erhoeht auch die Wahrscheinlichkeit, als Bot
aufzufallen. Gemessen wird einmal je Adresse, geschrieben wird auf alle Leads
dahinter.

DER CANARY IST KEINE FORMALITAET

Mit --limit laeuft eine Stichprobe, und ihre Kennzahlen entscheiden ueber den
Vollbatch. Die Grenzen stehen im PLAN.md und hier unten in KRITERIEN: EIN
bestaetigter Fehlalarm eines versendbaren Codes setzt diesen Code aus, und
ueber 20 Prozent nicht auswertbare Seiten stoppen den Lauf. Ohne vorher
festgelegte Grenzen rechtfertigt ein wohlwollender Blick jeden Vollbatch.
"""
from __future__ import annotations

import argparse
import json
import logging
import pathlib
import time
from collections import Counter
from datetime import datetime, timezone

from worker import website_audit, website_browser
from worker.db import sb

log = logging.getLogger("worker.backfill_browser")

PARALLEL = 4
# Harte Obergrenze. Je Faden laeuft ein eigener Chromium, und der braucht
# laut Messungen rund ein Gigabyte. Wer --parallel 32 tippt, legt seinen
# Rechner lahm; die Grenze steht hier und nicht im Ermessen des Aufrufers.
PARALLEL_MAX = 8
SCREENSHOT_DIR = "out/browser-check"
BERICHT_DIR = "out/backfill"

# Woran der Canary scheitert. Zahlen aus PLAN.md, hier als Code, damit sie
# jemand nachrechnen kann statt sie zu erinnern.
KRITERIEN = {
    "max_inconclusive_anteil": 0.20,
    "max_fehlalarm_je_code": 0,       # ein einziger bestaetigter reicht
    "min_beobachtungen_je_code": 15,
}


def _leads(limit: int | None, alle: bool) -> list[dict]:
    """Leads mit Adresse, die noch keine Browser-Stufe haben.

    Sortiert nach id und damit stabil: bricht der Lauf ab, setzt der naechste
    hinter dem letzten geschriebenen Lead fort, ohne dass ein Cursor in einer
    Datei stehen muss.
    """
    q = (
        sb()
        .table("businesses")
        .select("id, website, website_audit, website_audit_browser_status")
        .not_.is_("website", "null")
        .neq("website", "")
        .order("id")
    )
    if not alle:
        q = q.is_("website_audit_browser_status", "null")
    if limit:
        q = q.limit(limit)
    return q.execute().data or []


def _adresse(lead: dict) -> str:
    """Die Adresse, die gemessen wird."""
    url = (lead.get("website") or "").strip()
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def kanonisch(url: str) -> str:
    """Der Schluessel, unter dem zwei Leads dieselbe Website teilen.

    Ohne diese Form gelten example.com, www.example.com und dieselbe
    Adresse mit einem utm-Anhaengsel als drei verschiedene Seiten, und der
    Lauf laedt sie dreimal. Das kostet nicht nur Zeit, jede zusaetzliche
    Anfrage erhoeht die Wahrscheinlichkeit, als Bot aufzufallen.

    Die WIRKLICH kanonische Form waere die finale URL nach allen
    Weiterleitungen, und die kennt man erst nach der Messung. Das bleibt
    offen und ist im Plan benannt; diese Form faengt die haeufigen Faelle.
    """
    from urllib.parse import urlparse

    try:
        teile = urlparse(url)
    except ValueError:
        return url.lower()
    host = (teile.hostname or "").lower().removeprefix("www.")
    pfad = (teile.path or "/").rstrip("/") or "/"
    return f"{host}{pfad}"


def _schreibe(business_ids: list[str], messung: dict) -> None:
    """Eine Messung auf alle Leads derselben Adresse schreiben."""
    sb().table("businesses").update(
        {
            "website_audit_browser": messung,
            "website_audit_browser_status": messung.get("status"),
            "website_audit_browser_at": datetime.now(timezone.utc).isoformat(),
            "browser_audit_required": True,
        }
    ).in_("id", business_ids).execute()


def lauf(limit: int | None = None, alle: bool = False, parallel: int = PARALLEL,
         trocken: bool = False) -> dict:
    parallel = max(1, min(int(parallel), PARALLEL_MAX))
    leads = _leads(limit, alle)
    # Gruppiert wird nach der kanonischen Form, gemessen wird die erste
    # Adresse dieser Gruppe.
    nach_adresse: dict[str, list[dict]] = {}
    messadresse: dict[str, str] = {}
    ohne_adresse = 0
    for lead in leads:
        url = _adresse(lead)
        if not url:
            ohne_adresse += 1
            continue
        schluessel = kanonisch(url)
        nach_adresse.setdefault(schluessel, []).append(lead)
        messadresse.setdefault(schluessel, url)

    adressen = [messadresse[s] for s in nach_adresse]
    gruppe_von = {messadresse[s]: nach_adresse[s] for s in nach_adresse}
    print(f"\n  {len(leads)} Leads, {len(adressen)} verschiedene Adressen, "
          f"{parallel} parallel{', TROCKEN' if trocken else ''}\n")

    zustaende: Counter[str] = Counter()
    codes: Counter[str] = Counter()
    dauern: list[int] = []
    fertig = 0
    t0 = time.monotonic()

    # EIN BROWSER JE FADEN, und zwar wirklich.
    #
    # Playwrights synchrone API haengt an dem Faden, der sie gestartet hat.
    # Der erste Entwurf hielt den Pool in einem gewoehnlichen Dictionary, das
    # sich alle Faeden teilten; der Canary am 2026-08-30 lieferte darauf 21
    # von 25 Fehlschlaegen in 20 bis 160 Millisekunden, jeder mit
    # "Expected: <greenlet.greenlet object ...>". Zu schnell fuer einen
    # Netzfehler und deshalb sofort als eigener Fehler erkennbar - das ist der
    # Grund, warum der Canary vor dem Vollbatch steht.
    #
    # Gearbeitet wird deshalb mit eigenen Faeden statt mit map: nur so kann
    # jeder seinen Browser im with-Block halten und am Ende schliessen. Ein
    # ThreadPoolExecutor laesst seine Faeden ohne Aufraeumen sterben, und
    # zurueck bleiben Chromium-Prozesse.
    import queue as _queue
    import threading

    aufgaben: _queue.Queue = _queue.Queue()
    for url in adressen:
        aufgaben.put(url)
    ergebnisse: _queue.Queue = _queue.Queue()

    def arbeiter() -> None:
        with website_browser.BrowserPool() as pool:
            while True:
                try:
                    url = aufgaben.get_nowait()
                except _queue.Empty:
                    return
                gruppe = gruppe_von[url]
                try:
                    m = website_browser.measure(
                        url, pool=pool, screenshot_dir=SCREENSHOT_DIR,
                        screenshot_name=str(gruppe[0]["id"]),
                    ).as_dict()
                    if not trocken:
                        _schreibe([g["id"] for g in gruppe], m)
                except Exception as e:  # ein Lead darf den Lauf nicht beenden
                    m = {"url": url, "status": "failed", "reason": str(e)[:200],
                         "duration_ms": 0}
                ergebnisse.put((url, m))

    faeden = [threading.Thread(target=arbeiter, daemon=True) for _ in range(parallel)]
    for f in faeden:
        f.start()
    for _ in range(len(adressen)):
        url, m = ergebnisse.get()
        fertig += 1  # noqa: SIM113 - enumerate ueber range(len(...)) laese schlechter
        zustaende[m["status"]] += 1
        dauern.append(m["duration_ms"])
        for f_ in website_audit.browser_findings(m):
            codes[f_["code"]] += 1
        print(f"  {fertig:>4}/{len(adressen)}  {m['status']:<13} "
              f"{m['duration_ms']:>6}ms  {url}")
    for f in faeden:
        f.join(timeout=60)

    dauer_s = time.monotonic() - t0
    sortiert = sorted(dauern) or [0]
    bericht = {
        "zeitpunkt": datetime.now(timezone.utc).isoformat(),
        "leads": len(leads),
        "adressen": len(adressen),
        "ohne_adresse": ohne_adresse,
        "parallel": parallel,
        "trocken": trocken,
        "dauer_s": round(dauer_s, 1),
        "zustaende": dict(zustaende),
        "befunde_je_code": dict(codes),
        "ms_median": sortiert[len(sortiert) // 2],
        "ms_p95": sortiert[int(len(sortiert) * 0.95) - 1] if len(sortiert) > 1 else sortiert[0],
    }
    _bewerte(bericht)
    _berichte(bericht)
    return bericht


def _bewerte(b: dict) -> None:
    """Die Canary-Kriterien anwenden. Sie stehen VOR dem Lauf fest."""
    gesamt = max(1, b["adressen"])
    nicht_auswertbar = b["zustaende"].get("inconclusive", 0) + b["zustaende"].get("failed", 0)
    anteil = nicht_auswertbar / gesamt
    b["anteil_nicht_auswertbar"] = round(anteil, 3)
    versendbar = {c: n for c, n in b["befunde_je_code"].items()
                  if c in website_audit.MAILABLE_CODES}
    b["versendbare_befunde"] = versendbar
    b["zu_wenige_beobachtungen"] = [
        c for c, n in versendbar.items() if n < KRITERIEN["min_beobachtungen_je_code"]
    ]
    # BEIDE Kriterien, nicht nur der Anteil. Der erste Entwurf gab den
    # Vollbatch allein nach der Quote frei und meldete "JA", obwohl im selben
    # Bericht "zu wenige Beobachtungen" stand: eine Freigabe, die ihre eigene
    # Einschraenkung ignoriert, ist keine. Bei der Diff-Inspektion gefunden.
    b["vollbatch_freigegeben"] = (
        anteil <= KRITERIEN["max_inconclusive_anteil"]
        and not b["zu_wenige_beobachtungen"]
        and bool(versendbar)
    )
    b["freigabe_grund"] = (
        "alle Kriterien erfuellt" if b["vollbatch_freigegeben"]
        else "zu viele nicht auswertbare Seiten" if anteil > KRITERIEN["max_inconclusive_anteil"]
        else "kein versendbarer Befund im Canary" if not versendbar
        else f"zu wenige Beobachtungen: {b['zu_wenige_beobachtungen']}"
    )


def _berichte(b: dict) -> None:
    ordner = pathlib.Path(BERICHT_DIR)
    ordner.mkdir(parents=True, exist_ok=True)
    name = b["zeitpunkt"].replace(":", "-")[:19]
    (ordner / f"{name}.json").write_text(
        json.dumps(b, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n  {b['adressen']} Adressen in {b['dauer_s']}s")
    print(f"  Median {b['ms_median']}ms, p95 {b['ms_p95']}ms")
    print(f"  Zustaende: {b['zustaende']}")
    print(f"  nicht auswertbar: {b['anteil_nicht_auswertbar'] * 100:.0f} Prozent "
          f"(Grenze {KRITERIEN['max_inconclusive_anteil'] * 100:.0f})")
    if b["befunde_je_code"]:
        print("  Befunde:")
        for code, n in sorted(b["befunde_je_code"].items(), key=lambda x: -x[1]):
            mail = "MAIL" if code in website_audit.MAILABLE_CODES else "    "
            print(f"    {n:>4}x  {mail}  {code}")
    if b["adressen"]:
        je = b["dauer_s"] / b["adressen"]
        print(f"\n  hochgerechnet auf 4365 Adressen: {je * 4365 / 60:.0f} Minuten")
    print(f"\n  Vollbatch freigegeben: {'JA' if b['vollbatch_freigegeben'] else 'NEIN'}"
          f"  ({b['freigabe_grund']})")
    if b["zu_wenige_beobachtungen"]:
        print(f"  zu wenige Beobachtungen fuer: {b['zu_wenige_beobachtungen']} "
              f"(mindestens {KRITERIEN['min_beobachtungen_je_code']})")
    print(f"  Bericht: {ordner / (name + '.json')}\n")


def main() -> None:
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit", type=int, default=None, help="nur so viele Leads (Canary)")
    p.add_argument("--alle", action="store_true", help="auch schon gemessene erneut")
    p.add_argument("--parallel", type=int, default=PARALLEL)
    p.add_argument("--trocken", action="store_true", help="messen, aber nichts schreiben")
    a = p.parse_args()
    lauf(limit=a.limit, alle=a.alle, parallel=a.parallel, trocken=a.trocken)


if __name__ == "__main__":
    main()
