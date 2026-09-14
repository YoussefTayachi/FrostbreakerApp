"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";
import { inputCls, primaryBtnCls } from "@/lib/ui";

// Selbstregistrierung fuer neue Accounts. handle_new_user() (Migration 0024)
// legt bei jedem neuen auth.users-Eintrag automatisch einen Workspace UND
// eine Subscription mit 14 Tage Trial an (trial_ends_at = now() + 14 Tage);
// hier muss nichts weiter fuer den Trial getan werden, nur der Auth-User
// selbst muss entstehen.
//
// Supabase kann mit oder ohne Email-Bestaetigung konfiguriert sein (Projekt-
// Einstellung, nicht im Code). Deshalb werden beide Faelle behandelt: kommt
// direkt eine Session zurueck, geht's sofort ins Dashboard; kommt keine
// Session (Bestaetigung noetig), zeigen wir einen "Postfach pruefen"-Hinweis
// statt eines Fehlers.
export default function SignupPage() {
  const router = useRouter();
  const { t } = useT();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      push(t.signup.passwordTooShort, "error");
      return;
    }
    setLoading(true);
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
      },
    });
    setLoading(false);
    if (error) {
      push(t.signup.failed + error.message, "error");
      return;
    }
    if (data.session) {
      router.push("/");
      router.refresh();
      return;
    }
    // Kein Session-Objekt zurueck => Projekt verlangt E-Mail-Bestaetigung.
    setAwaitingConfirmation(true);
  }

  if (awaitingConfirmation) {
    return (
      <div className="auth-bg flex min-h-screen items-center justify-center px-4 py-10">
        <div className="fade-up w-full max-w-[26rem] text-center">
          <span className="text-[40px] font-bold leading-none tracking-[-0.045em] text-[#0EA5E9]">frostbreaker</span>
          <div className="mt-8 rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-edge/70 sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{t.signup.confirmHeading}</h1>
            <p className="mt-3 text-sm leading-relaxed text-faint">{t.signup.confirmBody(email)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="fade-up w-full max-w-[26rem]">
        <div className="mb-8 text-center">
          <span className="text-[40px] font-bold leading-none tracking-[-0.045em] text-[#0EA5E9]">frostbreaker</span>
          <p className="mt-3 text-sm text-faint">{t.signup.tagline}</p>
        </div>

        <div className="rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-edge/70 sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{t.signup.heading}</h1>
          <p className="mt-1.5 text-sm text-faint">{t.signup.trialNote}</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-soft">{t.signup.emailPlaceholder}</span>
              <input
                type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls + " h-11 w-full"}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-soft">{t.signup.passwordPlaceholder}</span>
              <input
                type="password" required minLength={8} autoComplete="new-password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls + " h-11 w-full"}
              />
            </label>
            <button disabled={loading} className={primaryBtnCls + " mt-2 h-11 w-full"}>
              {loading ? t.signup.submitting : t.signup.submit}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-faint">
          {t.signup.haveAccount}{" "}
          <a href="/login" className="font-medium text-sky-600 transition-colors hover:text-sky-500 dark:text-sky-400">
            {t.signup.loginLink}
          </a>
        </p>
      </div>
    </div>
  );
}
