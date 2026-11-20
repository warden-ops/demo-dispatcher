import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SKILL_IDS } from "../guertech/constants";
import {
  classifyTaskRow,
  cleanDetails,
  countExclusions,
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

  it("préremplit le domicile fixe (départ et retour), sinon le dépôt", () => {
    const marier = mapTechRow({ id: "463934", firstname: "Philippe", lastname: "Marier", department: "Technique" });
    assert.equal(marier?.start, "122 rue de la Falaise, Labelle, QC J0T 1H0");
    assert.equal(marier?.end, "122 rue de la Falaise, Labelle, QC J0T 1H0");
    const villeneuve = mapTechRow({ id: "123", firstname: "William", lastname: "Villeneuve", department: "Technique" });
    assert.equal(villeneuve?.start, "212 rue Cartier, Granby, QC J2G 5A6");
    assert.equal(villeneuve?.end, "212 rue Cartier, Granby, QC J2G 5A6");
    const other = mapTechRow({ id: "77", firstname: "Marie", lastname: "Roy", department: "Atelier" });
    assert.equal(other?.start, other?.end);
    assert.match(other?.start ?? "", /Cormier/);
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

  it("garde seulement les tâches Sur place, copies prod ou rafraichissement", () => {
    assert.match(APPELS_SUITEQL, /custevent_nx_task_type = 3/);
    assert.match(APPELS_SUITEQL, /t\.externalid IS NULL AND t\.id <= 567179/);
    assert.match(APPELS_SUITEQL_TEXT, /custevent_nxc_subcontractor_case/);
    assert.match(APPELS_SUITEQL_TEXT, /t\.title AS task_title/);
    assert.equal(APPELS_SUITEQL_TEXT.includes("{JOINS}"), false);
  });

  it("exclut les tâches sous-traitées et le client Atelier", () => {
    const base = { task_id: "1", case_id: "2", case_type: "7", address: "1 rue A, Granby QC" };
    const sub = { ...base, tech_id: "35274", subcontractor_case: "T" };
    const vendor = { ...base, task_id: "3", tech_id: "35274", subcontractor_case: "F", subcontractor_id: "991" };
    const atelier = { ...base, task_id: "4", customer: "Atelier", site: "Appel de service 66386 Atelier | Site" };
    const free = { ...base, task_id: "5", tech_id: "35274", subcontractor_case: "F" };
    const nobody = { ...base, task_id: "6" };
    const pinned = { ...base, task_id: "7", tech_id: "124", start_time: "09:00" };
    assert.equal(classifyTaskRow(sub), "sous-traitant");
    assert.equal(classifyTaskRow(vendor), "sous-traitant");
    assert.equal(classifyTaskRow(atelier), "atelier");
    assert.equal(mapAppelRow(sub), null);
    assert.equal(mapAppelRow(atelier), null);
    const kept = mapAppelRows([sub, vendor, atelier, free, nobody, pinned]);
    assert.deepEqual(kept.map((a) => [a.id, a.planifie]), [["5", false], ["6", false], ["7", true]]);
    assert.deepEqual(countExclusions([sub, vendor, atelier, free]), { "sous-traitant": 2, atelier: 1 });
  });

  it("remplit l'aperçu de la tâche (titre, cas, équipement, statut, priorité, détail)", () => {
    const appel = mapAppelRow({
      task_id: "566756",
      task_title: "Sur place 566756 COUCHE-TARD INC - LAVAL : CT734 | Site",
      case_id: "563834",
      casenumber: "CASE18495",
      case_type: "7",
      case_status: "À Finaliser",
      priority_label: "P2",
      equipment: "Espresso | BW3 | BW136262",
      details: "[Synchro prod CASE18495 id 563834]\n09/11 RECALL : Impossible<br><br>L'unité affiche un défaut",
      site: "Billable 473047 COUCHE-TARD INC - LAVAL : CT734 | Site",
      address: "223 Rue Saint-Hubert\nGRANBY QC J2G 5M9",
      tech_id: "35274",
      opened_at: "2026-11-03",
    });
    assert.ok(appel);
    assert.equal(appel.magasin, "Sur place 566756 COUCHE-TARD INC - LAVAL : CT734 | Site");
    assert.equal(appel.numeroCas, "CASE18495");
    assert.equal(appel.statutCas, "À Finaliser");
    assert.equal(appel.priorite, "P2");
    assert.equal(appel.equipementDetail, "Espresso · BW3 · BW136262");
    assert.equal(appel.details, "09/11 RECALL : Impossible\nL'unité affiche un défaut");
    assert.equal(appel.planifie, false);
    assert.equal(cleanDetails("a &amp; b<br/>c"), "a & b\nc");
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
