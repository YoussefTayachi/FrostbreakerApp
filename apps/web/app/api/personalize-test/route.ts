import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace/server";
import { getApiKey } from "@/lib/api-keys";
import { validateIcebreaker, wordCount } from "@/lib/personalization-defaults";
import { extractOutputText } from "@/lib/openai";

const MAX_SITE_CHARS = 6000;

function stripHtml(html: string): string {
  // Leichtgewichtige Vorschau-Extraktion (kein Aequivalent zu trafilatura im Worker) --
  // ausreichend fuer den Live-Test, nicht fuer die Produktions-Pipeline.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function callModel(
  apiKey: string,
  systemPrompt: string,
  userContent: string
): Promise<{ text?: string; error?: string }> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    return { error: "OpenAI-Fehler: " + errBody.slice(0, 300) };
  }
  return { text: extractOutputText(await res.json()) };
}

async function fetchWebsiteText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FrostbreakerBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html);
    return text.length > 100 ? text.slice(0, MAX_SITE_CHARS) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const businessId: string = body.business_id;
  const systemPrompt: string = (body.system_prompt ?? "").trim();
  const source: string = body.source ?? "company_summary";
  const maxWords: number = Number(body.max_words) || 22;
  const bannedWords: string[] = Array.isArray(body.banned_words) ? body.banned_words : [];
  const lang: "de" | "en" = body.lang === "en" ? "en" : "de";

  if (!businessId || !systemPrompt) {
    return NextResponse.json({ error: "business_id und system_prompt sind Pflicht" }, { status: 400 });
  }

  const ws = await getCurrentWorkspace(supabase);
  if (!ws) return NextResponse.json({ error: "Kein Workspace" }, { status: 400 });

  const { data: biz } = await supabase
    .from("businesses")
    .select("id, name, company_summary, website")
    .eq("id", businessId)
    .eq("workspace_id", ws.workspace.id)
    .single();
  if (!biz) return NextResponse.json({ error: "Firma nicht gefunden" }, { status: 404 });

  let context = "";
  if (source === "company_summary" || source === "both") {
    if (biz.company_summary) context += "Firmenbeschreibung:\n" + biz.company_summary;
  }
  if (source === "website_text" || source === "both") {
    const siteText = biz.website ? await fetchWebsiteText(biz.website) : null;
    if (siteText) context += (context ? "\n\n" : "") + "Website-Text:\n" + siteText;
  }
  if (!context) {
    return NextResponse.json(
      { error: "Für diese Firma sind keine Daten für die gewählte Quelle verfügbar." },
      { status: 400 }
    );
  }

  const apiKey = await getApiKey(supabase, ws.workspace.id, "openai");
  if (!apiKey) {
    return NextResponse.json({ error: "Kein OpenAI-Key in den Einstellungen hinterlegt." }, { status: 400 });
  }

  const userContent = `Unternehmen: ${biz.name}\n\n${context}`;
  const first = await callModel(apiKey, systemPrompt, userContent);
  if (first.error) return NextResponse.json({ error: first.error }, { status: 502 });

  let text = first.text ?? "";
  let problems = validateIcebreaker(text, maxWords, bannedWords, lang);
  let corrected = false;

  // Spiegelt exakt den Korrektur-Versuch aus worker/pipelines/personalize.py
  // (generate() mit correction-Parameter): sonst zeigt der Live-Test nur den
  // unkorrigierten Rohentwurf und suggeriert, ein erkannter Regelverstoss
  // (z.B. verbotenes Wort) wuerde bei echten Leads einfach so gespeichert --
  // dabei greift dort immer dieser zweite Versuch.
  if (problems.length > 0) {
    const correctionNote =
      lang === "en"
        ? `Your last attempt violated the following rule(s): ${problems.join("; ")}. Please correct it and answer again with only the text itself.`
        : `Dein letzter Versuch hat folgende Regel(n) verletzt: ${problems.join("; ")}. Bitte korrigiere und antworte erneut nur mit dem Text selbst.`;
    const retry = await callModel(apiKey, systemPrompt, userContent + "\n\n" + correctionNote);
    if (retry.text) {
      text = retry.text;
      problems = validateIcebreaker(text, maxWords, bannedWords, lang);
      corrected = true;
    }
  }

  return NextResponse.json({ text, problems, source, wordCount: wordCount(text), corrected });
}
