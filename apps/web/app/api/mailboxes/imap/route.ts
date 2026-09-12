import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { fernetEncrypt } from "@/lib/fernet";
import { imapProbe } from "@/lib/imap";

/**
 * Ein Postfach zum Mitlesen des Gesendet-Ordners verbinden (Migration 0114).
 *
 * GEPRUEFT WIRD VOR DEM SPEICHERN, NICHT DANACH.
 *
 * Der Job laeuft alle fuenf Minuten im Worker. Falsche Zugangsdaten faenden
 * ohne diese Pruefung erst dort auf, als rote Zeile an einem Postfach, das
 * der Nutzer laengst zugeklappt hat. Die Anmeldung kostet nichts und dauert
 * unter einer Sekunde, also wird sie hier gemacht -- und sie liefert
 * nebenbei den Namen des Gesendet-Ordners, den sonst jemand haette eintippen
 * muessen.
 *
 * Node-Runtime ist Pflicht: die Edge-Runtime kann keine rohen TLS-Sockets
 * oeffnen, und genau das tut lib/imap.ts.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const host = String(body?.host ?? "").trim();
  const port = Number(body?.port ?? 993);
  const username = String(body?.username ?? "").trim() || email;
  const password = String(body?.password ?? "");
  const sentFolderInput = String(body?.sentFolder ?? "").trim();

  if (!email.includes("@") || !host || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const probe = await imapProbe({ host, port, user: username, password });
  if (!probe.ok) {
    return NextResponse.json({ error: probe.error ?? "Verbindung fehlgeschlagen" }, { status: 400 });
  }

  // Die eigene Eingabe gewinnt: wer den Ordner ausdruecklich einträgt, hat
  // dafür meist einen Grund, den die automatische Erkennung nicht kennt.
  const sent_folder = sentFolderInput || probe.sentFolder || null;

  const { error } = await supabase.from("imap_mailboxes").upsert(
    {
      workspace_id: ws.workspace.id,
      email,
      host,
      port,
      username,
      password_ciphertext: fernetEncrypt(process.env.APP_ENCRYPTION_KEY!, password),
      sent_folder,
      enabled: true,
      // Zugangsdaten neu eingetragen heisst: der alte Fehler ist erledigt,
      // bis das Gegenteil gemessen ist.
      last_error: null,
    },
    { onConflict: "workspace_id,email" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, sentFolder: sent_folder });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  // Die bereits uebernommenen Mails bleiben stehen. Sie sind Teil des
  // Verlaufs eines Leads; sie mit den Zugangsdaten zu loeschen waere, als
  // haette das Gespraech nie stattgefunden.
  const { error } = await supabase
    .from("imap_mailboxes")
    .delete()
    .eq("workspace_id", ws.workspace.id)
    .eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
