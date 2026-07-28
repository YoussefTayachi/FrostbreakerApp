"use client";
import { useRef, useState } from "react";
import { useT } from "../../language-provider";
import { inputCls } from "@/lib/ui";
import EmailQualityPanel from "../campaigns/email-quality-panel";
import HighlightedTextarea from "../campaigns/highlighted-textarea";
import type { Highlights } from "@/lib/email-quality";

// Eigenstaendiges Werkzeug fuer die drei Text-Checks, unabhaengig von einer
// Kampagne: zum Vorformulieren, bevor ueberhaupt eine Sequenz existiert, oder
// um einen fertigen Text schnell gegenzuchecken. Nutzt dieselben Bausteine
// wie die Kampagnen-Sequenz (HighlightedTextarea, EmailQualityPanel) -- die
// Pruefungen selbst kennen keine Kampagne, sie nehmen einfach subject/body.
export default function EmailCheckPanel() {
  const { t } = useT();
  const E = t.emailCheck;

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [highlights, setHighlights] = useState<Highlights | null>(null);

  return (
    <div className="space-y-3">
      <input
        placeholder={E.subjectPlaceholder}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className={inputCls + " w-full"}
      />
      <HighlightedTextarea
        textareaRef={bodyRef}
        placeholder={E.bodyPlaceholder}
        value={body}
        onChange={setBody}
        rows={10}
        highlights={highlights}
      />
      <EmailQualityPanel subject={subject} body={body} onHighlightsChange={setHighlights} defaultExpanded />
    </div>
  );
}
