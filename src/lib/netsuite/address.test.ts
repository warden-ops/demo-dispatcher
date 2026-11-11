import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REGIONS } from "../guertech/constants";
import { deriveRegion, parseAddressText, villeFromAddress } from "./address";

const SAULT = "849 SECOND LINE EAST\r\nSAULT STE. MARIE ON P6B 4K5";

describe("adresse canadienne", () => {
  it("lit la dernière ligne VILLE PROV POSTAL", () => {
    const parsed = parseAddressText(SAULT);
    assert.equal(parsed.ville, "Sault Ste. Marie");
    assert.equal(parsed.province, "ON");
    assert.equal(parsed.postal, "P6B 4K5");
    assert.equal(villeFromAddress(SAULT), "Sault Ste. Marie");
  });

  it("accepte une virgule, un code seul et un pays en fin de bloc", () => {
    assert.deepEqual(
      parseAddressText("849 SECOND LINE EAST\r\nSAULT STE. MARIE, ON P6B 4K5"),
      { ville: "Sault Ste. Marie", province: "ON", postal: "P6B 4K5" },
    );
    assert.deepEqual(
      parseAddressText(
        "849 SECOND LINE EAST\nSAULT STE. MARIE ON\nP6B 4K5\nCanada",
      ),
      { ville: "Sault Ste. Marie", province: "ON", postal: "P6B 4K5" },
    );
  });

  it("garde le format québécois à virgules, avec ou sans code postal", () => {
    assert.deepEqual(
      parseAddressText("450 rue Brock, Drummondville, QC J2C 2N6"),
      { ville: "Drummondville", province: "QC", postal: "J2C 2N6" },
    );
    assert.equal(
      villeFromAddress("820 boulevard Saint-Joseph, Victoriaville, QC"),
      "Victoriaville",
    );
    assert.equal(
      parseAddressText("1500 rue des Forges, Trois-Rivières, QC").ville,
      "Trois-Rivières",
    );
  });

  it("lit une ville sans code postal sur la dernière ligne", () => {
    assert.deepEqual(parseAddressText("450 RUE BROCK\r\nDRUMMONDVILLE QC"), {
      ville: "Drummondville",
      province: "QC",
      postal: "",
    });
    assert.equal(parseAddressText("450 rue Brock").ville, "");
  });
});

describe("région", () => {
  it("aligne la ville et le technicien sur les mêmes libellés", () => {
    const fromCity = deriveRegion({ ville: "Drummondville" });
    const fromTech = deriveRegion({ explicit: "Centre-du-Québec" });
    const fromLocation = deriveRegion({ explicit: "Drummondville" });
    assert.equal(fromCity, "Centre-du-Québec");
    assert.equal(fromTech, fromCity);
    assert.equal(fromLocation, fromCity);
    assert.equal(
      (REGIONS as readonly string[]).includes(fromCity),
      true,
    );
    assert.equal(deriveRegion({ ville: "Trois-Rivières" }), "Mauricie");
    assert.equal(deriveRegion({ ville: "St-Georges" }), "Chaudière-Appalaches");
  });

  it("dérive le secteur depuis le FSA, y compris hors Québec", () => {
    assert.equal(
      deriveRegion({ ville: "Sault Ste. Marie" }),
      "Nord de l'Ontario — P6",
    );
    assert.equal(
      deriveRegion({
        ville: "SAULT STE. MARIE",
        province: "ON",
        postal: "P6B 4K5",
      }),
      deriveRegion({ explicit: "Sault Ste. Marie" }),
    );
    assert.equal(
      deriveRegion({ ville: "Victoriaville", postal: "G6P 1A1" }),
      "Centre-du-Québec",
    );
    assert.equal(deriveRegion({ postal: "H3B 4R9" }), "Montréal");
    assert.equal(deriveRegion({}), "");
  });

  it("ne classe pas Windsor en Ontario dans l'Estrie", () => {
    assert.equal(deriveRegion({ ville: "Windsor" }), "Estrie");
    assert.equal(
      deriveRegion({ ville: "Windsor", province: "ON", postal: "N9A 1A1" }),
      "Sud-ouest de l'Ontario — N9",
    );
  });
});
