import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRUMMONDVILLE_HQ } from "./constants";
import { isDefaultEndpoint, pointForTypedAddress, resolveTechEndpoints } from "./tech-endpoints";
import { TECH_HOME_BASES } from "./tech-home-bases";
import { DEPOT } from "./territory";

describe("points de départ et d'arrivée", () => {
  it("vide, dépôt prérempli ou domicile prérempli = valeur par défaut", () => {
    assert.equal(isDefaultEndpoint("", "463934", TECH_HOME_BASES), true);
    assert.equal(isDefaultEndpoint(DRUMMONDVILLE_HQ, "463934", TECH_HOME_BASES), true);
    assert.equal(
      isDefaultEndpoint("122, Rue de la Falaise, Labelle QC J0T1H0", "463934", TECH_HOME_BASES),
      true,
    );
    // Le domicile d'un autre technicien est une saisie.
    assert.equal(isDefaultEndpoint(TECH_HOME_BASES["123"].address, "463934", TECH_HOME_BASES), false);
    assert.equal(isDefaultEndpoint("Longueuil", "463934", TECH_HOME_BASES), false);
  });

  it("place une adresse saisie : dépôt, domicile connu, ville, code postal", () => {
    assert.deepEqual(pointForTypedAddress("1000 rue Cormier, Drummondville", TECH_HOME_BASES), DEPOT);
    const labelle = pointForTypedAddress("122 rue de la Falaise, Labelle, QC J0T 1H0", TECH_HOME_BASES);
    assert.equal(labelle?.lat, TECH_HOME_BASES["463934"].lat);
    assert.ok(pointForTypedAddress("Sherbrooke, QC", TECH_HOME_BASES));
    assert.equal(pointForTypedAddress("Chemin introuvable", TECH_HOME_BASES), null);
  });

  it("priorité : saisie, domicile, estimé (si activé), dépôt", () => {
    const base = { label: "Montréal", lat: 45.5, lng: -73.6, days: 30, share: 0.5 };
    const est = resolveTechEndpoints(
      { id: "9", start: DRUMMONDVILLE_HQ, end: DRUMMONDVILLE_HQ },
      { homeBases: TECH_HOME_BASES, estimatedBases: { "9": base } },
    );
    assert.equal(est.start.kind, "estimé");
    assert.equal(est.end.kind, "estimé");
    const off = resolveTechEndpoints(
      { id: "9", start: DRUMMONDVILLE_HQ, end: DRUMMONDVILLE_HQ },
      { homeBases: TECH_HOME_BASES },
    );
    assert.equal(off.start.kind, "dépôt");
    assert.equal(off.end.kind, "dépôt");
    const home = resolveTechEndpoints(
      { id: "463934", start: "", end: "Montréal" },
      { homeBases: TECH_HOME_BASES, estimatedBases: { "463934": base } },
    );
    assert.equal(home.start.kind, "domicile");
    assert.equal(home.end.kind, "saisi");
  });

  it("aucun tiret long ni demi-cadratin dans la configuration", () => {
    for (const base of Object.values(TECH_HOME_BASES)) {
      assert.doesNotMatch(`${base.label} ${base.address} ${base.source}`, /[\u2013\u2014]/);
    }
  });
});
