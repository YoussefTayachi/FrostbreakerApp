// Transaktionsmails ueber Resend.
//
// Die App verschickt selbst keine Kampagnen — das bleibt Instantly. Hier geht
// es ausschliesslich um Benachrichtigungen an den Betreiber, aktuell "ein Lead
// hat geantwortet".
//
// Best-effort wie sendSlackNotification: schlaegt der Versand fehl, darf das
// den Vorgang, der ihn ausgeloest hat (den Inbox-Sync), nie mitreissen. Eine
// verpasste Benachrichtigung ist aergerlich, ein abgebrochener Sync verliert
// Antworten.

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Absender.
 *
 * Voreingestellt ist Resends geteilte Testadresse, weil sie OHNE verifizierte
 * Domain funktioniert — im Konto ist aktuell keine hinterlegt, und mit einem
 * eigenen Absender wuerde Resend jeden Versand ablehnen.
 *
 * Der Preis dafuer: onboarding@resend.dev darf ausschliesslich an die Adresse
 * zustellen, mit der das Resend-Konto angelegt wurde. Fuer diese
 * Benachrichtigung ist das kein Problem — sie geht ohnehin an den Betreiber
 * selbst. Sobald sie an ein Team- oder Kundenpostfach gehen soll, muss die
 * eigene Domain in Resend verifiziert und RESEND_FROM gesetzt werden; deshalb
 * ist der Wert ueber die Umgebung ueberschreibbar und braucht keinen Deploy.
 */
function fromAddress(): string {
  return process.env.RESEND_FROM ?? "Frostbreaker <onboarding@resend.dev>";
}

export type SendResult = { ok: true } | { ok: false; reason: string };

/**
 * Der Schluessel aus der Umgebung.
 *
 * Auch "Resend_API_KEY" wird akzeptiert: in Vercel ist er unter genau dieser
 * Schreibweise angelegt, und process.env unterscheidet Gross- und
 * Kleinschreibung. Ein Umbenennen haette bedeutet, den Wert neu einzutippen --
 * dafuer ist der Fehler zu klein und der Schluessel zu heikel. Der Kommentar
 * steht hier, damit die zweite Zeile spaeter nicht als ueberfluessig
 * weggeraeumt wird.
 */
function apiKey(): string | undefined {
  return process.env.RESEND_API_KEY ?? process.env.Resend_API_KEY;
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<SendResult> {
  const key = apiKey();
  // Kein Schluessel hinterlegt ist kein Fehler, sondern "Funktion nicht
  // eingerichtet" — der Aufrufer soll das unterscheiden koennen.
  if (!key) return { ok: false, reason: "no_api_key" };
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress(), to: [to], subject, text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      // Resends Fehlertext mitnehmen: "Domain nicht verifiziert" ist die mit
      // Abstand haeufigste Ursache und laesst sich sonst nicht von einem
      // falschen Schluessel unterscheiden.
      const body = await res.text();
      return { ok: false, reason: `http_${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
