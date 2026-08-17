"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cardCls, inputCls, primaryBtnCls, secondaryBtnCls } from "@/lib/ui";
import { useT } from "../../language-provider";
import { useToast } from "../../toast-provider";
import { useWorkspace } from "../../workspace-provider";
import AutomationRules from "../automation-rules";

/**
 * Alles, was von allein passiert, sobald ein Lead sich meldet oder eben nicht.
 *
 * Die drei Bloecke gehoeren zusammen, weil sie denselben Moment betreffen:
 * die Regeln legen den naechsten Schritt an, die Benachrichtigung holt dich
 * dazu, und der Assistent schreibt den Entwurf. Auf der alten
 * Sammel-Einstellungsseite standen sie zwischen API-Schluesseln und
 * Farbwerten und waren dort praktisch unsichtbar.
 */
export default function AutomationsPage() {
  const { t } = useT();
  const { push } = useToast();
  const { workspaceId } = useWorkspace();

  const [replyNotifyEmail, setReplyNotifyEmail] = useState("");
  const [replyNotifySaving, setReplyNotifySaving] = useState(false);
  const [replyTest, setReplyTest] = useState<"idle" | "sending">("idle");
  const [calendarLink, setCalendarLink] = useState("");
  const [senderName, setSenderName] = useState("");
  const [assistantSaving, setAssistantSaving] = useState(false);

  useEffect(() => {
    createClient()
      .from("workspaces")
      .select("reply_notify_email, calendar_link, reply_sender_name")
      .eq("id", workspaceId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setReplyNotifyEmail(data.reply_notify_email ?? "");
        setCalendarLink(data.calendar_link ?? "");
        setSenderName(data.reply_sender_name ?? "");
      });
  }, [workspaceId]);

  /** Leeres Feld heisst bewusst "aus": lieber keine Benachrichtigung als eine
   *  an eine Adresse, die niemand mehr liest. */
  async function saveReplyNotify() {
    const wert = replyNotifyEmail.trim();
    if (wert && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(wert)) {
      push(t.replyNotify.invalid, "error");
      return;
    }
    setReplyNotifySaving(true);
    const { error } = await createClient()
      .from("workspaces")
      .update({ reply_notify_email: wert || null })
      .eq("id", workspaceId);
    setReplyNotifySaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(wert ? t.replyNotify.saved : t.replyNotify.disabled, "success");
  }

  /** Schickt eine echte Mail an die gespeicherte Adresse. Der Fehlertext von
   *  Resend wird woertlich angezeigt — "Domain nicht verifiziert" und
   *  "Schluessel fehlt" sehen sonst identisch aus. */
  async function testReplyNotify() {
    setReplyTest("sending");
    const res = await fetch("/api/notify-test", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setReplyTest("idle");
    if (body?.ok) {
      push(t.replyNotify.testSent(body.to as string), "success");
      return;
    }
    push(
      body?.reason === "no_address"
        ? t.replyNotify.testNoAddress
        : t.replyNotify.testFailed + (body?.reason ?? ""),
      "error"
    );
  }

  /**
   * Was der Antwort-Assistent im Posteingang mitbekommt (Migration 0073).
   *
   * Beide Felder duerfen leer bleiben. Der Unterschied ist nicht "mit oder
   * ohne Komfort", sondern was das Modell tut, wenn es die Angabe nicht hat:
   * ohne Terminlink wird ihm ausdruecklich verboten, einen zu erfinden --
   * sonst steht eine plausible, tote Calendly-Adresse in einer echten
   * Geschaeftsmail, und der Fehler faellt erst dem Empfaenger auf.
   */
  async function saveAssistant() {
    setAssistantSaving(true);
    const { error } = await createClient()
      .from("workspaces")
      .update({
        calendar_link: calendarLink.trim() || null,
        reply_sender_name: senderName.trim() || null,
      })
      .eq("id", workspaceId);
    setAssistantSaving(false);
    if (error) {
      push(t.common.error + error.message, "error");
      return;
    }
    push(t.common.savedOk, "success");
  }

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.automations.heading}</h1>
        <p className="text-sm text-faint">{t.automations.description}</p>
      </div>

      <div className={cardCls}>
        <AutomationRules />
      </div>

      <div className={cardCls}>
        <h2 className="font-medium text-ink">{t.replyNotify.heading}</h2>
        <p className="mb-4 mt-1 text-sm text-faint">{t.replyNotify.description}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1.5 block text-xs font-medium text-faint">{t.replyNotify.label}</label>
            <input
              type="email"
              value={replyNotifyEmail}
              onChange={(e) => setReplyNotifyEmail(e.target.value)}
              placeholder={t.replyNotify.placeholder}
              className={inputCls + " w-full"}
            />
          </div>
          <button onClick={saveReplyNotify} disabled={replyNotifySaving} className={secondaryBtnCls}>
            {replyNotifySaving ? t.common.saving : t.common.save}
          </button>
          <button onClick={testReplyNotify} disabled={replyTest === "sending"} className={secondaryBtnCls}>
            {replyTest === "sending" ? t.replyNotify.testSending : t.replyNotify.test}
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-mute">{t.replyNotify.hint}</p>
      </div>

      {/* Direkt unter der Benachrichtigung: beides betrifft den Moment, in dem
          jemand geantwortet hat — das eine holt dich dazu, das andere
          schreibt den Entwurf. */}
      <div className={cardCls}>
        <h2 className="font-medium text-ink">{t.replyAssistant.title}</h2>
        <p className="mt-0.5 text-sm text-faint">{t.replyAssistant.subtitle}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-faint">{t.replyAssistant.calendarLabel}</label>
            <input
              value={calendarLink}
              onChange={(e) => setCalendarLink(e.target.value)}
              placeholder={t.replyAssistant.calendarPlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-faint">{t.replyAssistant.senderLabel}</label>
            <input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder={t.replyAssistant.senderPlaceholder}
              className={inputCls + " w-full"}
            />
          </div>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-mute">{t.replyAssistant.hint}</p>

        <button onClick={saveAssistant} disabled={assistantSaving} className={primaryBtnCls + " mt-3"}>
          {assistantSaving ? t.common.saving : t.common.save}
        </button>
      </div>
    </div>
  );
}
