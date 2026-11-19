import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SKILL_IDS, DRUMMONDVILLE_HQ, defaultPmQuota, PM_PER_TECH_DAY } from "./constants";
import { planDispatch, startsAtDepot } from "./plan";
import { TECH_BASES } from "./tech-bases.data";
import { cityFromText } from "./territory";
import type { Appel, Tech } from "./types";

function tech(id: string, start = DRUMMONDVILLE_HQ): Tech {
  return {
    id,
    name: `Tech ${id}`,
    present: true,
    start,
    end: start,
    startHour: "08:00",
    endHour: "17:00",
    hours: 9,
    region: "",
    skills: [...ALL_SKILL_IDS],
  };
}

function call(id: string, ville: string): Appel {
  const city = cityFromText(ville);
  assert.ok(city);
  return {
    id,
    ville,
    type: "preventif",
    magasin: ville,
    adresse: `10 rue Test, ${ville}`,
    region: city.region,
    lat: city.lat,
    lng: city.lng,
    equipement: "Espresso",
    equipementId: 2,
    netsuiteId: id,
    planifie: false,
    heure: "",
    techId: "",
    openedAt: "2026-11-10",
  };
}

const noFetch = (() => {
  throw new Error("aucun appel réseau attendu");
}) as unknown as typeof fetch;

const montrealBase = { label: "Montréal", lat: 45.519, lng: -73.564, days: 40, share: 0.7 };

async function firstLeg(techs: Tech[], bases?: Record<string, typeof montrealBase>) {
  const plan = await planDispatch({
    calls: [call("A", "Montréal"), call("B", "Longueuil")],
    techs,
    startDate: "2026-11-20",
    horizonDays: 1,
    pmQuotaPerDay: 10,
    profiles: {},
    ...(bases ? { bases } : {}),
    env: {},
    fetchImpl: noFetch,
  });
  const route = plan.days[0].routes.find((item) => item.stops.length > 0);
  assert.ok(route, "une route attendue");
  return { plan, route };
}

describe("départs estimés par secteur", () => {
  it("reconnaît un départ laissé au dépôt", () => {
    assert.equal(startsAtDepot(""), true);
    assert.equal(startsAtDepot(undefined), true);
    assert.equal(startsAtDepot(DRUMMONDVILLE_HQ), true);
    assert.equal(startsAtDepot(` ${DRUMMONDVILLE_HQ.toUpperCase()} `), true);
    assert.equal(startsAtDepot("Longueuil"), false);
  });

  it("part du secteur estimé quand le départ est resté au dépôt", async () => {
    const { plan, route } = await firstLeg([tech("900")], { "900": montrealBase });
    assert.deepEqual(plan.stats.estimatedStarts, [{ id: "900", name: "Tech 900", label: "Montréal" }]);
    assert.ok(route.totalDriveMin < 60, `route ${route.totalDriveMin} min`);
  });

  it("respecte un départ saisi par le répartiteur", async () => {
    const { plan, route } = await firstLeg([tech("900", "Drummondville, QC")], {
      "900": montrealBase,
    });
    assert.equal(plan.stats.estimatedStarts, undefined);
    assert.ok(route.totalDriveMin > 120, `route ${route.totalDriveMin} min`);
  });

  it("bases vides : tout le monde part du dépôt", async () => {
    const { plan, route } = await firstLeg([tech("900")], {});
    assert.equal(plan.stats.estimatedStarts, undefined);
    assert.ok(route.totalDriveMin > 120, `route ${route.totalDriveMin} min`);
  });

  it("les bases générées restent au Québec et portent une part de journées", () => {
    for (const base of Object.values(TECH_BASES)) {
      assert.ok(base.lat > 44.9 && base.lat < 49, base.label);
      assert.ok(base.lng > -80 && base.lng < -64, base.label);
      assert.ok(base.share > 0 && base.share <= 1, base.label);
    }
  });
});

describe("quota préventif par défaut", () => {
  it("laisse de la place pour 5 visites par technicien présent", () => {
    assert.equal(PM_PER_TECH_DAY, 5);
    assert.equal(defaultPmQuota(9, 6.3), 45);
  });

  it("ne descend jamais sous le rythme Q4 et plafonne à 80", () => {
    assert.equal(defaultPmQuota(0, 6.3), 7);
    assert.equal(defaultPmQuota(1, 12.2), 13);
    assert.equal(defaultPmQuota(30, 6.3), 80);
  });
});
