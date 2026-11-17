import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SKILL_IDS, DEFAULT_DURATIONS, DRUMMONDVILLE_HQ } from "./constants";
import {
  NETSUITE_DURATION_MEDIANS,
  splitRoadTechs,
  TECH_PROFILES,
  ZONE_SOFT_MAX_MIN,
  zoneSoftPenalty,
  type TechProfile,
} from "./tech-profiles";
import type { Appel, Tech } from "./types";

function tech(id: string): Tech {
  return {
    id,
    name: `Tech ${id} · Technique`,
    present: true,
    start: DRUMMONDVILLE_HQ,
    end: DRUMMONDVILLE_HQ,
    startHour: "08:00",
    endHour: "17:00",
    hours: 9,
    region: "",
    skills: [...ALL_SKILL_IDS],
  };
}

const quebec: TechProfile = {
  role: "route",
  visits6m: 100,
  anchors: [{ label: "Québec", lat: 46.8, lng: -71.25, radiusKm: 20, share: 0.8 }],
};

describe("profils techniciens", () => {
  it("ne pénalise pas un appel dans le secteur habituel", () => {
    assert.equal(zoneSoftPenalty(quebec, { lat: 46.81, lng: -71.22 }), 0);
  });

  it("pénalise un appel loin du secteur, avec un plafond", () => {
    const sherbrooke = zoneSoftPenalty(quebec, { lat: 45.4, lng: -71.89 });
    assert.ok(sherbrooke > 10);
    assert.ok(sherbrooke <= ZONE_SOFT_MAX_MIN);
    assert.equal(zoneSoftPenalty(quebec, { lat: 42.3, lng: -83.0 }), ZONE_SOFT_MAX_MIN);
  });

  it("ne pénalise pas un technicien sans historique", () => {
    assert.equal(zoneSoftPenalty(undefined, { lat: 45.4, lng: -71.89 }), 0);
    assert.equal(
      zoneSoftPenalty({ role: "route", visits6m: 0, anchors: [] }, { lat: 45.4, lng: -71.89 }),
      0,
    );
  });

  it("retire les techniciens d'atelier et les doublons de la route", () => {
    const profiles = {
      shop: { role: "atelier", visits6m: 0, anchors: [] },
      dup: { role: "doublon", visits6m: 0, anchors: [] },
      road: quebec,
    } satisfies Record<string, TechProfile>;
    const split = splitRoadTechs([tech("shop"), tech("dup"), tech("road"), tech("new")], [], {
      profiles,
    });
    assert.deepEqual(
      split.road.map((item) => item.id),
      ["road", "new"],
    );
    assert.deepEqual(
      split.excluded.map((item) => item.id),
      ["shop", "dup"],
    );
    const all = splitRoadTechs([tech("shop"), tech("road")], [], {
      profiles,
      includeWorkshop: true,
    });
    assert.equal(all.road.length, 2);
  });

  it("garde un technicien d'atelier pour son rendez-vous déjà attribué", () => {
    const profiles = { shop: { role: "atelier", visits6m: 0, anchors: [] } } satisfies Record<
      string,
      TechProfile
    >;
    const appel = { id: "1", planifie: true, techId: "shop" } as Appel;
    const split = splitRoadTechs([tech("shop")], [appel], { profiles });
    assert.deepEqual(split.pinOnly, ["shop"]);
    assert.equal(split.road.length, 1);
  });

  it("les données NetSuite couvrent les 14 techniciens et les durées par défaut suivent les médianes", () => {
    assert.equal(Object.keys(TECH_PROFILES).length, 14);
    for (const profile of Object.values(TECH_PROFILES)) {
      for (const anchor of profile.anchors) {
        assert.ok(anchor.lat > 40 && anchor.lat < 60);
        assert.ok(anchor.lng < -50 && anchor.lng > -100);
      }
    }
    assert.equal(DEFAULT_DURATIONS.reactif, NETSUITE_DURATION_MEDIANS.reactif.minutes);
    assert.equal(DEFAULT_DURATIONS.preventif, NETSUITE_DURATION_MEDIANS.preventif.minutes);
  });
});
