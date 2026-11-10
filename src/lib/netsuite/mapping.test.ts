import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SKILL_IDS } from "../guertech/constants";
import {
  mapAppelRow,
  mapAppelRows,
  mapCustomerRows,
  mapItemRows,
  mapTechRow,
  mapTechRows,
  villeFromAddress,
} from "./mapping";
import { APPELS_SUITEQL, TECHS_SUITEQL } from "./queries";

describe("mapping SuiteQL", () => {
  it("transforme une tâche Maintenance en appel préventif", () => {
    const appel = mapAppelRow({
      task_id: "9001",
      case_id: "8001",
      casenumber: "CS8001",
      case_type: "6",
      site: "Couche-Tard Drummondville Brock",
      address: "450 rue Brock, Drummondville, QC J2C 2N6",
      asset: "Espresso",
      tech_id: "55",
      start_time: "8:30",
      opened_at: "2026-11-01",
    });
    assert.ok(appel);
    assert.equal(appel.type, "preventif");
    assert.equal(appel.id, "9001");
    assert.equal(appel.netsuiteId, "8001");
    assert.equal(appel.equipementId, 2);
    assert.equal(appel.ville, "Drummondville");
    assert.equal(appel.region, "Centre-du-Québec");
    assert.equal(appel.heure, "08:30");
    assert.equal(appel.techId, "55");
    assert.equal(appel.planifie, true);
    assert.match(appel.magasin, /CS8001/);
  });

  it("classe le type 7 en réactif et ignore les autres types", () => {
    const reactif = mapAppelRow({
      task_id: "12",
      case_id: "13",
      case_type: 7,
      site: "Tim Hortons",
      address: "1500 rue des Forges, Trois-Rivières, QC",
      asset: "Machine inconnue XYZ",
    });
    assert.equal(reactif?.type, "reactif");
    assert.equal(reactif?.equipementId, 0);
    assert.equal(reactif?.region, "Mauricie");
    assert.equal(reactif?.planifie, false);
    assert.equal(mapAppelRow({ task_id: "1", case_type: "5" }), null);
    assert.equal(mapAppelRows([{ task_id: "x", case_type: "6" }]).length, 0);
  });

  it("retire les files d'attente et garde les départements techniques", () => {
    const rows = [
      {
        id: "35274",
        firstname: "Technicien",
        lastname: "Guertech",
        department: "Technique",
      },
      {
        id: "228238",
        firstname: "Technicien",
        lastname: "Laval",
        department: "Technicien mobile",
      },
      {
        id: "77",
        firstname: "Marie",
        lastname: "Roy",
        department: "Atelier",
      },
      {
        id: "88",
        firstname: "Luc",
        lastname: "Gagnon",
        department: "Comptabilité",
      },
    ];
    const techs = mapTechRows(rows);
    assert.deepEqual(
      techs.map((tech) => tech.id),
      ["77"],
    );
    assert.equal(techs[0]?.name, "Marie Roy · Atelier");
    assert.equal(techs[0]?.present, false);
    assert.equal(techs[0]?.region, "");
    assert.equal(techs[0]?.skills.includes(0), true);
    assert.equal(techs[0]?.skills.includes(ALL_SKILL_IDS[0]), true);
    assert.equal(mapTechRow({ id: "9", department: "Ventes" }), null);
  });

  it("lit clients et articles", () => {
    assert.deepEqual(
      mapCustomerRows([{ id: "3", companyname: "IGA", email: "a@b.c" }]),
      [{ id: "3", name: "IGA", email: "a@b.c" }],
    );
    assert.deepEqual(mapItemRows([{ id: "4", itemid: "KIT", itemtype: "InvtPart" }]), [
      { id: "4", name: "KIT", itemType: "InvtPart" },
    ]);
  });

  it("extrait la ville d'une adresse québécoise", () => {
    assert.equal(
      villeFromAddress("820 boulevard Saint-Joseph, Victoriaville, QC"),
      "Victoriaville",
    );
  });

  it("garde le filtre des copies prod dans la requête d'appels", () => {
    assert.match(APPELS_SUITEQL, /t\.status = 'NOTSTART'/);
    assert.match(APPELS_SUITEQL, /custevent_nx_case_type IN \(6, 7\)/);
    assert.match(APPELS_SUITEQL, /s\.status NOT IN \(17, 19, 20\)/);
    assert.match(APPELS_SUITEQL, /PROD-CASE-%/);
    assert.match(APPELS_SUITEQL, /PROD-TASK-%/);
    assert.match(TECHS_SUITEQL, /isinactive = 'F'/);
  });
});
