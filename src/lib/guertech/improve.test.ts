import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { improveRoutes, type Evaluated, type LnsContext, type LnsRoute } from "./improve";

// Petit monde sur une ligne : appels à des positions (minutes depuis le départ).
function world(positions: number[], options: { capacity: number; service: number; routes: number; floor?: number; fixed?: number[] }) {
  const callCount = positions.length;
  const minutes = (from: number, to: number) => Math.abs(positions[from] - positions[to]);
  const evaluate = (stops: number[]): Evaluated | null => {
    let time = 0;
    let prev = 0;
    for (const id of stops) {
      time += Math.abs(positions[id] - prev) + options.service;
      prev = positions[id];
    }
    const back = Math.abs(prev);
    let drive = back;
    prev = 0;
    for (const id of stops) {
      drive += Math.abs(positions[id] - prev);
      prev = positions[id];
    }
    if (time + back > options.capacity) return null;
    return { driveMin: drive, driveKm: drive, finish: time + back, depart: 0 };
  };
  const routes: LnsRoute[] = Array.from({ length: options.routes }, (_, tech) => ({
    tech,
    day: 0,
    stops: [],
    drive: 0,
    driveKm: 0,
    finish: 0,
    depart: 0,
  }));
  const placed = new Uint8Array(callCount);
  const fixed = new Uint8Array(callCount);
  for (const id of options.fixed ?? []) fixed[id] = 1;
  const ctx: LnsContext = {
    routes,
    callCount,
    evaluate: (stops) => evaluate(stops),
    canPlace: () => true,
    fixed,
    isPreventif: new Uint8Array(callCount).fill(1),
    value: () => 1000,
    routeCost: (_route, _stops, driveMin) => driveMin,
    floor: options.floor ?? 0,
    floorPenalty: 400,
    floorExempt: () => false,
    pool: positions.map((_, index) => index).filter((index) => !fixed[index]),
    placed,
    quota: 99,
    pmCount: new Int16Array(1),
    minutes,
    fromStart: (_route, call) => Math.abs(positions[call]),
    maxIterations: 600,
    deadline: Date.now() + 5_000,
  };
  const put = (route: LnsRoute, stops: number[]) => {
    const evaluated = evaluate(stops);
    assert.ok(evaluated, "tournée de départ faisable");
    route.stops = stops;
    route.drive = evaluated.driveMin;
    route.finish = evaluated.finish;
    for (const id of stops) {
      placed[id] = 1;
      ctx.pmCount[0] += 1;
    }
  };
  return { ctx, routes, put, evaluate };
}

describe("recherche détruire et reconstruire", () => {
  it("préfère deux appels proches à un appel lointain (plus d'appels, pas moins de route)", () => {
    // Capacité 300 min, 60 min sur place. Un appel à 100 min (aller-retour 200 + 60 = 260),
    // ou trois appels à 20 min (40 + 180 = 220).
    const { ctx, routes, put } = world([100, 20, 21, 22], { capacity: 300, service: 60, routes: 1 });
    put(routes[0], [0]);
    improveRoutes(ctx);
    assert.deepEqual([...routes[0].stops].sort(), [1, 2, 3]);
    assert.equal(ctx.placed[0], 0);
  });

  it("à nombre égal d'appels, réduit la route", () => {
    const { ctx, routes, put } = world([90, 10, 11], { capacity: 300, service: 60, routes: 1 });
    put(routes[0], [0, 1]);
    improveRoutes(ctx);
    assert.equal(routes[0].stops.length, 2);
    assert.ok(routes[0].drive <= 22, `route ${routes[0].drive} min`);
  });

  it("plancher : rééquilibre une journée à 8 appels et une à 2 vers 5 et 5", () => {
    const positions = Array.from({ length: 10 }, (_, index) => 10 + index);
    const { ctx, routes, put } = world(positions, { capacity: 540, service: 50, routes: 2, floor: 5 });
    put(routes[0], [0, 1, 2, 3, 4, 5, 6, 7]);
    put(routes[1], [8, 9]);
    improveRoutes(ctx);
    assert.equal(routes[0].stops.length + routes[1].stops.length, 10);
    assert.ok(Math.min(routes[0].stops.length, routes[1].stops.length) >= 5, routes.map((r) => r.stops.length).join("/"));
  });

  it("ne déplace jamais un rendez-vous fixe et ne dépasse jamais la capacité", () => {
    const { ctx, routes, put, evaluate } = world([30, 31, 32, 33, 34, 35, 36], {
      capacity: 300,
      service: 60,
      routes: 2,
      fixed: [0],
    });
    put(routes[0], [0]);
    improveRoutes(ctx);
    assert.ok(routes[0].stops.includes(0));
    for (const route of routes) {
      const evaluated = evaluate(route.stops);
      assert.ok(evaluated && evaluated.finish <= 300);
    }
  });

  it("est reproductible avec la même graine", () => {
    const positions = [5, 40, 41, 80, 12, 13, 60, 61, 62, 25];
    const run = () => {
      const { ctx, routes } = world(positions, { capacity: 400, service: 45, routes: 2, floor: 4 });
      ctx.seed = 42;
      improveRoutes(ctx);
      return routes.map((route) => route.stops.join(",")).join("|");
    };
    assert.equal(run(), run());
  });
});
