import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getLangServer } from "@/lib/i18n/lang";
import { dict } from "@/lib/i18n/dict";
import CallList, { type CallTask } from "./call-list";
import HelpLink from "../help-link";

/**
 * Die Anrufliste: alle offenen, terminierten Anrufe ueber ALLE Leads hinweg.
 *
 * Vorher gab es die Daten schon (activities mit type='call' und due_at,
 * Migration 0033 -- inklusive des partiellen Index activities_open_due_idx, der
 * genau fuer diese Abfrage angelegt wurde), aber keine Ansicht dafuer: einen
 * geplanten Rueckruf sah man nur, wenn man zufaellig genau diesen Kontakt im
 * Lead-Drawer aufschlug. Fuer den taeglichen Ablauf braucht es die Gegenrichtung
 * -- "wen rufe ich heute an" statt "was war mit dieser Firma".
 *
 * Telefoniert wird bewusst NICHT in der App: der Nutzer waehlt mit seinem
 * Firmentelefon. Diese Seite liefert nur die Vorbereitung (Nummer,
 * Firmenzusammenfassung, letzte Notiz) und nimmt das Ergebnis auf.
 */
export default async function CallsPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;
  const workspaceId = ws.workspace.id;

  // Alle offenen, terminierten Aktivitaeten -- genau der Zuschnitt des
  // partiellen Index activities_open_due_idx.
  //
  // Bewusst NICHT auf type='call' eingeschraenkt, obwohl der Anruf der
  // Hauptfall ist: die Dashboard-Kachel "Aufgaben faellig" zaehlt alle Typen,
  // und eine Liste, die einen faelligen Termin stillschweigend verschweigt,
  // waere eine Falle -- der Nutzer plant ihn und findet ihn nirgends wieder.
  // Der Typ wird pro Zeile ausgewiesen.
  //
  // Der Kontakt bringt die Firma mit (fuer Nummer und Zusammenfassung); ist die
  // Aktivitaet direkt an einer Firma ohne Kontakt geplant, liefert der zweite
  // Join dieselben Felder.
  const { data } = await supabase
    .from("activities")
    .select(
      "id, type, subject, note, due_at, contact_id, business_id, " +
        "contacts(id, full_name, title, phone, email, outreach_status, business_id, " +
        "businesses(name, website, phone_national, company_summary)), " +
        "businesses(name, website, phone_national, company_summary)"
    )
    .eq("workspace_id", workspaceId)
    .is("completed_at", null)
    .not("due_at", "is", null)
    .order("due_at", { ascending: true })
    .limit(500);

  // Cast an der Vertrauensgrenze wie in /leads und /inbox: der Supabase-Client
  // ist untypisiert und leitet 1:1-Relationen bei verschachtelten Selects als
  // Array her.
  const tasks = (data ?? []) as unknown as CallTask[];

  return (
    <div className="fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.calls.title}</h1>
        <p className="text-sm text-faint">
          {t.calls.subtitle}{" "}
          <HelpLink section="calls" label={t.guide.helpLink} />
        </p>
      </div>
      <CallList tasks={tasks} />
    </div>
  );
}
