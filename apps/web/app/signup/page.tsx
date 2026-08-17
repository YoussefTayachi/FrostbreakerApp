"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "../language-provider";
import { useToast } from "../toast-provider";

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
      <div className="dot-grid flex min-h-screen items-center justify-center px-4">
        <div className="fade-up w-full max-w-sm text-center">
          <span className="text-5xl font-extrabold tracking-tighter text-[#0EA5E9]">frostbreaker</span>
          <div className="mt-7 rounded-lg border border-edge/60 bg-panel p-6 shadow-sm">
            <h2 className="text-sm font-medium text-ink">{t.signup.confirmHeading}</h2>
            <p className="mt-2 text-sm leading-relaxed text-faint">{t.signup.confirmBody(email)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dot-grid flex min-h-screen items-center justify-center px-4">
      <div className="fade-up w-full max-w-sm">
        <div className="mb-7">
          <span className="text-5xl font-extrabold tracking-tighter text-[#0EA5E9]">frostbreaker</span>
          <p className="mt-1 text-xs text-faint">{t.signup.tagline}</p>
        </div>

        <div className="rounded-lg border border-edge/60 bg-panel p-6 shadow-sm">
          <h2 className="mb-1 text-sm font-medium text-ink">{t.signup.heading}</h2>
          <p className="mb-4 text-xs text-faint">{t.signup.trialNote}</p>
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email" required placeholder={t.signup.emailPlaceholder} value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-edge2 bg-field px-3 py-2.5 text-sm text-ink placeholder-mute outline-none transition-all focus:border-ink focus:ring-2 focus:ring-ink/5"
            />
            <input
              type="password" required minLength={8} placeholder={t.signup.passwordPlaceholder} value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-edge2 bg-field px-3 py-2.5 text-sm text-ink placeholder-mute outline-none transition-all focus:border-ink focus:ring-2 focus:ring-ink/5"
            />
            <button
              disabled={loading}
              className="w-full rounded-lg bg-ink py-2.5 text-sm font-medium text-surface shadow-sm transition-all hover:opacity-85 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? t.signup.submitting : t.signup.submit}
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-xs text-mute">
          {t.signup.haveAccount}{" "}
          <a href="/login" className="font-medium text-ink underline underline-offset-2">
            {t.signup.loginLink}
          </a>
        </p>
      </div>
    </div>
  );
}
