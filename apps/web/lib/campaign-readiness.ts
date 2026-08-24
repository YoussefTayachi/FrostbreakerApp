/**
 * Der Torwart: was gegen den Start dieser Kampagne spricht.
 *
 * WOFUER ES DAS GIBT
 *
 * Eine Kaltakquise-Kampagne scheitert fast nie daran, dass der Text schlecht
 * ist. Sie scheitert daran, dass sie gar nicht ankommt: fehlende
 * SPF/DKIM-Eintraege, ungeprueft eingesammelte Adressen, eine Domain, die
 * sich schon eine Bounce-Quote eingefangen hat. Das merkt man erst Wochen
 * spaeter, und dann ist die Absender-Domain verbrannt und nicht mehr zu
 * retten.
 *
 * Gemessen an den eigenen Daten am 2026-08-04: eine Kampagne hatte 6 Bounces
 * auf 30 Mails (20 %), 1936 von 2625 Kontakten hatten nie eine
 * Adresspruefung gesehen, und 705 Icebreaker verstiessen gegen die eigenen
 * Vorgaben. Nichts davon war irgendwo sichtbar, bevor gesendet wurde.
 *
 * DIE TRENNLINIE ZWISCHEN BLOCKER UND WARNUNG
 *
 * Ein Blocker ist etwas, das mit Sicherheit schiefgeht und dessen Schaden
 * bleibt: ohne SPF/DKIM landet die Mail im Spam, und jede weitere Mail von
 * dieser Domain danach ebenso. Eine Warnung ist etwas, das schlechter macht,
 * aber weder sicher noch dauerhaft ist: eine unverifizierte Adresse KANN
 * bouncen, muss aber nicht.
 *
 * Diese Trennung ist die ganze Glaubwuerdigkeit der Sache. Wenn ein Blocker
 * auch mal nur eine Meinung ist, klickt man ihn beim dritten Mal weg und
 * beim vierten Mal auch den echten. Deshalb im Zweifel Warnung.
 *
 * Reine Logik, damit die Schwellen pruefbar sind und nicht in einer
 * Komponente verstreut liegen. Die Fakten sammelt api/campaigns/readiness.
 */
import { wordCount } from "./personalization-defaults";

export type Severity = "blocker" | "warning" | "ok";

export type CheckId =
  | "leads"
  | "spf"
  | "dkim"
  | "dmarc"
  | "bounce"
  | "verification"
  | "icebreakerMissing"
  | "icebreakerFailing"
  | "websiteFindingMissing"
  | "sequence"
  | "firstMailLength"
  | "firstMailLink";

export type ReadinessCheck = {
  id: CheckId;
  severity: Severity;
  /** Die Zahlen zum Satz. Die Oberflaeche formuliert, diese Datei rechnet. */
  values: Record<string, number | string>;
};

/** Zustellungs-Nachweise einer Absender-Domain, wie lib/deliverability.ts sie liefert. */
export type DomainAuth = { domain: string; spf: boolean; dkim: boolean; dmarc: boolean };

export type StepFacts = { words: number; hasLink: boolean };

export type ReadinessFacts = {
  /** Nach denselben Filtern wie beim tatsaechlichen Anlegen (ungueltig, gesperrt, kein Interesse). */
  sendableLeads: number;
  /** Adressen ohne jede Pruefung, weder als gueltig noch als ungueltig bekannt. */
  unverifiedLeads: number;
  /** Sendbare Leads, deren Firma gar keinen Aufhaenger hat. */
  leadsWithoutIcebreaker: number;
  /** Sendbare Leads, deren Aufhaenger gegen die geltenden Vorgaben verstoesst. */
  leadsWithFailingIcebreaker: number;
  /**
   * Benutzt die Sequenz die Variable {{websiteFinding}}?
   *
   * Ohne sie ist ein fehlender Befund belanglos, und die Pruefung darunter
   * schweigt. Eine Warnung, die auch dann erscheint, wenn sie niemanden
   * betrifft, ist genau die Sorte Rot, die man beim dritten Mal wegklickt.
   */
  sequenceUsesWebsiteFinding: boolean;
  /**
   * Leads OHNE Website-Befund, die deshalb zurueckgehalten werden.
   *
   * Nicht in sendableLeads enthalten: die Zahl dort ist die, die tatsaechlich
   * hochgeht (siehe splitByWebsiteFinding in lib/instantly/create-campaign.ts).
   */
  leadsWithoutWebsiteFinding: number;
  domains: DomainAuth[];
  /** Versand und Bounces des Workspaces ueber alle bisherigen Kampagnen. */
  sentSoFar: number;
  bouncedSoFar: number;
  steps: StepFacts[];
};

/**
 * Ab 5 % Bounce greifen die Schutzmechanismen der Empfaenger-Provider, und
 * die Domain traegt den Ruf dauerhaft mit. Instantly selbst schaltet eine
 * Kampagne bei anhaltend hoher Quote in "Bounce Protect" (Statuscode -2).
 * 3 % ist die Marke, ab der es sich lohnt, die Liste anzuschauen, bevor es so
 * weit kommt.
 */
export const BOUNCE_BLOCK_RATE = 0.05;
export const BOUNCE_WARN_RATE = 0.03;

/**
 * Unter 50 versendeten Mails sagt eine Quote nichts.
 *
 * Bei 20 Mails ist ein einziger Bounce bereits 5 %. Daraus einen Blocker zu
 * machen hiesse, jeden Neustart nach dem ersten Missgeschick zu verhindern.
 */
export const BOUNCE_MIN_SAMPLE = 50;

/** Ab hier ist die Liste ueberwiegend ungeprueft und das Bounce-Risiko real. */
export const UNVERIFIED_WARN_SHARE = 0.25;

/** Ein Fuenftel schlechte Aufhaenger faerbt auf die ganze Kampagne ab. */
export const ICEBREAKER_WARN_SHARE = 0.2;

/**
 * Erste Mail unter 90 Woertern.
 *
 * Die erste Mail hat genau eine Aufgabe: eine Antwort ausloesen. Alles, was
 * darueber hinaus erklaert, kostet Antwortwahrscheinlichkeit, und auf dem
 * Telefon ist eine laengere Mail nicht mehr auf einen Blick erfassbar.
 */
export const FIRST_MAIL_MAX_WORDS = 90;

/**
 * Was ein Platzhalter beim Zaehlen wiegt.
 *
 * {{personalization}} wird zum Aufhaenger und ist damit so lang, wie die
 * Vorgabe erlaubt; ihn als ein Wort zu zaehlen wuerde jede Mail kuerzer
 * rechnen, als sie ankommt. Alle anderen Platzhalter (Vorname, Firma) sind
 * tatsaechlich etwa ein Wort.
 */
const PERSONALIZATION_PLACEHOLDER = "personalization";

/**
 * Dasselbe fuer {{websiteFinding}}.
 *
 * Anders als beim Aufhaenger ist die Laenge hier KEINE Workspace-Einstellung,
 * sondern eine Konstante im Worker (FINDING_MAX_WORDS in
 * apps/worker/worker/pipelines/website_finding.py). Sie steht deshalb als Zahl
 * hier und nicht als Parameter. Wer sie dort aendert, muss sie hier
 * nachziehen, sonst rechnet der Torwart die erste Mail kuerzer, als sie
 * ankommt.
 */
const WEBSITE_FINDING_PLACEHOLDER = "websitefinding";
export const WEBSITE_FINDING_WORDS = 20;

/** Platzhalter der Form {{name}}. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Wortzahl einer Mail, so wie sie beim Empfaenger ankommt.
 *
 * Platzhalter werden durch Fuellwoerter ersetzt statt entfernt: eine Mail mit
 * 60 eigenen Woertern plus Aufhaenger kommt mit ueber 80 an, und genau diese
 * Zahl entscheidet, ob sie noch kurz ist.
 */
export function estimateWords(body: string, personalizationWords: number): number {
  const filled = body.replace(PLACEHOLDER, (_m, name: string) => {
    const key = name.toLowerCase();
    if (key === PERSONALIZATION_PLACEHOLDER) return "x ".repeat(personalizationWords);
    if (key === WEBSITE_FINDING_PLACEHOLDER) return "x ".repeat(WEBSITE_FINDING_WORDS);
    return "x";
  });
  return wordCount(filled);
}

/**
 * Steht ein Link drin?
 *
 * Ein Link in der ERSTEN Mail ist einer der staerksten Spam-Faktoren beim
 * kalten Erstkontakt: die Empfaenger-Filter bewerten eine Mail an einen
 * Unbekannten mit Link deutlich strenger. In Folge-Mails ist er
 * unproblematisch, deshalb wird nur der erste Schritt geprueft.
 *
 * Platzhalter fliegen vorher raus: {{website}} ist kein Link im Mailtext,
 * sondern eine Angabe ueber den Empfaenger.
 */
export function hasLink(body: string): boolean {
  const withoutPlaceholders = body.replace(PLACEHOLDER, " ");
  return /https?:\/\/|\bwww\.\w|<a\s|\[[^\]]+\]\(/i.test(withoutPlaceholders);
}

export function stepFacts(body: string, personalizationWords: number): StepFacts {
  return { words: estimateWords(body, personalizationWords), hasLink: hasLink(body) };
}

export type Readiness = {
  checks: ReadinessCheck[];
  blockers: number;
  warnings: number;
  /** Falsch = es steht mindestens ein Blocker im Weg. */
  canStart: boolean;
};

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/**
 * Alle Pruefungen, immer in derselben Reihenfolge.
 *
 * Auch die bestandenen kommen mit zurueck ("ok"). Eine Liste, die nur Fehler
 * zeigt, beantwortet nicht die Frage, die der Nutzer vor dem Start wirklich
 * hat, naemlich ob ueberhaupt hingeschaut wurde. Die Oberflaeche kann die
 * bestandenen einklappen; hier gehen sie nicht verloren.
 */
export function assessCampaign(facts: ReadinessFacts): Readiness {
  const checks: ReadinessCheck[] = [];
  const leads = facts.sendableLeads;

  checks.push({
    id: "leads",
    severity: leads === 0 ? "blocker" : "ok",
    values: { sendable: leads },
  });

  // Zustellungs-Nachweise: je fehlender Eintrag EINE Meldung mit allen
  // betroffenen Domains, statt einer Meldung je Domain: der Handgriff ist
  // derselbe, nur an mehreren Stellen.
  const missingSpf = facts.domains.filter((d) => !d.spf).map((d) => d.domain);
  const missingDkim = facts.domains.filter((d) => !d.dkim).map((d) => d.domain);
  const missingDmarc = facts.domains.filter((d) => !d.dmarc).map((d) => d.domain);

  checks.push({
    id: "spf",
    severity: missingSpf.length > 0 ? "blocker" : "ok",
    values: { domains: missingSpf.join(", "), count: missingSpf.length },
  });
  checks.push({
    id: "dkim",
    severity: missingDkim.length > 0 ? "blocker" : "ok",
    values: { domains: missingDkim.join(", "), count: missingDkim.length },
  });
  // DMARC nur als Warnung: seit 2024 verlangen Google und Yahoo es von
  // Massenversendern, aber eine Mail ohne DMARC wird nicht zwingend
  // abgewiesen, anders als eine, die den SPF-Abgleich nicht besteht.
  checks.push({
    id: "dmarc",
    severity: missingDmarc.length > 0 ? "warning" : "ok",
    values: { domains: missingDmarc.join(", "), count: missingDmarc.length },
  });

  const bounceRate = share(facts.bouncedSoFar, facts.sentSoFar);
  const bounceCounts = enough(facts.sentSoFar);
  checks.push({
    id: "bounce",
    severity: !bounceCounts
      ? "ok"
      : bounceRate >= BOUNCE_BLOCK_RATE
        ? "blocker"
        : bounceRate >= BOUNCE_WARN_RATE
          ? "warning"
          : "ok",
    values: {
      percent: Math.round(bounceRate * 1000) / 10,
      bounced: facts.bouncedSoFar,
      sent: facts.sentSoFar,
    },
  });

  const unverifiedShare = share(facts.unverifiedLeads, leads);
  checks.push({
    id: "verification",
    severity: unverifiedShare >= UNVERIFIED_WARN_SHARE ? "warning" : "ok",
    values: {
      count: facts.unverifiedLeads,
      total: leads,
      percent: Math.round(unverifiedShare * 100),
    },
  });

  const missingShare = share(facts.leadsWithoutIcebreaker, leads);
  checks.push({
    id: "icebreakerMissing",
    severity: missingShare >= ICEBREAKER_WARN_SHARE ? "warning" : "ok",
    values: {
      count: facts.leadsWithoutIcebreaker,
      total: leads,
      percent: Math.round(missingShare * 100),
    },
  });

  const failingShare = share(facts.leadsWithFailingIcebreaker, leads);
  checks.push({
    id: "icebreakerFailing",
    severity: failingShare >= ICEBREAKER_WARN_SHARE ? "warning" : "ok",
    values: {
      count: facts.leadsWithFailingIcebreaker,
      total: leads,
      percent: Math.round(failingShare * 100),
    },
  });

  /**
   * Leads ohne Website-Befund bei einer Sequenz, die ihn benutzt.
   *
   * WARUM WARNUNG UND NICHT BLOCKER
   *
   * Nach der Trennlinie oben ist ein Blocker etwas, das mit Sicherheit
   * schiefgeht. Hier geht nichts schief: die betroffenen Leads werden beim
   * Anlegen zurueckgehalten (splitByWebsiteFinding), es geht also keine Mail
   * mit einem Loch raus. Die Kampagne wird nur kleiner als die Liste.
   *
   * Ein Blocker waere hier ausserdem eine Wand ohne Tuer. Eine Kampagne wird
   * aus ganzen Lead-Listen gebaut, nicht aus einzelnen Leads; ein Nutzer, dem
   * drei von fuenfhundert Leads fehlen, koennte den Blocker nur aufloesen,
   * indem er die Variable wieder aus der Sequenz nimmt. Und in fast jeder
   * Liste fehlt irgendjemandem eine erreichbare Website.
   *
   * Anders als icebreakerMissing gibt es hier KEINE Prozentschwelle: die
   * Pruefung erscheint nur, wenn die Sequenz die Variable wirklich benutzt,
   * und dann ist jeder einzelne zurueckgehaltene Lead eine Zahl, die der
   * Nutzer vor dem Start sehen will. Ohne diese Bedingung waere eine
   * Schwelle noetig, mit ihr waere sie Verschleierung.
   */
  checks.push({
    id: "websiteFindingMissing",
    severity:
      facts.sequenceUsesWebsiteFinding && facts.leadsWithoutWebsiteFinding > 0 ? "warning" : "ok",
    values: {
      count: facts.leadsWithoutWebsiteFinding,
      total: leads + facts.leadsWithoutWebsiteFinding,
    },
  });

  // Eine Sequenz aus einem einzigen Schritt verschenkt den Grossteil der
  // Antworten: die Mehrzahl kommt erst auf die zweite oder dritte Beruehrung.
  checks.push({
    id: "sequence",
    severity: facts.steps.length < 2 ? "warning" : "ok",
    values: { steps: facts.steps.length },
  });

  const first = facts.steps[0];
  checks.push({
    id: "firstMailLength",
    severity: first && first.words > FIRST_MAIL_MAX_WORDS ? "warning" : "ok",
    values: { words: first?.words ?? 0, max: FIRST_MAIL_MAX_WORDS },
  });
  checks.push({
    id: "firstMailLink",
    severity: first?.hasLink ? "warning" : "ok",
    values: {},
  });

  const blockers = checks.filter((c) => c.severity === "blocker").length;
  return {
    checks,
    blockers,
    warnings: checks.filter((c) => c.severity === "warning").length,
    canStart: blockers === 0,
  };
}

function enough(sent: number): boolean {
  return sent >= BOUNCE_MIN_SAMPLE;
}
