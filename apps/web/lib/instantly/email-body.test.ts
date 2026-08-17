import { describe, expect, it } from "vitest";
import { emailBodyText, htmlToText } from "./email-body";

describe("emailBodyText", () => {
  it("nimmt den Nur-Text, wenn er da ist", () => {
    expect(emailBodyText({ text: "Hallo Anna", html: "<p>egal</p>" })).toBe("Hallo Anna");
  });

  // Der Fall, der die Funktion ueberhaupt notwendig gemacht hat: 184 von 184
  // ausgehenden Nachrichten hatten einen leeren Body, weil nur text gelesen
  // wurde.
  it("faellt auf HTML zurueck, wenn kein Text da ist", () => {
    expect(emailBodyText({ text: null, html: "<p>Hallo Anna</p>" })).toBe("Hallo Anna");
  });

  it("wertet einen Body aus reinem Leerraum als leer", () => {
    expect(emailBodyText({ text: "  \n ", html: "<p>Der echte Inhalt</p>" })).toBe("Der echte Inhalt");
  });

  it("kommt ohne Body klar", () => {
    expect(emailBodyText(null)).toBe("");
    expect(emailBodyText(undefined)).toBe("");
    expect(emailBodyText({})).toBe("");
  });
});

describe("htmlToText", () => {
  it("macht aus Umbruch-Tags echte Zeilenumbrueche", () => {
    expect(htmlToText("Hallo Anna,<br/>kurze Frage:<br />hast du Zeit?")).toBe(
      "Hallo Anna,\nkurze Frage:\nhast du Zeit?"
    );
  });

  it("trennt Absaetze", () => {
    expect(htmlToText("<p>Erster</p><p>Zweiter</p>")).toBe("Erster\nZweiter");
  });

  it("wirft unsichtbares weg statt es als Absatz zu zeigen", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Nur das hier</p>")).toBe("Nur das hier");
    expect(htmlToText("<!-- Notiz --><p>Nur das hier</p>")).toBe("Nur das hier");
  });

  it("loest Entitaeten auf", () => {
    expect(htmlToText("<p>Schmidt &amp; S&ouml;hne &ndash; 5 &lt; 7</p>")).toBe(
      "Schmidt & Söhne – 5 < 7"
    );
  });

  // Die Akzente werden aus Buchstabe und kombinierendem Zeichen gebaut, nicht
  // aus einer Tabelle; der Test haelt fest, dass das fuer die ganze Familie
  // gilt und nicht nur fuer die drei deutschen Umlaute.
  it("loest die Akzent-Entitaeten in beiden Schreibweisen auf", () => {
    expect(htmlToText("<p>&Ouml;sterreich, caf&eacute;, fran&ccedil;ais, &Aring;ngstr&ouml;m</p>")).toBe(
      "Österreich, café, français, Ångström"
    );
  });

  it("laesst eine Akzent-Kombination stehen, die kein Zeichen ergibt", () => {
    // "q" mit Ring gibt es nicht; ein nacktes kombinierendes Zeichen im
    // Text waere schlimmer als die unaufgeloeste Entitaet.
    expect(htmlToText("<p>&qring;</p>")).toBe("&qring;");
  });

  it("loest numerische Entitaeten auf, dezimal wie hexadezimal", () => {
    expect(htmlToText("<p>&#8364;100 &#x2014; fertig</p>")).toBe("€100 — fertig");
  });

  it("laesst unbrauchbare Codepunkte stehen, statt sie stumm zu schlucken", () => {
    expect(htmlToText("<p>&#0; &nichtsdergleichen;</p>")).toBe("&#0; &nichtsdergleichen;");
  });

  it("legt nicht drei Leerzeilen uebereinander", () => {
    expect(htmlToText("<p>Oben</p><br/><br/><br/><br/><p>Unten</p>")).toBe("Oben\n\nUnten");
  });

  it("laesst geschuetzte Leerzeichen nicht als Rest stehen", () => {
    expect(htmlToText("<p>Viele&nbsp;&nbsp;Gruesse</p>")).toBe("Viele Gruesse");
  });

  it("kommt mit einer ganzen Kampagnenmail klar", () => {
    const html = [
      "<html><head><style>.x{}</style></head><body>",
      '<div dir="ltr">Hi Anna,<br><br>',
      "ich habe gesehen, dass ihr Shopify nutzt.<br>",
      "Passt ein kurzer Austausch diese Woche?<br><br>",
      "Viele Gr&uuml;&szlig;e<br>Youssef",
      "</div></body></html>",
    ].join("");
    expect(htmlToText(html)).toBe(
      [
        "Hi Anna,",
        "",
        "ich habe gesehen, dass ihr Shopify nutzt.",
        "Passt ein kurzer Austausch diese Woche?",
        "",
        "Viele Grüße",
        "Youssef",
      ].join("\n")
    );
  });
});
