// Transaktionsmails ueber Resend.
//
// Die App verschickt selbst keine Kampagnen -- das bleibt Instantly. Hier geht
// es ausschliesslich um Benachrichtigungen an den Betreiber, aktuell "ein Lead
// hat geantwortet".
//
// Best-effort wie sendSlackNotification: schlaegt der Versand fehl, darf das
// den Vorgang, der ihn ausgeloest hat (den Inbox-Sync), nie mitreissen. Eine
// verpasste Benachrichtigung ist aergerlich, ein abgebrochener Sync verliert
// Antworten.

const RESEND_URL = "https://api.resend.com/emails";

/** Absender. Muss eine in Resend verifizierte Domain sein, sonst lehnt Resend
 *  den Versand ab. Ueber die Env-Variable ueberschreibbar, damit ein Wechsel
 *  der Domain kein Deploy des Codes braucht. */
function fromAddress(): string {
  return process.env.RESEND_FROM ?? "Frostbreaker <notifications@frostbreaker.app>";
}

export type SendResult = { ok: true } | { ok: false; reason: string };

export async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  // Kein Schluessel hinterlegt ist kein Fehler, sondern "Funktion nicht
  // eingerichtet" -- der Aufrufer soll das unterscheiden koennen.
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
