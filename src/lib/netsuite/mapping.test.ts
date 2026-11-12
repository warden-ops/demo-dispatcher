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
import {
  APPELS_SUITEQL,
  APPELS_SUITEQL_TEXT,
  TECHS_SUITEQL,
  TECHS_SUITEQL_PLAIN,
} from "./queries";

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
    assert.equal(appel.scheduledOn, undefined);
    assert.match(appel.magasin, /CS8001/);
  });

  it("garde la date de tâche à part de l'ouverture du cas", () => {
    const appel = mapAppelRow({
      task_id: "42",
      case_id: "43",
      case_type: "7",
      site: "Site",
      address: "450 rue Brock, Drummondville, QC",
      asset: "Espresso",
      tech_id: "9",
      start_time: "08:00",
      start_date: "2026-05-12",
      opened_at: "2026-04-01",
    });
    assert.equal(appel?.scheduledOn, "2026-05-12");
    assert.equal(appel?.openedAt, "2026-04-01");
    assert.equal(appel?.planifie, true);
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

  it("préfère la ville structurée et retombe sur le bloc NetSuite", () => {
    const structured = mapAppelRow({
      task_id: "70",
      case_id: "71",
      case_type: "7",
      site: "Couche-Tard",
      address: "849 SECOND LINE EAST\r\nSAULT STE. MARIE ON P6B 4K5",
      site_city: "Drummondville",
      site_state: "QC",
      site_zip: "J2C 2N6",
      lat: "45.883",
      lng: "-72.484",
    });
    assert.equal(structured?.ville, "Drummondville");
    assert.equal(structured?.region, "Centre-du-Québec");
    assert.equal(structured?.lat, 45.883);
    assert.equal(structured?.lng, -72.484);

    const parsed = mapAppelRow({
      task_id: "72",
      case_id: "73",
      case_type: "6",
      address: "849 SECOND LINE EAST\r\nSAULT STE. MARIE ON P6B 4K5",
    });
    assert.equal(parsed?.ville, "Sault Ste. Marie");
    assert.equal(parsed?.region, "Nord de l'Ontario — P6");
    assert.equal(parsed?.lat, undefined);
  });

  it("donne au technicien la même région qu'un appel de sa ville", () => {
    const tech = mapTechRow({
      id: "77",
      firstname: "Marie",
      lastname: "Roy",
      department: "Atelier",
      location: "Drummondville",
    });
    const appel = mapAppelRow({
      task_id: "74",
      case_id: "75",
      case_type: "7",
      address: "450 RUE BROCK\r\nDRUMMONDVILLE QC J2C 2N6",
    });
    assert.equal(tech?.region, "Centre-du-Québec");
    assert.equal(tech?.region, appel?.region);
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
    assert.match(APPELS_SUITEQL, /entityAddress/);
    assert.match(APPELS_SUITEQL, /site_city/);
    assert.match(APPELS_SUITEQL, /customer_zip/);
    assert.equal(APPELS_SUITEQL_TEXT.includes("entityAddress"), false);
    assert.match(APPELS_SUITEQL_TEXT, /PROD-CASE-%/);
    assert.match(TECHS_SUITEQL, /isinactive = 'F'/);
    assert.match(TECHS_SUITEQL, /location/);
    assert.match(TECHS_SUITEQL_PLAIN, /isinactive = 'F'/);
  });
});
