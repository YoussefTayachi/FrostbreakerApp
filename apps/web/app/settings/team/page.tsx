"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cardCls, dangerBtnCls, inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";

/**
 * Team-Zugaenge je Workspace.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WARUM ES DIESE SEITE GIBT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Bis Migration 0081 war workspaces.owner_id = auth.uid() die einzige
 * Zugriffsregel der App. Ein Workspace gehoerte genau einem Konto -- fuer
 * eine Agentur mit einem Team hiess das in der Praxis: ein geteiltes
 * Passwort. Kein Nachvollziehen, wer was getan hat, kein Entzug beim
 * Ausscheiden, keine Abstufung fuer Freie.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DREI ENTSCHEIDUNGEN, DIE MAN SONST FUER WILLKUER HALTEN KOENNTE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. EINLADEN OHNE TOKEN UND OHNE MAIL-VERSAND
 *
 * Eine Einladung ist eine Zeile in workspace_members mit user_id = null.
 * Meldet sich jemand mit dieser Adresse an, haengt handle_new_user() die
 * Zeile an das neue Konto (siehe 0081). Kein Token, kein Ablaufdatum, keine
 * Zustellbarkeit, die schiefgehen kann.
 *
 * Der Preis: die eingeladene Person muss selbst erfahren, dass sie
 * eingeladen wurde. Deshalb steht neben jeder offenen Einladung, was zu tun
 * ist -- und nicht ein "Einladung versendet", das nirgends ankommt.
 *
 * 2. ZWEI ROLLEN, NICHT FUENF
 *
 * Admin darf einladen, Rollen aendern, entfernen und die API-Schluessel
 * sehen. Mitglied darf alles Operative. Eine Rollenmatrix, die niemand
 * erklaeren kann, wird auf Verdacht hoch vergeben -- und dann ist sie keine.
 *
 * 3. DIE SEITE VERSTECKT NICHTS VOR MITGLIEDERN
 *
 * Auch wer kein Admin ist, sieht die Liste. Wer nicht weiss, wer mitliest,
 * arbeitet anders. Nur die Knoepfe fehlen, und daneben steht, warum.
 *
 * Die Regeln stehen nicht hier, sondern in der Datenbank (Policies plus
 * trg_guard_last_admin). Diese Seite blendet nur aus, was ohnehin abgelehnt
 * wuerde -- ein Formular, das der Server verweigert, ist kein Schutz.
 */

type Member = {
  id: string;
  user_id: string | null;
  email: string;
  role: "admin" | "member";
  created_at: string;
  accepted_at: string | null;
};

export default function TeamPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();
  const T = t.team;

  const [members, setMembers] = useState<Member[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: userData }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from("workspace_members")
        .select("id, user_id, email, role, created_at, accepted_at")
        .eq("workspace_id", workspaceId)
        .order("role", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    setMeId(userData.user?.id ?? null);
    if (error) push(t.common.error + error.message, "error");
    setMembers((data as Member[]) ?? []);
    setLoading(false);
  }, [workspaceId, push, t.common.error]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Ob ich hier Admin bin, steht in der Liste selbst -- eine zweite Abfrage
  // (is_workspace_admin) waere ein zweiter Rundgang fuer dieselbe Auskunft.
  const isAdmin = members.some((m) => m.user_id === meId && m.role === "admin");
  const adminCount = members.filter((m) => m.role === "admin").length;

  async function invite() {
    const addr = email.trim().toLowerCase();
    if (!addr || busy) return;
    if (!addr.includes("@")) {
      push(T.invalidEmail, "error");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("workspace_members").insert({
      workspace_id: workspaceId,
      email: addr,
      role,
      invited_by: user?.id ?? null,
    });
    setBusy(false);
    if (error) {
      // 23505 = unique_violation: die Adresse steht schon in diesem
      // Workspace. Die Rohmeldung ("duplicate key value violates unique
      // constraint workspace_members_email_uniq") hilft niemandem.
      push(error.code === "23505" ? T.alreadyMember : t.common.error + error.message, "error");
      return;
    }
    setEmail("");
    push(T.invited, "success");
    void load();
  }

  async function changeRole(m: Member, next: "admin" | "member") {
    setBusy(true);
    const { error } = await createClient()
      .from("workspace_members")
      .update({ role: next })
      .eq("id", m.id);
    setBusy(false);
    if (error) {
      push(error.message.includes("letzte Admin") ? T.lastAdmin : t.common.error + error.message, "error");
      return;
    }
    void load();
  }

  async function remove(m: Member) {
    if (!confirm(T.removeConfirm.replace("{email}", m.email))) return;
    setBusy(true);
    const { error } = await createClient().from("workspace_members").delete().eq("id", m.id);
    setBusy(false);
    if (error) {
      push(error.message.includes("letzte Admin") ? T.lastAdmin : t.common.error + error.message, "error");
      return;
    }
    push(T.removed, "success");
    void load();
  }

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{T.title}</h1>
        <p className="text-sm text-faint">{T.subtitle}</p>
      </div>

      {isAdmin && (
        <div className={cardCls}>
          <h2 className="text-sm font-semibold text-ink">{T.inviteTitle}</h2>
          <p className="mt-1 text-xs leading-relaxed text-faint">{T.inviteHint}</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && invite()}
              placeholder={T.emailPlaceholder}
              className={inputCls + " flex-1"}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
              className={inputCls + " sm:w-40"}
            >
              <option value="member">{T.roleMember}</option>
              <option value="admin">{T.roleAdmin}</option>
            </select>
            <button onClick={invite} disabled={busy} className={primaryBtnCls}>
              {T.inviteButton}
            </button>
          </div>
        </div>
      )}

      <div className={cardCls}>
        <h2 className="text-sm font-semibold text-ink">{T.listTitle}</h2>
        {loading ? (
          <p className="mt-4 text-sm text-faint">{T.loading}</p>
        ) : (
          <ul className="mt-4 divide-y divide-edge/60">
            {members.map((m) => {
              const isMe = m.user_id === meId;
              // Der letzte Admin bekommt gar keine Knoepfe: die Datenbank
              // lehnt beides ohnehin ab, und ein Knopf, der immer eine
              // Fehlermeldung erzeugt, ist eine Falle.
              const lastAdmin = m.role === "admin" && adminCount === 1;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {m.email}
                      {isMe && <span className="ml-2 text-xs text-faint">{T.you}</span>}
                    </p>
                    {!m.accepted_at && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{T.pending}</p>}
                  </div>

                  {isAdmin && !lastAdmin ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as "admin" | "member")}
                      disabled={busy}
                      className={inputCls + " w-32 py-1 text-xs"}
                    >
                      <option value="member">{T.roleMember}</option>
                      <option value="admin">{T.roleAdmin}</option>
                    </select>
                  ) : (
                    <span className="rounded-full border border-edge2 bg-chip px-2.5 py-1 text-xs text-soft">
                      {m.role === "admin" ? T.roleAdmin : T.roleMember}
                    </span>
                  )}

                  {isAdmin && !lastAdmin && (
                    <button onClick={() => remove(m)} disabled={busy} className={dangerBtnCls + " py-1 text-xs"}>
                      {T.remove}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!isAdmin && !loading && <p className="mt-4 text-xs leading-relaxed text-faint">{T.memberNote}</p>}
        {isAdmin && adminCount === 1 && !loading && (
          <p className="mt-4 text-xs leading-relaxed text-faint">{T.lastAdminNote}</p>
        )}
      </div>

      <div className={cardCls}>
        <h2 className="text-sm font-semibold text-ink">{T.rightsTitle}</h2>
        <dl className="mt-3 space-y-3 text-xs leading-relaxed">
          <div>
            <dt className="font-medium text-ink">{T.roleAdmin}</dt>
            <dd className="text-faint">{T.adminRights}</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">{T.roleMember}</dt>
            <dd className="text-faint">{T.memberRights}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
