import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SKILL_IDS, DRUMMONDVILLE_HQ, defaultPmQuota, PM_PER_TECH_DAY } from "./constants";
import { planDispatch, startsAtDepot } from "./plan";
import { TECH_BASES } from "./tech-bases.data";
import { TECH_HOME_BASES } from "./tech-home-bases";
import { cityFromText } from "./territory";
import type { Appel, Tech } from "./types";

function tech(id: string, start = DRUMMONDVILLE_HQ, end = start): Tech {
  return {
    id,
    name: `Tech ${id}`,
    present: true,
    start,
    end,
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

type PlanOptions = Partial<Parameters<typeof planDispatch>[0]>;

async function firstLeg(
  techs: Tech[],
  bases?: Record<string, typeof montrealBase>,
  options: PlanOptions = {},
) {
  const plan = await planDispatch({
    calls: [call("A", "Montréal"), call("B", "Longueuil")],
    techs,
    startDate: "2026-11-20",
    horizonDays: 1,
    pmQuotaPerDay: 10,
    profiles: {},
    homeBases: {},
    ...(bases ? { bases, useEstimatedStarts: true } : {}),
    env: {},
    fetchImpl: noFetch,
    ...options,
  });
  const route = plan.days[0].routes.find((item) => item.stops.length > 0);
  assert.ok(route, "une route attendue");
  return { plan, route };
}

describe("départs estimés par secteur (option, désactivés par défaut)", () => {
  it("reconnaît un départ laissé au dépôt", () => {
    assert.equal(startsAtDepot(""), true);
    assert.equal(startsAtDepot(undefined), true);
    assert.equal(startsAtDepot(DRUMMONDVILLE_HQ), true);
    assert.equal(startsAtDepot(` ${DRUMMONDVILLE_HQ.toUpperCase()} `), true);
    assert.equal(startsAtDepot("Longueuil"), false);
  });

  it("par défaut : pas de départ estimé, départ et retour au dépôt", async () => {
    const plan = await planDispatch({
      calls: [call("A", "Montréal"), call("B", "Longueuil")],
      techs: [tech("259020")],
      startDate: "2026-11-20",
      horizonDays: 1,
      pmQuotaPerDay: 10,
      profiles: {},
      env: {},
      fetchImpl: noFetch,
    });
    assert.equal(plan.stats.estimatedStarts, undefined);
    assert.equal(plan.stats.techEndpoints?.[0]?.startKind, "dépôt");
    assert.equal(plan.stats.techEndpoints?.[0]?.endKind, "dépôt");
  });

  it("activés : part du secteur estimé quand le départ est resté au dépôt", async () => {
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
  it("laisse de la place pour 8 préventifs par technicien présent (le quota ne bloque plus les tournées)", () => {
    assert.equal(PM_PER_TECH_DAY, 8);
    assert.equal(defaultPmQuota(9, 6.3), 72);
  });

  it("ne descend jamais sous le rythme Q4 et plafonne à 80", () => {
    assert.equal(defaultPmQuota(0, 6.3), 8);
    assert.equal(defaultPmQuota(1, 12.2), 13);
    assert.equal(defaultPmQuota(30, 6.3), 80);
  });
});

const granbyHome = {
  label: "Granby",
  address: "212 rue Cartier, Granby, QC J2G 5A6",
  lat: 45.40719,
  lng: -72.723142,
  returnsHome: true,
  source: "test",
};

async function granbyDay(techs: Tech[], options: PlanOptions = {}) {
  const plan = await planDispatch({
    calls: [call("G1", "Granby"), call("G2", "Granby")],
    techs,
    startDate: "2026-11-20",
    horizonDays: 1,
    pmQuotaPerDay: 10,
    profiles: {},
    homeBases: { "900": granbyHome },
    env: {},
    fetchImpl: noFetch,
    ...options,
  });
  const route = plan.days[0].routes.find((item) => item.stops.length > 0);
  assert.ok(route, "une route attendue");
  return { plan, route };
}

describe("domiciles fixes et point d'arrivée", () => {
  it("les deux exceptions confirmées sont configurées, avec retour au domicile", () => {
    assert.deepEqual(Object.keys(TECH_HOME_BASES).sort(), ["123", "463934"]);
    const marier = TECH_HOME_BASES["463934"];
    assert.equal(marier.address, "122 rue de la Falaise, Labelle, QC J0T 1H0");
    assert.ok(Math.abs(marier.lat - 46.274) < 0.01 && Math.abs(marier.lng + 74.725) < 0.01);
    const villeneuve = TECH_HOME_BASES["123"];
    assert.equal(villeneuve.address, "212 rue Cartier, Granby, QC J2G 5A6");
    assert.ok(Math.abs(villeneuve.lat - 45.407) < 0.01 && Math.abs(villeneuve.lng + 72.723) < 0.01);
    assert.ok(marier.returnsHome && villeneuve.returnsHome);
  });

  it("domicile fixe : part et revient au domicile quand le champ reste au dépôt", async () => {
    const { plan, route } = await granbyDay([tech("900")]);
    const endpoint = plan.stats.techEndpoints?.[0];
    assert.equal(endpoint?.startKind, "domicile");
    assert.equal(endpoint?.endKind, "domicile");
    assert.ok(route.stops[0].driveMin < 15, `1er trajet ${route.stops[0].driveMin} min`);
    assert.ok(route.returnDriveMin < 15, `retour ${route.returnDriveMin} min`);
  });

  it("l'adresse du domicile préremplie compte comme valeur par défaut", async () => {
    const { plan } = await granbyDay([tech("900", granbyHome.address)]);
    assert.equal(plan.stats.techEndpoints?.[0]?.startKind, "domicile");
    assert.equal(plan.stats.techEndpoints?.[0]?.endKind, "domicile");
  });

  it("case « tout le monde au dépôt » : ignore le domicile, même prérempli", async () => {
    const { plan, route } = await granbyDay([tech("123", TECH_HOME_BASES["123"].address)], {
      homeBases: {},
    });
    assert.equal(plan.stats.techEndpoints?.[0]?.startKind, "dépôt");
    assert.equal(plan.stats.techEndpoints?.[0]?.endKind, "dépôt");
    assert.ok(route.returnDriveMin > 45, `retour ${route.returnDriveMin} min`);
  });

  it("un point d'arrivée saisi a priorité sur le domicile, le départ reste au domicile", async () => {
    const { plan, route } = await granbyDay([tech("900", DRUMMONDVILLE_HQ, "Sherbrooke, QC")]);
    const endpoint = plan.stats.techEndpoints?.[0];
    assert.equal(endpoint?.startKind, "domicile");
    assert.equal(endpoint?.endKind, "saisi");
    assert.ok(route.stops[0].driveMin < 15, `1er trajet ${route.stops[0].driveMin} min`);
    assert.ok(route.returnDriveMin > 40, `retour Sherbrooke ${route.returnDriveMin} min`);
  });

  it("départ saisi seul : le retour reste au dépôt (champ arrivée par défaut)", async () => {
    const { plan, route } = await granbyDay([tech("901", "Granby, QC", DRUMMONDVILLE_HQ)]);
    const endpoint = plan.stats.techEndpoints?.[0];
    assert.equal(endpoint?.startKind, "saisi");
    assert.equal(endpoint?.endKind, "dépôt");
    assert.ok(route.stops[0].driveMin < 15, `1er trajet ${route.stops[0].driveMin} min`);
    assert.ok(route.returnDriveMin > 45, `retour dépôt ${route.returnDriveMin} min`);
  });

  it("départ et arrivée saisis différents, sans domicile", async () => {
    const { plan, route } = await granbyDay([tech("901", DRUMMONDVILLE_HQ, "Granby, QC")]);
    assert.equal(plan.stats.techEndpoints?.[0]?.startKind, "dépôt");
    assert.equal(plan.stats.techEndpoints?.[0]?.endKind, "saisi");
    assert.ok(route.stops[0].driveMin > 45, `1er trajet ${route.stops[0].driveMin} min`);
    assert.ok(route.returnDriveMin < 15, `retour ${route.returnDriveMin} min`);
  });

  it("adresse saisie inconnue : dépôt utilisé et avertissement", async () => {
    const { plan } = await granbyDay([tech("901", "Chemin introuvable", DRUMMONDVILLE_HQ)]);
    assert.equal(plan.stats.techEndpoints?.[0]?.startKind, "dépôt");
    assert.match(plan.stats.addressWarnings?.[0] ?? "", /non reconnu, dépôt utilisé/);
  });

  it("configuration réelle : Marier à Labelle et Villeneuve à Granby, les autres au dépôt", async () => {
    const plan = await planDispatch({
      calls: [call("G1", "Granby"), call("M1", "Montréal"), call("D1", "Drummondville")],
      techs: [tech("463934"), tech("123"), tech("259020")],
      startDate: "2026-11-20",
      horizonDays: 1,
      pmQuotaPerDay: 10,
      profiles: {},
      env: {},
      fetchImpl: noFetch,
    });
    const byId = new Map(plan.stats.techEndpoints?.map((item) => [item.id, item]));
    assert.equal(byId.get("463934")?.start, "Domicile (Labelle)");
    assert.equal(byId.get("463934")?.end, "Domicile (Labelle)");
    assert.equal(byId.get("123")?.start, "Domicile (Granby)");
    assert.equal(byId.get("123")?.endAddress, "212 rue Cartier, Granby, QC J2G 5A6");
    assert.equal(byId.get("259020")?.startKind, "dépôt");
    assert.equal(byId.get("259020")?.endKind, "dépôt");
  });
});
