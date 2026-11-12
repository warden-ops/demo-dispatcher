import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { DEPOT, cityFromText } from "./territory";
import {
  GOOGLE_UNAVAILABLE,
  buildTravelMatrix,
  clearTravelCache,
  haversineMatrix,
  travelMinutesFromKm,
} from "./travel";
import { distanceKm } from "./geo";

afterEach(() => {
  clearTravelCache();
});

describe("temps de route", () => {
  it("estime Drummondville–Sherbrooke par la route, pas à vol d'oiseau sec", () => {
    const sherbrooke = cityFromText("Sherbrooke");
    assert.ok(sherbrooke);
    const matrix = haversineMatrix([DEPOT, { lat: sherbrooke.lat, lng: sherbrooke.lng }]);
    const minutes = matrix.minutes[1];
    assert.ok(minutes > 60 && minutes < 120, String(minutes));
    assert.equal(matrix.minutes[0], 0);
    assert.equal(matrix.source, "haversine");
  });

  it("utilise la matrice Google et la relit du disque", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "routes-"));
    const file = path.join(directory, "matrix.json");
    const points = [DEPOT, { lat: 45.404, lng: -71.892 }];
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      assert.match(String(input), /computeRouteMatrix/);
      return new Response(
        JSON.stringify([
          {
            originIndex: 0,
            destinationIndex: 1,
            duration: "4800s",
            distanceMeters: 90000,
            condition: "ROUTE_EXISTS",
          },
          {
            originIndex: 1,
            destinationIndex: 0,
            duration: "5100s",
            distanceMeters: 95000,
            condition: "ROUTE_EXISTS",
          },
        ]),
        { status: 200 },
      );
    };
    const env = {
      GOOGLE_MAPS_SERVER_API_KEY: "test-key",
      ROUTE_MATRIX_CACHE_PATH: file,
    };
    const first = await buildTravelMatrix(points, { env, fetchImpl });
    assert.equal(calls, 1);
    assert.equal(first.minutes[1], 80);
    assert.equal(first.source, "google");
    assert.equal(JSON.stringify(first).includes("test-key"), false);

    clearTravelCache();
    const second = await buildTravelMatrix(points, {
      env,
      fetchImpl: async () => {
        throw new Error("réseau coupé");
      },
    });
    assert.equal(second.minutes[1], 80);
    assert.equal(second.minutes[2], 85);
    await rm(directory, { recursive: true, force: true });
  });

  it("estime Drummondville–Ottawa autour de 2 h 45", () => {
    const ottawa = cityFromText("Ottawa");
    const gatineau = cityFromText("Gatineau");
    assert.ok(ottawa && gatineau);
    const toOttawa = travelMinutesFromKm(distanceKm(DEPOT, ottawa) ?? 0);
    const toGatineau = travelMinutesFromKm(distanceKm(DEPOT, gatineau) ?? 0);
    assert.ok(toOttawa >= 150 && toOttawa <= 185, `Ottawa ${toOttawa}`);
    assert.ok(toGatineau >= 150 && toGatineau <= 185, `Gatineau ${toGatineau}`);
  });

  it("interroge Google par lots au-delà de 25 secteurs", async () => {
    const points = Array.from({ length: 30 }, (_, index) => ({
      lat: 45.2 + (index % 10) * 0.4,
      lng: -76.5 + Math.floor(index / 10) * 0.8,
    }));
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify([
          {
            originIndex: 0,
            destinationIndex: 1,
            duration: "6000s",
            distanceMeters: 120000,
            condition: "ROUTE_EXISTS",
          },
        ]),
        { status: 200 },
      );
    };
    const matrix = await buildTravelMatrix(points, {
      env: { GOOGLE_MAPS_SERVER_API_KEY: "test-key" },
      fetchImpl,
      budgetMs: 5000,
    });
    assert.ok(calls >= 2, `appels Google ${calls}`);
    assert.notEqual(matrix.source, "haversine");
  });

  it("s'arrête au premier refus de facturation Google", async () => {
    clearTravelCache();
    const points = Array.from({ length: 40 }, (_, index) => ({
      lat: 44 + (index % 8) * 0.5,
      lng: -78 + Math.floor(index / 8) * 0.6,
    }));
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: { status: "PERMISSION_DENIED", message: "BILLING_DISABLED" },
        }),
        { status: 403 },
      );
    };
    const started = Date.now();
    const matrix = await buildTravelMatrix(points, {
      env: { GOOGLE_MAPS_SERVER_API_KEY: "test-key" },
      fetchImpl,
      budgetMs: 8000,
    });
    const again = await buildTravelMatrix(points, {
      env: { GOOGLE_MAPS_SERVER_API_KEY: "test-key" },
      fetchImpl,
      budgetMs: 8000,
    });
    assert.equal(calls, 1);
    assert.equal(matrix.source, "haversine");
    assert.equal(matrix.warning, GOOGLE_UNAVAILABLE);
    assert.equal(again.warning, GOOGLE_UNAVAILABLE);
    assert.ok(Date.now() - started < 1500, `durée ${Date.now() - started}`);
  });
});
