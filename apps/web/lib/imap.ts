/**
 * Der kleinste IMAP-Client, der die eine Frage beantwortet, die beim
 * Verbinden eines Postfachs zaehlt: kommen wir rein, und wie heisst der
 * Gesendet-Ordner.
 *
 * WARUM KEINE BIBLIOTHEK
 *
 * apps/web haelt sieben Abhaengigkeiten. Eine achte fuer LOGIN, LIST und
 * LOGOUT waere ein schlechter Tausch: das Lesen der Mails passiert ohnehin
 * nicht hier, sondern im Python-Worker mit imaplib aus der
 * Standardbibliothek (worker/pipelines/sync_sent.py). Diese Datei existiert
 * allein dafuer, dass der Nutzer beim Speichern sofort erfaehrt, ob die
 * Zugangsdaten stimmen, statt es fuenf Minuten spaeter an einer roten Zeile
 * am Postfach zu sehen.
 *
 * Deshalb auch bewusst keine vollstaendige IMAP-Implementierung: kein
 * Literal-Handling, keine Kommando-Pipeline, kein Zustandsautomat. Drei
 * Kommandos nacheinander, jedes mit Zeitlimit.
 */
import tls from "tls";

export type ImapProbe = {
  ok: boolean;
  /** Der erkannte Gesendet-Ordner, wenn der Server ihn auszeichnet. */
  sentFolder: string | null;
  /** Klartext fuer den Nutzer, nur bei ok === false. */
  error: string | null;
};

const TIMEOUT_MS = 12_000;

/**
 * IMAP-Quoted-String. Escaped werden muessen genau zwei Zeichen (RFC 3501).
 *
 * Zeilenumbrueche im Passwort waeren ein Kommando-Ende und damit eine
 * Einschleusung; sie werden nicht escaped, sondern abgelehnt.
 */
function quote(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Zeilenumbruch in Zugangsdaten");
  return '"' + value.replace(/([\\"])/g, "\\$1") + '"';
}

/**
 * Der Ordnername aus einer LIST-Zeile.
 *
 * Format: * LIST (\HasNoChildren \Sent) "." "INBOX.Sent"
 * Der Name steht am Ende, in Anfuehrungszeichen oder nackt.
 */
function folderName(line: string): string | null {
  const quoted = line.match(/"([^"]*)"\s*$/);
  if (quoted) return quoted[1];
  const bare = line.match(/(\S+)\s*$/);
  return bare ? bare[1] : null;
}

/**
 * Anmelden, den Gesendet-Ordner suchen, abmelden.
 *
 * Wirft nie: ein falsches Passwort ist hier ein Ergebnis und keine Ausnahme,
 * und der Aufrufer soll den Grund an den Nutzer weiterreichen koennen.
 */
export function imapProbe(opts: {
  host: string;
  port: number;
  user: string;
  password: string;
}): Promise<ImapProbe> {
  return new Promise((resolve) => {
    let erledigt = false;
    const fertig = (r: ImapProbe) => {
      if (erledigt) return;
      erledigt = true;
      try {
        socket.destroy();
      } catch {}
      resolve(r);
    };

    let login: string;
    try {
      login = `a1 LOGIN ${quote(opts.user)} ${quote(opts.password)}\r\n`;
    } catch (e) {
      return resolve({ ok: false, sentFolder: null, error: (e as Error).message });
    }

    const socket = tls.connect(
      { host: opts.host, port: opts.port, servername: opts.host, timeout: TIMEOUT_MS },
      () => socket.write(login)
    );
    socket.setEncoding("utf8");
    const abbruch = setTimeout(
      () => fertig({ ok: false, sentFolder: null, error: "Zeitueberschreitung beim Verbinden" }),
      TIMEOUT_MS
    );

    let puffer = "";
    // Der Ablauf ist strikt: Begruessung, dann LOGIN, dann LIST. Ein Zaehler
    // reicht als Zustand, ein Automat waere hier mehr Bau als Nutzen.
    let schritt: "login" | "list" = "login";

    socket.on("data", (chunk: string) => {
      puffer += chunk;
      if (schritt === "login") {
        if (/^a1 OK/im.test(puffer)) {
          schritt = "list";
          puffer = "";
          socket.write('a2 LIST "" "*"\r\n');
        } else if (/^a1 (NO|BAD)/im.test(puffer)) {
          const grund = (puffer.match(/^a1 (?:NO|BAD)\s*(.*)$/im)?.[1] ?? "").trim();
          clearTimeout(abbruch);
          fertig({
            ok: false,
            sentFolder: null,
            error: grund || "Anmeldung abgelehnt. Benutzername oder Passwort stimmen nicht.",
          });
        }
        return;
      }

      if (/^a2 (OK|NO|BAD)/im.test(puffer)) {
        clearTimeout(abbruch);
        // \Sent ist die Auskunft des Servers selbst (RFC 6154) und geht jeder
        // Namensliste vor: Ordnernamen sind sprachabhaengig.
        const treffer = puffer.split(/\r?\n/).find((z) => z.includes("\\Sent"));
        let ordner = treffer ? folderName(treffer) : null;
        if (!ordner) {
          const bekannt = ["Sent", "INBOX.Sent", "Sent Items", "Gesendet", "Gesendete Objekte"];
          const zeile = puffer
            .split(/\r?\n/)
            .find((z) => z.startsWith("* LIST") && bekannt.includes(folderName(z) ?? ""));
          ordner = zeile ? folderName(zeile) : null;
        }
        try {
          socket.write("a3 LOGOUT\r\n");
        } catch {}
        fertig({ ok: true, sentFolder: ordner, error: null });
      }
    });

    socket.on("timeout", () => {
      clearTimeout(abbruch);
      fertig({ ok: false, sentFolder: null, error: "Zeitueberschreitung beim Verbinden" });
    });
    socket.on("error", (e) => {
      clearTimeout(abbruch);
      fertig({ ok: false, sentFolder: null, error: (e as Error).message });
    });
    socket.on("close", () => {
      clearTimeout(abbruch);
      fertig({ ok: false, sentFolder: null, error: "Verbindung wurde geschlossen" });
    });
  });
}

/**
 * Der IMAP-Server zu einer Adresse, soweit er sich raten laesst.
 *
 * Nur als VORBELEGUNG im Formular gedacht, nicht als Automatik: geraten wird
 * hier aus der Domain, und wer ein eigenes Postfach betreibt, traegt den
 * Server ohnehin selbst ein. Die Liste enthaelt die Anbieter, die in diesem
 * Konto tatsaechlich vorkommen.
 */
export function guessImapHost(email: string): string {
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (domain.endsWith("gmail.com") || domain.endsWith("googlemail.com")) return "imap.gmail.com";
  if (/(^|\.)(outlook|hotmail|live)\./.test("." + domain) || domain === "outlook.com")
    return "outlook.office365.com";
  if (domain.endsWith("ionos.de") || domain.endsWith("1und1.de")) return "imap.ionos.de";
  if (domain.endsWith("ionos.com") || domain.endsWith("ionos.co.uk")) return "imap.ionos.co.uk";
  // Eigene Domain bei IONOS ist der haeufigste Fall hier: die Postfaecher
  // dieses Workspace laufen auf marketing.frostbreaker.app, gehostet bei
  // IONOS. Raten heisst raten, das Feld bleibt aenderbar.
  return "imap.ionos.de";
}
