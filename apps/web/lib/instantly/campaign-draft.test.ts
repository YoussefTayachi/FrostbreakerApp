import { describe, expect, it } from "vitest";
import {
  campaignFormValueFromDraft,
  classifyLinkedCampaigns,
  isCampaignDraft,
  planDraftTakeover,
  type CampaignDraftFormValue,
  type CampaignDraftRow,
} from "./campaign-draft";

/** Eine Entwurfszeile, wie create_campaign sie anlegt. */
function entwurf(overrides: Partial<CampaignDraftRow> = {}): CampaignDraftRow {
  return {
    id: "c1",
    name: "Zahnaerzte Q4",
    status: "draft",
    instantly_campaign_id: null,
    activated_at: null,
    ...overrides,
  };
}

/** emptyCampaignFormValue() aus campaign-form.tsx, hier woertlich nachgebaut:
 *  lib/** wird ohne DOM getestet, die Komponente laesst sich nicht laden. */
function leerwert(): CampaignDraftFormValue {
  return {
    name: "",
    mailboxes: [],
    steps: [{ variants: [{ subject: "", body: "" }], delayDays: 0 }],
    days: [1, 2, 3, 4, 5],
    from: "09:00",
    to: "17:00",
    timezone: "Europe/Belgrade",
    dailyLimit: "50",
    openTracking: false,
    linkTracking: false,
  };
}

describe("isCampaignDraft", () => {
  it("erkennt die Zeile, die create_campaign anlegt", () => {
    expect(isCampaignDraft(entwurf())).toBe(true);
  });

  it("eine Kampagne mit Instantly-Zwilling ist keiner", () => {
    expect(isCampaignDraft(entwurf({ instantly_campaign_id: "inst-1" }))).toBe(false);
  });

  it("laufender Status und activated_at zaehlen einzeln", () => {
    // Beide Faelle gehoeren zu einer Kampagne, die versendet oder versendet
    // hat. Nur auf instantly_campaign_id zu pruefen wuerde sie hier als
    // Entwurf durchgehen lassen -- und der Aufrufer wuerde sie ueberschreiben.
    expect(isCampaignDraft(entwurf({ status: "active" }))).toBe(false);
    expect(isCampaignDraft(entwurf({ activated_at: "2026-08-22T10:00:00Z" }))).toBe(false);
  });
});

describe("classifyLinkedCampaigns", () => {
  it("trennt den Entwurf von der echten Kampagne", () => {
    const rows = [entwurf({ id: "c1" }), entwurf({ id: "c2", instantly_campaign_id: "inst-1" })];
    expect(classifyLinkedCampaigns(rows)).toEqual({ draft: rows[0], live: rows[1] });
  });

  it("ohne Zeilen ist beides null", () => {
    expect(classifyLinkedCampaigns([])).toEqual({ draft: null, live: null });
  });

  it("nennt bei zwei Entwuerfen den ersten der uebergebenen Reihenfolge", () => {
    const rows = [entwurf({ id: "alt" }), entwurf({ id: "neu" })];
    expect(classifyLinkedCampaigns(rows).draft?.id).toBe("alt");
  });
});

describe("planDraftTakeover", () => {
  it("verwendet den vorhandenen Entwurf weiter, statt eine zweite Zeile anzulegen", () => {
    const rows = [entwurf({ id: "c1" })];
    expect(planDraftTakeover(rows, null)).toEqual({ blocked: null, reuse: rows[0], obsolete: [] });
  });

  it("ohne Entwurf wird neu angelegt", () => {
    expect(planDraftTakeover([], null)).toEqual({ blocked: null, reuse: null, obsolete: [] });
  });

  it("der aus ?draft= geoeffnete gewinnt gegen einen zweiten", () => {
    // Der Nutzer hat GENAU DEN geprueft; ein zweiter Entwurf derselben Listen
    // darf ihn nicht verdraengen, nur weil er aelter ist.
    const rows = [entwurf({ id: "alt" }), entwurf({ id: "geoeffnet" })];
    const plan = planDraftTakeover(rows, "geoeffnet");
    expect(plan.reuse?.id).toBe("geoeffnet");
    expect(plan.obsolete.map((o) => o.id)).toEqual(["alt"]);
  });

  it("weitere Entwuerfe derselben Listen werden aussortiert", () => {
    // Sie koennten nach dem Anlegen nie mehr eine Kampagne werden: jede
    // beteiligte Suche traegt dann eine instantly_campaign_id, und die App
    // antwortet auf einen zweiten Versuch mit HTTP 409.
    const rows = [entwurf({ id: "c1" }), entwurf({ id: "c2" }), entwurf({ id: "c3" })];
    const plan = planDraftTakeover(rows, null);
    expect(plan.reuse?.id).toBe("c1");
    expect(plan.obsolete.map((o) => o.id)).toEqual(["c2", "c3"]);
  });

  it("eine echte Kampagne blockiert und laesst alles stehen", () => {
    const live = entwurf({ id: "c9", instantly_campaign_id: "inst-1", status: "active" });
    const plan = planDraftTakeover([entwurf({ id: "c1" }), live], null);
    expect(plan.blocked).toBe(live);
    // Nichts weiterverwenden und vor allem nichts wegraeumen: der Aufrufer
    // bricht ab, und dann darf der Entwurf nicht verschwunden sein.
    expect(plan.reuse).toBeNull();
    expect(plan.obsolete).toEqual([]);
  });
});

describe("campaignFormValueFromDraft", () => {
  const einstellungen = {
    name: "Zahnaerzte Q4",
    mailboxes: [],
    days: [1, 2, 3, 4, 5],
    send_window_start: "09:00:00",
    send_window_end: "17:00:00",
    timezone: "Europe/Berlin",
    daily_limit: 40,
    open_tracking: false,
    link_tracking: false,
  };

  it("uebernimmt Name, Zeitfenster und Tageslimit", () => {
    const v = campaignFormValueFromDraft(einstellungen, [], leerwert());
    expect(v.name).toBe("Zahnaerzte Q4");
    // "09:00:00" aus Postgres, "09:00" fuer <input type="time">.
    expect(v.from).toBe("09:00");
    expect(v.to).toBe("17:00");
    expect(v.dailyLimit).toBe("40");
  });

  it("bildet die Zeitzone auf eine ab, die das Auswahlfeld kennt", () => {
    // create_campaign speichert die Vorgabe der Spalte, "Europe/Berlin"
    // (Migration 0001). In Instantlys kuratierter Liste gibt es die nicht;
    // ohne die Abbildung stuende im Formular eine leere Auswahl.
    expect(campaignFormValueFromDraft(einstellungen, [], leerwert()).timezone).toBe("Europe/Belgrade");
  });

  it("macht aus den gespeicherten Schritten Formularstufen", () => {
    const v = campaignFormValueFromDraft(
      einstellungen,
      [
        { wait_days: 0, subject: "Erste", body: "Hallo", variants: [{ subject: "Erste", body: "Hallo" }] },
        { wait_days: 3, subject: "Zweite", body: "Nochmal", variants: [{ subject: "Zweite", body: "Nochmal" }] },
      ],
      leerwert()
    );
    expect(v.steps).toEqual([
      { variants: [{ subject: "Erste", body: "Hallo" }], delayDays: 0 },
      { variants: [{ subject: "Zweite", body: "Nochmal" }], delayDays: 3 },
    ]);
  });

  it("faellt fuer Zeilen ohne variants auf subject/body zurueck", () => {
    // Zeilen von vor Migration 0071. Ohne den Rueckfall stuende im Formular
    // eine Stufe ohne jedes Textfeld.
    const v = campaignFormValueFromDraft(
      einstellungen,
      [{ wait_days: 0, subject: "Erste", body: "Hallo", variants: null }],
      leerwert()
    );
    expect(v.steps[0].variants).toEqual([{ subject: "Erste", body: "Hallo" }]);
  });

  it("ein Entwurf ohne Sequenz bekommt die leere Stufe des Formulars", () => {
    // create_campaign ohne set_campaign_sequence: die Kampagne existiert, die
    // Mails fehlen. Das Formular braucht trotzdem eine Stufe zum Tippen.
    expect(campaignFormValueFromDraft(einstellungen, [], leerwert()).steps).toEqual(leerwert().steps);
  });

  it("Messung bleibt aus, auch wenn die Spalten null sind", () => {
    // Null heisst "vor Migration 0071 angelegt", nicht "an". Beide Messungen
    // kosten Zustellbarkeit und werden nur eingeschaltet, wenn es jemand tut.
    const v = campaignFormValueFromDraft(
      { ...einstellungen, open_tracking: null, link_tracking: null },
      [],
      leerwert()
    );
    expect(v.openTracking).toBe(false);
    expect(v.linkTracking).toBe(false);
  });

  it("leere Spalten fallen auf den Leerwert des Formulars zurueck", () => {
    const v = campaignFormValueFromDraft(
      {
        ...einstellungen,
        days: [],
        send_window_start: null,
        send_window_end: null,
        timezone: "",
        daily_limit: null,
        mailboxes: null,
      },
      [],
      leerwert()
    );
    expect(v.days).toEqual([1, 2, 3, 4, 5]);
    expect(v.from).toBe("09:00");
    expect(v.dailyLimit).toBe("50");
    expect(v.mailboxes).toEqual([]);
  });
});
