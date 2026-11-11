import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { DEPOT, cityFromText } from "./territory";
import { buildTravelMatrix, clearTravelCache, haversineMatrix } from "./travel";

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
});
