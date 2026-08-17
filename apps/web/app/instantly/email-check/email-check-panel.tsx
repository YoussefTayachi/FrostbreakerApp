"use client";
import { useRef, useState } from "react";
import { useT } from "../../language-provider";
import { inputCls } from "@/lib/ui";
import HighlightedTextarea from "../../highlighted-textarea";
import QualitySidebar from "./quality-sidebar";
import type { Highlights } from "@/lib/email-quality";

// Eigenstaendiges Werkzeug fuer die drei Text-Checks, unabhaengig von einer
// Kampagne: zum Vorformulieren, bevor ueberhaupt eine Sequenz existiert, oder
// um einen fertigen Text schnell gegenzuchecken. Grosszuegiges Editor+Sidebar-
// Layout (wie hemingwayapp.com) statt des kompakten Panels aus der
// Sequenz-Karte — hier ist der Text-Check der einzige Seiteninhalt, es muss
// also nichts zusammengefaltet werden. Nutzt trotzdem denselben Baustein fuer
// das markierte Textfeld (HighlightedTextarea) wie die Kampagnen-Sequenz.
export default function EmailCheckPanel() {
  const { t } = useT();
  const E = t.emailCheck;

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [highlights, setHighlights] = useState<Highlights | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
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
          rows={20}
          highlights={highlights}
        />
      </div>
      <div className="rounded-lg border border-edge/60 bg-panel p-4 lg:sticky lg:top-6">
        <QualitySidebar subject={subject} body={body} onHighlightsChange={setHighlights} />
      </div>
    </div>
  );
}
