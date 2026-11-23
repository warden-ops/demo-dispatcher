import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addBusinessDays } from "./calendar";
import { ALL_SKILL_IDS, DRUMMONDVILLE_HQ } from "./constants";
import { cityFromText, DEPOT, pointForAppel, productionScenario } from "./territory";
import type { Appel, Tech } from "./types";
import type { ProfileMap } from "./tech-profiles";
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
    profiles?: ProfileMap;
    pinOnlyTechIds?: string[];
    floorPerTechDay?: number;
    improveIterations?: number;
    workday?: { start: number; end: number };
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
    profiles: extra?.profiles,
    pinOnlyTechIds: extra?.pinOnlyTechIds,
    floorPerTechDay: extra?.floorPerTechDay,
    improveIterations: extra?.improveIterations ?? 2000,
    workday: extra?.workday,
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

  it("part avant 8 h pour honorer un rendez-vous fixe", () => {
    const result = solve(
      [
        call({
          id: "SJ8",
          ville: "Saint-Jean-sur-Richelieu",
          type: "reactif",
          planifie: true,
          heure: "08:00",
          techId: "1",
        }),
        call({
          id: "SJ9",
          ville: "Saint-Jean-sur-Richelieu",
          type: "preventif",
          planifie: true,
          heure: "09:00",
          techId: "2",
          lat: 45.32,
          lng: -73.26,
        }),
      ],
      [tech("1"), tech("2")],
      { pmQuotaPerDay: 0, horizonDays: 1 },
    );
    const routes = result.days.flatMap((day) => day.routes);
    const early = routes.find((route) => route.stops.some((stop) => stop.appel.id === "SJ8"));
    const nine = routes.find((route) => route.stops.some((stop) => stop.appel.id === "SJ9"));
    assert.ok(early && nine);
    assert.ok(early.departMin < 8 * 60, `départ ${early.departMin}`);
    assert.ok((early.stops[0]?.arriveMin ?? 9999) <= 8 * 60);
    assert.equal(result.unassigned.length, 0);
  });

  it("garde un rendez-vous de fin de journée même si le retour passe 17 h", () => {
    const result = solve(
      [
        call({
          id: "HY",
          ville: "Saint-Hyacinthe",
          type: "reactif",
          planifie: true,
          heure: "15:30",
          techId: "1",
          openedAt: "2026-11-11",
        }),
      ],
      [tech("1")],
      { pmQuotaPerDay: 0, horizonDays: 1, durations: { preventif: 60, reactif: 90 } },
    );
    const route = result.days.flatMap((day) => day.routes)[0];
    assert.ok(route);
    assert.equal(route.stops[0]?.appel.id, "HY");
    assert.ok(route.finishMin > 17 * 60);
  });

  it("place un rendez-vous sans heure dans la journée", () => {
    const result = solve(
      [
        call({
          id: "AN",
          ville: "Saint-Anselme",
          planifie: true,
          heure: "",
          techId: "1",
        }),
      ],
      [tech("1")],
      { pmQuotaPerDay: 0, horizonDays: 1 },
    );
    const stop = result.days.flatMap((day) => day.routes).flatMap((route) => route.stops)[0];
    assert.equal(stop?.appel.id, "AN");
    assert.match(stop?.reason ?? "", /sans heure/);
    assert.equal(result.unassigned.length, 0);
  });

  it("laisse Ottawa et Gatineau en tournée de jour", () => {
    const result = solve(
      [
        call({ id: "OT1", ville: "Ottawa", type: "preventif" }),
        call({ id: "OT2", ville: "Gatineau", type: "preventif", lat: 45.48, lng: -75.72 }),
        call({ id: "OT3", ville: "Ottawa", type: "reactif", lat: 45.43, lng: -75.69 }),
        call({ id: "BP", ville: "Baie-Saint-Paul", type: "preventif" }),
        call({ id: "RL", ville: "Rivière-du-Loup", type: "preventif" }),
        call({ id: "SG", ville: "Saguenay", type: "preventif" }),
      ],
      [tech("1"), tech("2")],
      { pmQuotaPerDay: 8, horizonDays: 2 },
    );
    const overnight = result.remoteTrips.flatMap((trip) => trip.calls.map((item) => item.appel.id));
    for (const id of ["OT1", "OT2", "OT3", "BP", "RL", "SG"]) {
      assert.equal(overnight.includes(id), false, id);
    }
    const served = new Set(
      result.days.flatMap((day) =>
        day.routes.flatMap((route) => route.stops.map((stop) => stop.appel.id)),
      ),
    );
    for (const id of ["OT1", "OT2", "OT3"]) assert.equal(served.has(id), true, id);
  });

  it("ne fige pas un rendez-vous passé sur le premier jour", () => {
    const result = solve(
      [
        call({
          id: "PAST1",
          ville: "Saint-Jean-sur-Richelieu",
          planifie: true,
          heure: "08:00",
          techId: "1",
          scheduledOn: "2026-05-12",
        }),
        call({
          id: "PAST2",
          ville: "Saint-Hyacinthe",
          planifie: true,
          heure: "08:00",
          techId: "1",
          scheduledOn: "2026-11-02",
        }),
        call({
          id: "FUTURE",
          ville: "Drummondville",
          planifie: true,
          heure: "11:00",
          techId: "2",
          scheduledOn: "2026-11-13",
        }),
        call({
          id: "LATER",
          ville: "Nicolet",
          planifie: true,
          heure: "10:00",
          techId: "2",
          scheduledOn: "2026-12-01",
        }),
      ],
      [tech("1"), tech("2")],
      { pmQuotaPerDay: 0, horizonDays: 3, startDate: "2026-11-11" },
    );
    const placed = result.days.flatMap((day) =>
      day.routes.flatMap((route) =>
        route.stops.map((stop) => ({
          id: stop.appel.id,
          date: day.date,
          reason: stop.reason,
          tech: route.techId,
        })),
      ),
    );
    const past = placed.filter((item) => item.id === "PAST1" || item.id === "PAST2");
    assert.equal(past.length, 2);
    assert.ok(past.every((item) => item.reason?.startsWith("RDV à replanifier")));
    const future = placed.find((item) => item.id === "FUTURE");
    assert.equal(future?.date, "2026-11-13");
    assert.equal(future?.tech, "2");
    assert.equal(
      placed.some((item) => item.id === "LATER"),
      false,
    );
    assert.match(
      result.unassigned.find((item) => item.appel.id === "LATER")?.reason ?? "",
      /hors de cet horizon/,
    );
  });
});

describe("repli d'adresse", () => {
  it("situe Thunder Bay et Great Village sans latitude", () => {
    const thunder = pointForAppel({
      ville: "",
      adresse: "RR#12, Thunder Bay, ON P7B 5E4",
    });
    const village = pointForAppel({
      ville: "",
      adresse: "12 Station Road, Great Village NS",
    });
    const postalOnly = pointForAppel({
      ville: "",
      adresse: "RR 2, B0M 1L0",
    });
    assert.ok(thunder && thunder.lat > 48);
    assert.ok(village && village.lat > 45 && village.lat < 46);
    assert.ok(postalOnly);
  });

  it("préfère le technicien dont c'est le secteur habituel", () => {
    const calls = [
      call({ id: "Q1", ville: "Lévis", type: "reactif" }),
      call({ id: "Q2", ville: "Lévis", type: "reactif" }),
      call({ id: "M1", ville: "Montréal", type: "reactif" }),
      call({ id: "M2", ville: "Montréal", type: "reactif" }),
    ];
    const profiles: ProfileMap = {
      mtl: {
        role: "route",
        visits6m: 200,
        anchors: [{ label: "Montréal", lat: 45.5, lng: -73.6, radiusKm: 25, share: 0.9 }],
      },
      qc: {
        role: "route",
        visits6m: 200,
        anchors: [{ label: "Québec", lat: 46.8, lng: -71.25, radiusKm: 20, share: 0.9 }],
      },
    };
    const result = solve(calls, [tech("mtl"), tech("qc")], {
      pmQuotaPerDay: 0,
      horizonDays: 2,
      durations: { preventif: 60, reactif: 60 },
      profiles,
    });
    const owner = new Map<string, string>();
    for (const day of result.days) {
      for (const route of day.routes) {
        for (const stop of route.stops) owner.set(stop.appel.id, route.techId);
      }
    }
    assert.equal(owner.get("Q1"), "qc");
    assert.equal(owner.get("Q2"), "qc");
    assert.equal(owner.get("M1"), "mtl");
    assert.equal(owner.get("M2"), "mtl");
    const reasons = result.days.flatMap((day) =>
      day.routes.flatMap((route) => route.stops.map((stop) => stop.reason)),
    );
    assert.ok(reasons.some((reason) => reason.includes("Secteur habituel")));
  });

  it("sans profils, aucune pénalité de secteur n'est appliquée", () => {
    const calls = [call({ id: "Q1", ville: "Lévis", type: "reactif" })];
    const result = solve(calls, [tech("a"), tech("b")], {
      pmQuotaPerDay: 0,
      horizonDays: 1,
      durations: { preventif: 60, reactif: 60 },
    });
    assert.equal(result.stats.served, 1);
  });

  it("un technicien « rendez-vous seulement » ne reçoit que ses rendez-vous", () => {
    const calls = [
      call({
        id: "R1",
        ville: "Drummondville",
        type: "reactif",
        planifie: true,
        heure: "09:00",
        techId: "shop",
        scheduledOn: "2026-11-11",
      }),
      call({ id: "P1", ville: "Drummondville", type: "preventif" }),
      call({ id: "P2", ville: "Drummondville", type: "preventif" }),
    ];
    const result = solve(calls, [tech("shop"), tech("road")], {
      pmQuotaPerDay: 10,
      horizonDays: 1,
      pinOnlyTechIds: ["shop"],
      durations: { preventif: 30, reactif: 60 },
    });
    const byTech = new Map<string, string[]>();
    for (const day of result.days) {
      for (const route of day.routes) {
        byTech.set(route.techId, route.stops.map((stop) => stop.appel.id));
      }
    }
    assert.deepEqual(byTech.get("shop"), ["R1"]);
    assert.deepEqual([...(byTech.get("road") ?? [])].sort(), ["P1", "P2"]);
  });
});

describe("objectif : plus d'appels par technicien et par jour", () => {
  const montreal = (count: number, prefix = "M") =>
    Array.from({ length: count }, (_, index) =>
      call({
        id: `${prefix}${index}`,
        ville: "Montréal",
        lat: 45.5 + (index % 6) * 0.004,
        lng: -73.57 + Math.floor(index / 6) * 0.004,
      }),
    );

  it("jamais de dépassement de la journée : retour avant 17 h et au plus 9 h de travail", () => {
    const result = solve(montreal(40), [tech("1"), tech("2")], { horizonDays: 2, pmQuotaPerDay: 40 });
    for (const day of result.days) {
      for (const route of day.routes) {
        assert.ok(route.finishMin <= 17 * 60, `${route.techId} finit à ${route.finishMin}`);
        assert.ok(route.finishMin - route.departMin <= 9 * 60, `${route.techId} travaille ${route.finishMin - route.departMin} min`);
        assert.ok(route.departMin >= 8 * 60, `${route.techId} part à ${route.departMin}`);
      }
    }
    assert.equal(result.stats.overtimeRoutes, 0);
  });

  it("un rendez-vous fixe lointain est respecté, la journée n'est pas allongée et ne compte pas sous le plancher", () => {
    const montrealPin = call({
      id: "MP",
      ville: "Montréal",
      type: "reactif",
      planifie: true,
      heure: "14:45",
      scheduledOn: "2026-11-11",
      techId: "2",
    });
    const far = call({
      id: "SI",
      ville: "Sept-Îles",
      planifie: true,
      heure: "13:00",
      scheduledOn: "2026-11-11",
      techId: "1",
    });
    const result = solve([far, montrealPin, ...montreal(12)], [tech("1"), tech("2")], { horizonDays: 1, pmQuotaPerDay: 40 });
    const route = result.days[0].routes.find((item) => item.techId === "1");
    assert.ok(route, "la journée du rendez-vous existe");
    assert.deepEqual(route.stops.map((stop) => stop.appel.id), ["SI"]);
    // Rendez-vous à 14 h 45 à Montréal (2 h) : retour au dépôt après 17 h, imposé.
    // Le planificateur peut ajouter des appels le matin, sans finir plus tard.
    const pinned = result.days[0].routes.find((item) => item.techId === "2");
    assert.ok(pinned);
    const pinStop = pinned.stops.find((stop) => stop.appel.id === "MP");
    assert.ok(pinStop);
    const forcedFinish = pinStop.leaveMin + pinned.returnDriveMin;
    assert.ok(pinned.finishMin <= forcedFinish + 1, `${pinned.finishMin} contre ${forcedFinish}`);
    assert.ok(pinned.stops.length > 1, "appels ajoutés avant le rendez-vous");
    assert.equal(result.stats.overtimeRoutes, 0);
    assert.equal(result.stats.bookedOvertimeRoutes, 2);
    const under = result.stats.floor?.underFloor.find((item) => item.techId === "1");
    assert.match(under?.reason ?? "", /rendez-vous fixes/);
  });

  it("remplit chaque journée jusqu'au plancher quand les appels existent", () => {
    const calls = Array.from({ length: 30 }, (_, index) =>
      call({ id: `D${index}`, ville: "Drummondville", lat: 45.87 + (index % 5) * 0.006, lng: -72.5 + Math.floor(index / 5) * 0.006 }),
    );
    const result = solve(calls, [tech("1"), tech("2")], { horizonDays: 2, pmQuotaPerDay: 40 });
    const counts = result.days.flatMap((day) => day.routes.map((route) => route.stops.length));
    assert.equal(counts.length, 4);
    assert.ok(Math.min(...counts) >= 5, counts.join(" "));
    assert.equal(result.stats.floor?.minPerTechDay, Math.min(...counts));
    assert.equal(result.stats.floor?.underFloor.length, 0);
  });

  it("place au moins autant d'appels que la construction seule, sans plus de route par appel", () => {
    const calls = [...montreal(24), ...montreal(6, "L").map((item, index) => ({ ...item, ville: "Longueuil", lat: 45.53 + index * 0.003, lng: -73.51 }))];
    const base = solve(calls, [tech("1"), tech("2")], { horizonDays: 2, pmQuotaPerDay: 40, improveIterations: 0 });
    const improved = solve(calls, [tech("1"), tech("2")], { horizonDays: 2, pmQuotaPerDay: 40 });
    assert.ok(improved.stats.served >= base.stats.served, `${improved.stats.served} contre ${base.stats.served}`);
    if (improved.stats.served === base.stats.served) {
      assert.ok(improved.stats.driveMin <= base.stats.driveMin + 1);
    }
    assert.ok(improved.stats.floor?.search.iterations && improved.stats.floor.search.iterations > 0);
  });

  it("journée de travail réglable : 7 h 30 à 17 h laisse place à plus d'appels qu'à 8 h", () => {
    const calls = montreal(30);
    const normal = solve(calls, [tech("1")], { horizonDays: 1, pmQuotaPerDay: 40 });
    const longer = solve(calls, [tech("1")], { horizonDays: 1, pmQuotaPerDay: 40, workday: { start: 450, end: 1020 } });
    assert.ok(longer.stats.served >= normal.stats.served);
    for (const route of longer.days[0].routes) assert.ok(route.departMin >= 450 && route.finishMin <= 1020);
  });
});

