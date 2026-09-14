"use client";
import { useState } from "react";

export function faviconUrl(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = website.replace(/^https?:\/\//, "").split("/")[0];
    if (!host) return null;
    return "https://www.google.com/s2/favicons?domain=" + host + "&sz=64";
  } catch {
    return null;
  }
}

/** Firmen-Favicon mit Initialen-Fallback; lag vorher lokal in leads-table.tsx,
 *  wird inzwischen auch von der Inbox genutzt. */
export default function CompanyLogo({
  name,
  website,
  size = 24,
}: {
  name: string;
  website: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = faviconUrl(website);
  const px = size + "px";
  if (!url || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-md bg-chip text-2xs font-semibold text-soft ring-1 ring-inset ring-edge/70"
        style={{ width: px, height: px }}
      >
        {(name || "?").slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      // Haarlinie innen statt aussen: ein Favicon mit weissem Grund
      // verschwimmt sonst auf der weissen Karte, und ring-inset aendert die
      // Abmessungen nicht.
      className="shrink-0 rounded-md bg-chip object-contain ring-1 ring-inset ring-edge/70"
      style={{ width: px, height: px }}
      onError={() => setFailed(true)}
    />
  );
}
