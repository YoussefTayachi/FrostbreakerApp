# Testlauf (Windows, ohne Vorkenntnisse)

1. **Python installieren** (einmalig): https://www.python.org/downloads/ → "Download Python" → im Installer unbedingt den Haken **"Add python.exe to PATH"** setzen → Install.
2. **Code herunterladen**: https://github.com/YoussefTayachi/System3_App/archive/refs/heads/main.zip → ZIP entpacken (z. B. auf den Desktop).
3. **`start_worker.bat` doppelklicken** (im entpackten Ordner). Beim ersten Start öffnet sich Notepad → die 3 Konfigurationszeilen (von Claude) einfügen → speichern → schließen. Der Worker startet dann automatisch und arbeitet alle offenen Jobs ab.

**Ergebnis ansehen:** supabase.com/dashboard → Projekt "System 3" → Table Editor →
- `businesses` = gefundene Firmen
- `contacts` = Decisionmaker + E-Mail-Adressen
- `jobs` = Job-Status (pending → running → completed)

Wenn im Fenster eine Weile keine neuen Jobs mehr kommen, ist alles fertig: Fenster schließen.
