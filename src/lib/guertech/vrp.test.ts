import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addBusinessDays } from "./calendar";
import { ALL_SKILL_IDS, DRUMMONDVILLE_HQ } from "./constants";
import { cityFromText, DEPOT, productionScenario } from "./territory";
import type { Appel, Tech } from "./types";
import { haversineMatrix } from "./travel";
import { solveVrp } from "./vrp";

function tech(id: string, region = ""): Tech {
  return {
    id,
    name: `Tech ${id}`,
    present: true,
    start: DRUMMONDVILLE_HQ,
    end: DRUMMONDVILLE_HQ,
    startHour: "08:00",
    endHour: "17:00",
    hours: 9,
    region,
    skills: [...ALL_SKILL_IDS],
  };
}

function call(partial: Partial<Appel> & Pick<Appel, "id" | "ville">): Appel {
  const city = cityFromText(partial.ville);
  assert.ok(city);
  return {
    type: "preventif",
    magasin: partial.ville,
    adresse: `10 rue Test, ${partial.ville}`,
    region: city.region,
    lat: city.lat,
    lng: city.lng,
    equipement: "Espresso",
    equipementId: 2,
    netsuiteId: partial.id,
    planifie: false,
    heure: "",
    techId: "",
    openedAt: "2026-11-10",
    ...partial,
  };
}

function solve(
  calls: Appel[],
  techs: Tech[],
  extra?: {
    pmQuotaPerDay?: number;
    startDate?: string;
    durations?: { preventif: number; reactif: number };
    moveAssigned?: boolean;
    horizonDays?: number;
  },
) {
  const points = [
    ...calls.map((item) => ({ lat: item.lat ?? 0, lng: item.lng ?? 0 })),
    ...techs.map(() => DEPOT),
  ];
  return solveVrp({
    calls,
    techs,
    matrix: haversineMatrix(points),
    startDate: extra?.startDate ?? "2026-11-11",
    horizonDays: extra?.horizonDays,
    pmQuotaPerDay: extra?.pmQuotaPerDay ?? 20,
    durations: extra?.durations,
    moveAssigned: extra?.moveAssigned ?? true,
    budgetMs: 700,
  });
}

function finishOk(result: ReturnType<typeof solve>): void {
  for (const day of result.days) {
    for (const route of day.routes) {
      assert.ok(
        route.finishMin <= 17 * 60,
        `${route.techId} ${day.date} finit à ${route.finishMin}`,
      );
    }
  }
  assert.equal(result.stats.overtimeRoutes, 0);
}

describe("optimiseur de tournées", () => {
  it("ne dépasse pas 17 h, retour au dépôt inclus", () => {
    const calls = Array.from({ length: 8 }, (_, index) =>
      call({
        id: `D${index}`,
        ville: "Drummondville",
        type: "reactif",
        lat: 45.88 + index * 0.01,
        lng: -72.49,
        openedAt: "2026-11-10",
      }),
    );
    const result = solve(calls, [tech("1")], {
      pmQuotaPerDay: 0,
      horizonDays: 1,
      durations: { preventif: 60, reactif: 90 },
    });
    finishOk(result);
    assert.ok(result.stats.served < calls.length);
    assert.ok(result.stats.served > 0);
    assert.ok(result.unassigned.length > 0);
    assert.match(result.unassigned[0]?.reason ?? "", /17 h|créneau|SLA/);
  });

  it("respecte le délai SLA quand la journée a de la place", () => {
    const result = solve(
      [
        call({
          id: "R1",
          ville: "Drummondville",
          type: "reactif",
          openedAt: "2026-11-10",
        }),
      ],
      [tech("1")],
      { pmQuotaPerDay: 0 },
    );
    const due = addBusinessDays("2026-11-10", 2);
    assert.equal(due, "2026-11-12");
    const served = result.days.find((day) =>
      day.routes.some((route) => route.stops.some((stop) => stop.appel.id === "R1")),
    );
    assert.ok(served);
    assert.ok(served.date <= due);
    assert.equal(result.stats.slaMisses, 0);
    finishOk(result);
    assert.match(result.days[0]?.routes[0]?.stops[0]?.reason ?? "", /SLA/);
  });

  it("groupe les appels trop loin et n'en met aucun sur une journée", () => {
    const saultA = call({
      id: "S1",
      ville: "Sault Ste. Marie",
      type: "reactif",
      openedAt: "2026-11-04",
    });
    const saultB = call({
      id: "S2",
      ville: "Sault Ste. Marie",
      type: "preventif",
      lat: (saultA.lat ?? 0) + 0.02,
      lng: saultA.lng,
    });
    const result = solve(
      [
        call({ id: "L1", ville: "Drummondville", type: "reactif" }),
        saultA,
        saultB,
        call({ id: "W1", ville: "Wawa", type: "reactif", openedAt: "2026-11-04" }),
        call({ id: "Q1", ville: "Sept-Îles", type: "preventif" }),
        call({ id: "T1", ville: "Tillsonburg", type: "reactif", openedAt: "2026-11-04" }),
        call({ id: "C1", ville: "Corner Brook", type: "reactif", openedAt: "2026-11-04" }),
      ],
      [tech("1"), tech("2")],
      { pmQuotaPerDay: 4 },
    );
    finishOk(result);
    const scheduled = new Set(
      result.days.flatMap((day) =>
        day.routes.flatMap((route) => route.stops.map((stop) => stop.appel.id)),
      ),
    );
    assert.equal(scheduled.has("L1"), true);
    for (const id of ["S1", "S2", "W1", "Q1", "T1", "C1"]) {
      assert.equal(scheduled.has(id), false, id);
    }
    const north = result.remoteTrips.find((trip) =>
      trip.calls.some((item) => item.appel.id === "S1"),
    );
    assert.ok(north);
    assert.deepEqual(
      north.calls.map((item) => item.appel.id).sort(),
      ["S1", "S2", "W1"],
    );
    assert.equal(north.kind, "nuitée");
    assert.match(north.reason, /17 h/);
    assert.match(north.reason, /nuitée/);
    assert.equal(
      result.remoteTrips.some((trip) =>
        trip.calls.every((item) => item.appel.ville === "Sept-Îles"),
      ),
      true,
    );
    assert.equal(
      result.remoteTrips.some((trip) => trip.area === "Tillsonburg"),
      true,
    );
    assert.equal(
      result.remoteTrips.some((trip) => trip.area === "Corner Brook"),
      true,
    );
    assert.equal(
      result.unassigned.some((item) => item.appel.id === "S1"),
      false,
    );
  });

  it("répartit par la géographie quand les techniciens n'ont pas de zone", () => {
    const calls = [
      ...[0, 1, 2, 3].map((index) =>
        call({
          id: `DR${index}`,
          ville: "Drummondville",
          lat: 45.88 + index * 0.01,
          lng: -72.48,
        }),
      ),
      ...[0, 1, 2, 3].map((index) =>
        call({
          id: `SH${index}`,
          ville: "Sherbrooke",
          lat: 45.4 + index * 0.01,
          lng: -71.89,
        }),
      ),
    ];
    const result = solve(calls, [tech("1"), tech("2")], { pmQuotaPerDay: 12 });
    finishOk(result);
    assert.equal(result.stats.served, calls.length);
    for (const day of result.days) {
      for (const route of day.routes) {
        const regions = new Set(route.stops.map((stop) => stop.appel.region));
        assert.equal(regions.size, 1, route.stops.map((stop) => stop.appel.ville).join(", "));
      }
    }
  });

  it("utilise la zone seulement si le technicien en a une", () => {
    const result = solve(
      [
        call({ id: "SH", ville: "Sherbrooke", type: "reactif" }),
        call({ id: "DR", ville: "Drummondville", type: "reactif" }),
      ],
      [tech("estrie", "Estrie"), tech("libre")],
      { pmQuotaPerDay: 0 },
    );
    const owner = (id: string) => {
      for (const day of result.days) {
        for (const route of day.routes) {
          if (route.stops.some((stop) => stop.appel.id === id)) return route.techId;
        }
      }
      return "";
    };
    assert.equal(owner("SH"), "estrie");
    assert.equal(owner("DR"), "libre");
    finishOk(result);
  });

  it("laisse un appel dont la compétence manque", () => {
    const worker = tech("1");
    worker.skills = [2];
    const result = solve(
      [call({ id: "X", ville: "Nicolet", type: "reactif", equipementId: 15 })],
      [worker],
      { pmQuotaPerDay: 0 },
    );
    assert.equal(result.stats.served, 0);
    assert.match(result.unassigned[0]?.reason ?? "", /Compétence/);
  });

  it("garde un rendez-vous planifié sur son technicien", () => {
    const result = solve(
      [
        call({
          id: "P",
          ville: "Drummondville",
          planifie: true,
          heure: "10:00",
          techId: "a",
          type: "reactif",
        }),
      ],
      [tech("a"), tech("b")],
      { pmQuotaPerDay: 0 },
    );
    const route = result.days
      .flatMap((day) => day.routes)
      .find((item) => item.stops.some((stop) => stop.appel.id === "P"));
    assert.ok(route);
    assert.equal(route.techId, "a");
    assert.equal(route.stops[0]?.pinned, true);
    assert.ok((route.stops[0]?.arriveMin ?? 9999) <= 10 * 60);
    finishOk(result);
  });

  it("est déterministe", () => {
    const scenario = productionScenario({ calls: 80, techs: 6 });
    const points = [
      ...scenario.calls.map((item) => ({ lat: item.lat ?? 0, lng: item.lng ?? 0 })),
      ...scenario.techs.map(() => DEPOT),
    ];
    const matrix = haversineMatrix(points);
    const once = solveVrp({
      calls: scenario.calls,
      techs: scenario.techs,
      matrix,
      startDate: scenario.asOf,
      pmQuotaPerDay: 30,
      budgetMs: 700,
    });
    const twice = solveVrp({
      calls: scenario.calls,
      techs: scenario.techs,
      matrix,
      startDate: scenario.asOf,
      pmQuotaPerDay: 30,
      budgetMs: 700,
    });
    const signature = (result: typeof once) =>
      result.days
        .map((day) =>
          day.routes
            .map((route) => `${route.techId}:${route.stops.map((stop) => stop.appel.id).join(",")}`)
            .join("|"),
        )
        .join(";");
    assert.equal(signature(once), signature(twice));
    finishOk(once);
  });

  it("tient en moins de 3 s pour 300 appels et 14 techniciens", () => {
    const scenario = productionScenario({ calls: 300, techs: 14 });
    const points = [
      ...scenario.calls.map((item) => ({ lat: item.lat ?? 0, lng: item.lng ?? 0 })),
      ...scenario.techs.map(() => DEPOT),
    ];
    const started = Date.now();
    const result = solveVrp({
      calls: scenario.calls,
      techs: scenario.techs,
      matrix: haversineMatrix(points),
      startDate: scenario.asOf,
      pmQuotaPerDay: 60,
      budgetMs: 900,
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `elapsed ${elapsed}`);
    finishOk(result);
    assert.ok(result.stats.served > 80);
    assert.ok(result.remoteTrips.length >= 4);
    assert.equal(result.stats.overtimeRoutes, 0);
  });
});
