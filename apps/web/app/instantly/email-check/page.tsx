import { dict } from "@/lib/i18n/dict";
import { getLangServer } from "@/lib/i18n/lang";
import EmailCheckPanel from "./email-check-panel";

export default async function EmailCheckPage() {
  const lang = await getLangServer();
  const t = dict[lang];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.emailCheck.title}</h1>
        <p className="mt-1 text-sm text-faint">{t.emailCheck.subtitle}</p>
      </div>
      <EmailCheckPanel />
    </div>
  );
}
