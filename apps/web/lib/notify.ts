// Founder-Benachrichtigungen (neue Anmeldung, neues Abo) per Slack Incoming
// Webhook. Best-effort: ein Slack-Ausfall darf den eigentlichen Vorgang
// (Signup, Checkout) nie beeintraechtigen, deshalb wird jeder Fehler verschluckt.
export async function sendSlackNotification(text: string): Promise<void> {
  const url = process.env.SLACK_NOTIFY_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // still schlucken — siehe Kommentar oben
  }
}
