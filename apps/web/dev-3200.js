// Startet den Dev-Server der App auf Port 3200 -- und zwar mit diesem
// Verzeichnis als Arbeitsverzeichnis.
//
// Grund: Tailwind v4 ermittelt die zu durchsuchenden Dateien relativ zum
// Arbeitsverzeichnis des Prozesses, nicht relativ zur CSS-Datei. Ein
// "next dev apps/web" aus einem anderen Ordner startet zwar, liefert aber
// CSS ohne die Utility-Klassen -- die Seite sieht dann kaputt aus, obwohl
// der Code stimmt.
//
// 3200, weil 3000 das m365-Projekt und 3100 die Website belegt.
process.chdir(__dirname);
process.argv = [process.argv[0], "next", "dev", "--port", "3200"];
require("next/dist/bin/next");
