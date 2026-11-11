import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapAppelRow } from "../netsuite/mapping";
import { ALL_SKILL_IDS } from "./constants";
import { suggestPlannerFields, type PlannerInputs } from "./suggest-form";
import { suggestPreventifs } from "./suggestions";
import type { Appel, Tech, TechRoute } from "./types";

function appel(address: string, id: string, type: Appel["type"]): Appel {
  const row = mapAppelRow({
    task_id: id,
    case_id: id,
    case_type: type === "preventif" ? "6" : "7",
    site: `Site ${id}`,
    address,
    asset: "Espresso",
    opened_at: "2026-11-01",
  });
  assert.ok(row);
  return row;
}

function tech(id: string, region: string): Tech {
  return {
    id,
    name: `Tech ${id}`,
    present: false,
    start: "100-1000 rue Cormier, Drummondville, QC J2C 2N6",
    end: "100-1000 rue Cormier, Drummondville, QC J2C 2N6",
    startHour: "08:00",
    endHour: "17:00",
    hours: 9,
    region,
    skills: [...ALL_SKILL_IDS],
  };
}

function routeWith(stop: Appel, region = stop.region): TechRoute {
  return {
    tech: { ...tech("5", region), present: true },
    stops: [{ appel: stop, minutesOnSite: 60, pinned: false }],
    google: null,
    error: null,
  };
}

const inputs: PlannerInputs = {
  date: "2026-11-11",
  pmQuota: "",
  reactifDuration: "",
  preventifDuration: "",
  moveAssigned: null,
  allowOvertime: null,
};

describe("suggestions sur adresses NetSuite", () => {
  it("groupe deux appels de la même ville", () => {
    const stop = appel(
      "100 QUEEN STREET\r\nSAULT STE. MARIE ON P6A 1A1",
      "1",
      "reactif",
    );
    const candidate = appel(
      "849 SECOND LINE EAST\r\nSAULT STE. MARIE ON P6B 4K5",
      "2",
      "preventif",
    );
    assert.equal(stop.ville, "Sault Ste. Marie");
    assert.equal(candidate.ville, "Sault Ste. Marie");
    assert.equal(stop.region, "Nord de l'Ontario — P6");
    assert.equal(candidate.region, stop.region);

    const suggestions = suggestPreventifs({
      routes: [routeWith(stop)],
      candidates: [candidate],
    });
    assert.equal(suggestions.length, 1);
    assert.match(suggestions[0]?.reason ?? "", /Sault Ste\. Marie/);
  });

  it("groupe deux villes du même secteur quand la ville diffère", () => {
    const stop = appel(
      "450 RUE BROCK\r\nDRUMMONDVILLE QC J2C 2N6",
      "11",
      "reactif",
    );
    const candidate = appel(
      "640 RUE LAURIER\r\nVICTORIAVILLE QC G6P 1A1",
      "12",
      "preventif",
    );
    assert.equal(stop.ville, "Drummondville");
    assert.equal(candidate.ville, "Victoriaville");
    assert.equal(stop.region, "Centre-du-Québec");
    assert.equal(candidate.region, "Centre-du-Québec");
    assert.notEqual(stop.ville, candidate.ville);

    const suggestions = suggestPreventifs({
      routes: [routeWith(stop)],
      candidates: [candidate],
    });
    assert.equal(suggestions.length, 1);
    assert.match(suggestions[0]?.reason ?? "", /Centre-du-Québec/);
  });

  it("départage deux mêmes régions par la distance", () => {
    const stop = appel(
      "450 RUE BROCK\r\nDRUMMONDVILLE QC J2C 2N6",
      "21",
      "reactif",
    );
    stop.lat = 45.883;
    stop.lng = -72.484;
    const near = {
      ...appel("112 RUE DU PORTAGE\r\nNICOLET QC J3T 1A1", "22", "preventif"),
      lat: 45.9,
      lng: -72.5,
    };
    const far = {
      ...appel("1700 BOULEVARD BECANCOUR\r\nBECANCOUR QC G9H 1A1", "23", "preventif"),
      lat: 48.4,
      lng: -71.2,
    };
    assert.equal(near.region, far.region);
    assert.notEqual(near.ville, stop.ville);
    assert.notEqual(far.ville, stop.ville);

    const suggestions = suggestPreventifs({
      routes: [routeWith(stop)],
      candidates: [far, near],
    });
    assert.ok(suggestions.length >= 1);
    assert.equal(suggestions[0]?.appel.id, "22");
  });

  it("laisse la même ville devant une autre ville plus proche", () => {
    const stop = appel(
      "450 RUE BROCK\r\nDRUMMONDVILLE QC J2C 2N6",
      "31",
      "reactif",
    );
    stop.lat = 45.883;
    stop.lng = -72.484;
    const sameCity = {
      ...appel("210 RUE LINDSAY\r\nDRUMMONDVILLE QC J2B 1A1", "32", "preventif"),
      lat: 46.8,
      lng: -71.2,
    };
    const otherCity = {
      ...appel("112 RUE DU PORTAGE\r\nNICOLET QC J3T 1A1", "33", "preventif"),
      lat: 45.89,
      lng: -72.49,
    };
    const suggestions = suggestPreventifs({
      routes: [routeWith(stop)],
      candidates: [otherCity, sameCity],
    });
    assert.equal(suggestions[0]?.appel.id, "32");
  });
});

describe("suggestion de présence sans zone technicien", () => {
  it("marque des techniciens présents quand NetSuite n'a pas de zone", () => {
    const calls = [
      appel("849 SECOND LINE EAST\r\nSAULT STE. MARIE ON P6B 4K5", "41", "reactif"),
    ];
    const techs = ["1", "2", "3", "4", "5"].map((id) => tech(id, ""));
    const result = suggestPlannerFields({
      inputs,
      techs,
      calls,
      presenceTouched: new Set(),
      skillsTouched: new Set(),
    });
    assert.deepEqual(
      result.techs.filter((item) => item.present).map((item) => item.id),
      ["1", "2", "3", "4", "5"],
    );
  });

  it("garde le technicien de la région quand la zone est déjà connue", () => {
    const calls = [
      appel("450 RUE BROCK\r\nDRUMMONDVILLE QC J2C 2N6", "51", "reactif"),
    ];
    const result = suggestPlannerFields({
      inputs,
      techs: [tech("1", ""), tech("2", "Centre-du-Québec")],
      calls,
      presenceTouched: new Set(),
      skillsTouched: new Set(),
    });
    assert.deepEqual(
      result.techs.filter((item) => item.present).map((item) => item.id),
      ["2"],
    );
  });
});
