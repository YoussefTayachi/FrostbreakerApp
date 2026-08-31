FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY worker ./worker
RUN pip install --no-cache-dir .
# Chromium und die Systembibliotheken, die das schlanke Basisimage nicht
# mitbringt. Das pip-Paket allein reicht NICHT: es bringt nur die Steuerung
# mit, nicht den Browser, und ohne diese Zeile scheitert jede Messung mit
# "Executable doesn't exist" statt mit einem fehlenden Modul. Der Fehler waere
# genauso still wie der davor, weil website_browser.measure ihn faengt.
#
# Nur chromium, nicht "playwright install" ohne Argument: Firefox und WebKit
# kosten zusammen noch einmal rund 400 MB Image, und website_browser startet
# ausschliesslich Chromium (siehe BrowserPool._start).
RUN playwright install --with-deps chromium
CMD ["python", "-m", "worker.main"]
