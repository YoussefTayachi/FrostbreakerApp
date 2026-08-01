import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { dict } from "@/lib/i18n/dict";
import { getLangServer } from "@/lib/i18n/lang";
import DeliverabilityPanel from "./deliverability-panel";
import HelpLink from "../../help-link";

export default async function InstantlyDeliverabilityPage() {
  const lang = await getLangServer();
  const t = dict[lang];
  const supabase = await createClient();
  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return <p className="text-faint">Kein Workspace gefunden.</p>;

  const { data: key } = await supabase
    .from("api_keys")
    .select("provider")
    .eq("workspace_id", ws.workspace.id)
    .eq("provider", "instantly")
    .maybeSingle();

  return (
    <div className="fade-up max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.deliverability.title}</h1>
        <p className="text-sm text-faint">
          {t.deliverability.subtitle}{" "}
          <HelpLink section="deliverability" label={t.guide.helpLink} />
        </p>
      </div>
      <DeliverabilityPanel hasInstantlyKey={!!key} />
    </div>
  );
}
