import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Appel } from "../guertech/types";
import { clearGeocodeCache, geocodeAppels } from "./geocode";

function appel(id: string, adresse: string): Appel {
  return {
    id,
    type: "preventif",
    magasin: "Site",
    adresse,
    ville: "Sault Ste. Marie",
    region: "Nord de l'Ontario — P6",
    equipement: "Espresso",
    equipementId: 2,
    netsuiteId: id,
    planifie: false,
    heure: "",
    techId: "",
    openedAt: "2026-11-01",
  };
}

const ADDRESS = "849 SECOND LINE EAST, SAULT STE. MARIE ON P6B 4K5";

afterEach(() => {
  clearGeocodeCache();
});

describe("géocodage", () => {
  it("ne fait rien sans clé", async () => {
    let called = 0;
    const result = await geocodeAppels([appel("1", ADDRESS)], {}, async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    });
    assert.equal(called, 0);
    assert.equal(result[0]?.lat, undefined);
  });

  it("met le point en cache et ignore un échec", async () => {
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      return new Response(
        JSON.stringify({
          status: "OK",
          results: [{ geometry: { location: { lat: 46.51, lng: -84.33 } } }],
        }),
        { status: 200 },
      );
    };
    const env = { GOOGLE_MAPS_SERVER_API_KEY: "test-key" };
    const first = await geocodeAppels(
      [appel("1", ADDRESS), appel("2", ADDRESS)],
      env,
      fetchImpl,
    );
    assert.equal(called, 1);
    assert.equal(first[0]?.lat, 46.51);
    assert.equal(first[1]?.lng, -84.33);
    assert.equal(first[0]?.adresse.includes("test-key"), false);

    const again = await geocodeAppels([appel("3", ADDRESS)], env, fetchImpl);
    assert.equal(called, 1);
    assert.equal(again[0]?.lat, 46.51);

    clearGeocodeCache();
    const failed = await geocodeAppels([appel("4", ADDRESS)], env, async () => {
      throw new Error("réseau indisponible");
    });
    assert.equal(failed[0]?.lat, undefined);
    assert.equal(failed[0]?.ville, "Sault Ste. Marie");
  });

  it("ne remplace pas des coordonnées déjà fournies", async () => {
    let called = 0;
    const seeded = { ...appel("1", ADDRESS), lat: 45.5, lng: -73.5 };
    const result = await geocodeAppels(
      [seeded],
      { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "browser-key" },
      async () => {
        called += 1;
        return new Response("{}", { status: 200 });
      },
    );
    assert.equal(called, 0);
    assert.equal(result[0]?.lat, 45.5);
  });
});
