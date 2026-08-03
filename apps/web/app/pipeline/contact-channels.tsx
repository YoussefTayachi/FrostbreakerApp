"use client";
import { IconMail, IconPhone, IconLinkedIn } from "../icons";
import { useT } from "../language-provider";
import type { PipelineRow } from "@/lib/crm/pipeline";

/**
 * Die Kontaktwege einer Zeile als direkte Aktionen.
 *
 * Der Punkt der ganzen Umbaus: bisher musste man einen Lead in der Pipeline
 * anklicken, den Drawer lesen, die Adresse markieren und woanders einfuegen.
 * Jetzt sitzt der Weg dort, wo der Lead steht.
 *
 * mailto: und tel: statt eigener Oberflaeche -- geschrieben und telefoniert
 * wird im Programm des Nutzers, genau wie unter /calls ("Gewaehlt wird mit dem
 * eigenen Telefon"). Die App bereitet vor und protokolliert.
 *
 * Nicht vorhandene Wege werden ausgegraut statt weggelassen: eine Zeile ohne
 * Telefonsymbol und eine mit deaktiviertem Telefonsymbol sehen sonst gleich
 * aus, obwohl das eine "keine Nummer" und das andere "Spalte gibt es hier
 * nicht" bedeutet. Ausgegraut beantwortet die Frage "kann ich den anrufen"
 * ohne Klick.
 */
export default function ContactChannels({
  row,
  onLogged,
}: {
  row: PipelineRow;
  /** Wird nach einer Aktion aufgerufen, die eine Kontaktaufnahme darstellt. */
  onLogged?: (channel: "email" | "phone" | "linkedin") => void;
}) {
  const { t } = useT();
  const P = t.pipeline;

  const base =
    "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors";
  const active =
    base + " border-edge2 text-soft hover:border-sky-500/60 hover:text-sky-600 dark:hover:text-sky-400";
  const disabled = base + " cursor-not-allowed border-edge2/50 text-mute/40";

  return (
    <div className="flex items-center gap-1">
      {row.email ? (
        <a
          href={`mailto:${row.email}`}
          onClick={(e) => {
            e.stopPropagation();
            onLogged?.("email");
          }}
          title={row.email}
          className={active}
        >
          <IconMail className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className={disabled} title={P.noEmail}>
          <IconMail className="h-3.5 w-3.5" />
        </span>
      )}

      {row.phone ? (
        <a
          href={`tel:${row.phone.replace(/[^\d+]/g, "")}`}
          onClick={(e) => {
            e.stopPropagation();
            onLogged?.("phone");
          }}
          // Zentrale oder Durchwahl steht dran: wer eine Zentrale anruft,
          // meldet sich anders. Bei Leads aus Google Maps ist die Zentrale
          // sogar der Normalfall -- Places liefert die Betriebsnummer, keine
          // Durchwahl.
          title={row.phone_is_company ? P.phoneCompany(row.phone) : P.phoneDirect(row.phone)}
          className={
            active + (row.phone_is_company ? " border-dashed" : "")
          }
        >
          <IconPhone className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className={disabled} title={P.noPhone}>
          <IconPhone className="h-3.5 w-3.5" />
        </span>
      )}

      {row.linkedin ? (
        <a
          href={row.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation();
            onLogged?.("linkedin");
          }}
          title={P.openLinkedIn}
          className={active}
        >
          <IconLinkedIn className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className={disabled} title={P.noLinkedIn}>
          <IconLinkedIn className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}
