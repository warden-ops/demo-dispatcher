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

  it("retire la ponctuation finale et remet les accents connus", () => {
    assert.deepEqual(
      parseAddressText("12 BROADWAY\r\nTILLSONBURG. ON N4G 4G8"),
      { ville: "Tillsonburg", province: "ON", postal: "N4G 4G8" },
    );
    assert.equal(
      deriveRegion({ ville: "Tillsonburg", province: "ON", postal: "N4G 4G8" }),
      "Sud-ouest de l'Ontario — N4",
    );
    assert.equal(
      parseAddressText("500 AVENUE BROCHU\r\nSEPT-ILES QC G4S 1A1").ville,
      "Sept-Îles",
    );
    assert.equal(parseAddressText("500 avenue Brochu, Sept-Iles, QC").ville, "Sept-Îles");
    assert.equal(deriveRegion({ ville: "Sept-Iles" }), "Côte-Nord");
    assert.equal(deriveRegion({ ville: "Sept-Îles", postal: "G4S 1A1" }), "Côte-Nord");
    assert.equal(
      parseAddressText("15 MISSION ROAD\r\nWAWA ON P0S 1K0").ville,
      "Wawa",
    );
    assert.equal(
      deriveRegion({ ville: "Wawa", province: "ON", postal: "P0S 1K0" }),
      "Nord de l'Ontario — P0",
    );
    assert.equal(
      parseAddressText("1 MAIN STREET\r\nCORNER BROOK NL A2H 1A1").ville,
      "Corner Brook",
    );
    assert.equal(
      deriveRegion({ ville: "Corner Brook", province: "NL", postal: "A2H 1A1" }),
      "Terre-Neuve-et-Labrador",
    );
    assert.equal(parseAddressText(SAULT).ville, "Sault Ste. Marie");
    assert.deepEqual(parseAddressText("12 COMMERCIAL STREET, GLACE BAY, NS NS"), {
      ville: "Glace Bay",
      province: "NS",
      postal: "",
    });
    assert.deepEqual(parseAddressText("GLACE BAY NS NS B1A 1A1"), {
      ville: "Glace Bay",
      province: "NS",
      postal: "B1A 1A1",
    });
    assert.equal(parseAddressText("55 MAIN STREET\r\nMONCTON NB NB E1C 1A1").ville, "Moncton");
  });

  it("ne classe pas Windsor en Ontario dans l'Estrie", () => {
    assert.equal(deriveRegion({ ville: "Windsor" }), "Estrie");
    assert.equal(
      deriveRegion({ ville: "Windsor", province: "ON", postal: "N9A 1A1" }),
      "Sud-ouest de l'Ontario — N9",
    );
  });
});
