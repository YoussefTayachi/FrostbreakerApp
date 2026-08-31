/**
 * Spiegel des Website-Checks fuer die Weboberflaeche.
 *
 * Erhoben wird der Befund ausschliesslich im Worker
 * (apps/worker/worker/website_audit.py, Job-Typ check_website). Hier steht
 * nur, was das Frontend braucht, um die gespeicherte jsonb-Struktur aus
 * businesses.website_audit (Migration 0102) zu lesen: die Codes, ihre
 * Rangfolge und der Typ der Struktur.
 *
 * ZWEI DATEIEN, DIE SYNCHRON BLEIBEN MUESSEN
 *
 * Dasselbe Problem wie bei worker/crypto.py und lib/fernet.ts. Faellt hier
 * ein Code weg oder verschiebt sich die Rangfolge, zeigt die Oberflaeche
 * einen anderen Befund als den, der in der Mail steht, und niemandem faellt
 * es auf. Deshalb prueft website-audit.test.ts die Python-Datei mit: der Test
 * liest sie ein und vergleicht Menge UND Reihenfolge.
 *
 * KEINE TEXTE HIER. Beschriftung und Folgesatz stehen in lib/i18n/dict.ts
 * unter leads.audit.<code>.label, leads.audit.<code>.consequence und
 * leads.audit.status.<status>, weil die Oberflaeche sie in zwei Sprachen
 * zeigt. Der deutsche Prompt-Text des Workers (FACT_DE/CONSEQUENCE_DE) ist
 * davon unabhaengig: er geht ins Modell, nicht auf den Bildschirm.
 */

/**
 * Die Befund-Codes in Rangfolge, Index 0 ist der staerkste.
 *
 * Muss zeichengleich zu FINDING_CODES in
 * apps/worker/worker/website_audit.py sein, inklusive Reihenfolge. Dort steht
 * auch die Begruendung, warum die Reihenfolge genau so ist.
 */
export const AUDIT_CODES = [
  "site_unreachable",
  "ssl_broken",
  "no_https",
  "no_viewport",
  // Aus der Browser-Stufe (Migration 0107). Rang wie im Worker: was der
  // Inhaber selbst sofort sieht, steht oben.
  "mobile_overflow",
  "empty_section",
  "no_contact_route",
  "no_tel_link",
  "stale_copyright",
  "mixed_content",
  "site_builder",
  "no_og_image",
  "legacy_markup",
  "no_h1",
  "no_meta_description",
  // Die internen Mess-Codes der Browser-Stufe. Nie in einer Mail
  // (website_audit.MAILABLE_CODES schliesst sie aus), aber in
  // businesses.website_audit koennen sie stehen, und die Oberflaeche soll
  // sie zeigen statt verschweigen.
  "render_blocked",
  "slow_load",
  "js_errors",
  "text_too_small",
  "tap_targets_small",
] as const;

export type AuditCode = (typeof AUDIT_CODES)[number];

/** pending = Job laeuft, ok = GEPRUEFT (nicht "alles gut"), siehe Migration 0102. */
export type AuditStatus = "pending" | "ok" | "unreachable" | "skipped";

/**
 * Warum ein Abruf gescheitert ist, aus worker/website_fetch.classify_failure.
 *
 * Steht nur bei website_audit_status = 'unreachable' im gespeicherten Befund.
 * Die Oberflaeche zeigt den Wert nicht an: dass die Seite nicht laedt, ist die
 * Aussage, ob es am DNS-Eintrag oder am TLS-Handschlag liegt, beantwortet
 * keine Frage, die hier jemand hat. Er steht in der Struktur, damit ein
 * gespeicherter Befund von aussen nachpruefbar bleibt.
 */
export type UnreachableKind = "dns" | "refused" | "tls" | "timeout" | "http" | "other";

export type AuditFinding = {
  code: string;
  /** Kurzes woertliches Zitat von der Seite (Jahreszahl, Generator, erste http-URL), nie ein Satz. */
  evidence: string | null;
};

/**
 * Die gespeicherte Struktur. Alle Felder optional, weil sie es in der
 * Datenbank auch sind: bei 'unreachable' schreibt der Worker weder final_url
 * noch page_bytes, und der Spalten-Default ist '{}'.
 */
export type WebsiteAudit = {
  checked_url?: string;
  final_url?: string;
  findings?: AuditFinding[];
  page_bytes?: number | null;
  generator?: string | null;
  /** Nur bei 'unreachable': woran der Abruf gescheitert ist. */
  unreachable_kind?: UnreachableKind | null;
  /** Nur bei 'unreachable': wann der erste Fehlschlag beobachtet wurde. */
  unreachable_first_seen_at?: string | null;
  /**
   * Nur bei 'unreachable': wann eine zweite Beobachtung dasselbe gesagt hat.
   *
   * Null heisst "noch nicht bestaetigt", und dann steht site_unreachable auch
   * NICHT in findings. Eine einzelne gescheiterte Anfrage ist kein Befund: sie
   * kann ein Netzaussetzer sein, und daraus in einer Kaltmail "eure Seite
   * laedt gar nicht" zu machen waere eine erfundene Behauptung. Der Weg dahin
   * steht in worker/pipelines/confirm_unreachable.py.
   */
  unreachable_confirmed_at?: string | null;
};

function rank(code: string): number {
  const index = (AUDIT_CODES as readonly string[]).indexOf(code);
  return index === -1 ? AUDIT_CODES.length : index;
}

export function isAuditCode(code: string): code is AuditCode {
  return (AUDIT_CODES as readonly string[]).includes(code);
}

/**
 * Der ranghoechste Befund, oder null.
 *
 * Genau einer, weil genau einer auch in den Icebreaker geht (siehe
 * website_audit.top_finding im Worker). Die Oberflaeche soll denselben
 * zeigen, den der Empfaenger spaeter in der Mail liest.
 *
 * Unbekannte Codes werden uebergangen statt hinten einsortiert: sie kaemen
 * aus einer neueren Worker-Fassung, und fuer sie gibt es hier weder eine
 * Beschriftung in dict.ts noch eine Aussage darueber, wie schwer sie wiegen.
 * Einen Befund ohne Text anzuzeigen waere schlechter als keinen.
 */
export function topFinding(audit: WebsiteAudit | null | undefined): AuditFinding | null {
  const findings = audit?.findings;
  if (!Array.isArray(findings)) return null;
  const known = findings.filter((f) => f && typeof f.code === "string" && isAuditCode(f.code));
  if (known.length === 0) return null;
  return [...known].sort((a, b) => rank(a.code) - rank(b.code))[0];
}
