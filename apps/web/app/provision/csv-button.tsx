"use client";

import { toCsv, type CommissionReply } from "@/lib/report/commission";
import { secondaryBtnCls } from "@/lib/ui";

/**
 * Die Liste als Datei mitnehmen.
 *
 * Im Browser gebaut und nicht ueber eine Route: die Zeilen stehen bereits
 * vollstaendig auf der Seite, und eine zweite Abfrage koennte eine andere
 * Menge liefern als die, die der Nutzer gerade ansieht. Bei einem Beleg ist
 * genau das der Fehler, den man nicht haben will.
 *
 * BOM vor der CSV: Excel liest eine UTF-8-Datei ohne Vorspann in der
 * Gebietsschema-Kodierung, und aus "Müller" wird "MÃ¼ller". Firmennamen mit
 * Umlauten sind in dieser Liste der Normalfall.
 */
export default function CsvButton({
  rows,
  label,
  filename,
}: {
  rows: CommissionReply[];
  label: string;
  filename: string;
}) {
  function download() {
    const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button onClick={download} className={secondaryBtnCls}>
      {label}
    </button>
  );
}
