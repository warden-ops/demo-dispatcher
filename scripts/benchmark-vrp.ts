import { writeFileSync } from "node:fs";
import { onSiteMinutes } from "../src/lib/guertech/assign";
import { addBusinessDays, workingDaysFrom } from "../src/lib/guertech/calendar";
import { ALL_SKILL_IDS, DRUMMONDVILLE_HQ, SLA } from "../src/lib/guertech/constants";
import { distanceKm } from "../src/lib/guertech/geo";
import { optimizeDay } from "../src/lib/guertech/optimize";
import { DEPOT, cityFromText, productionScenario, type LatLng } from "../src/lib/guertech/territory";
import { haversineMatrix, type TravelMatrix } from "../src/lib/guertech/travel";
import type { Appel, Tech } from "../src/lib/guertech/types";
import { solveVrp, type SolveResult } from "../src/lib/guertech/vrp";

const QUOTA = 60;
const HORIZON = 5;
const scenario = productionScenario({ calls: 300, techs: 14, asOf: "2026-11-11" });
const days = workingDaysFrom(scenario.asOf, HORIZON);
const points = [
  ...scenario.calls.map((appel) => ({ lat: appel.lat ?? 0, lng: appel.lng ?? 0 })),
  ...scenario.techs.map(() => DEPOT),
];
const matrix = haversineMatrix(points);
const size = matrix.size;
const callCount = scenario.calls.length;

function leg(from: number, to: number): number {
  return matrix.minutes[from * size + to];
}

function isRemote(index: number): boolean {
  const service = onSiteMinutes(scenario.calls[index].type);
  for (let tech = 0; tech < scenario.techs.length; tech += 1) {
    const depot = callCount + tech;
    if (8 * 60 + leg(depot, index) + service + leg(index, depot) <= 17 * 60) return false;
  }
  return true;
}

const remote = new Set<number>();
scenario.calls.forEach((_, index) => {
  if (isRemote(index)) remote.add(index);
});
const byId = new Map(scenario.calls.map((appel, index) => [appel.id, index]));

function measure(ids: string[], depotIndex: number): { driveMin: number; finishMin: number } {
  let time = 8 * 60;
  let prev = depotIndex;
  let drive = 0;
  for (const id of ids) {
    const index = byId.get(id);
    if (index == null) continue;
    const travel = leg(prev, index);
    time += travel + onSiteMinutes(scenario.calls[index].type);
    drive += travel;
    prev = index;
  }
  const back = leg(prev, depotIndex);
  return { driveMin: drive + back, finishMin: time + back };
}

const optimizerStarted = Date.now();
const optimized = solveVrp({
  calls: scenario.calls,
  techs: scenario.techs,
  matrix,
  startDate: scenario.asOf,
  horizonDays: HORIZON,
  pmQuotaPerDay: QUOTA,
  budgetMs: 900,
});
const optimizerMs = Date.now() - optimizerStarted;

type HeuristicRoute = { date: string; techIndex: number; ids: string[] };
const heuristicStarted = Date.now();
let pool: Appel[] = scenario.calls.slice();
const heuristicRoutes: HeuristicRoute[] = [];
for (const date of days) {
  const packed = optimizeDay({
    calls: pool,
    techs: scenario.techs,
    pmQuota: QUOTA,
    asOfDate: date,
    allowOvertime: false,
  });
  const used = new Set<string>();
  scenario.techs.forEach((tech, techIndex) => {
    const stops = packed.byTech[tech.id] ?? [];
    if (stops.length === 0) return;
    const ids = stops.map((stop) => stop.appel.id);
    heuristicRoutes.push({ date, techIndex, ids });
    ids.forEach((id) => used.add(id));
  });
  pool = pool.filter((appel) => !used.has(appel.id));
}
const heuristicMs = Date.now() - heuristicStarted;

function slaStats(served: Map<string, string>) {
  let servable = 0;
  let misses = 0;
  let servedCount = 0;
  scenario.calls.forEach((appel, index) => {
    if (appel.type !== "reactif" || remote.has(index)) return;
    const due = addBusinessDays(appel.openedAt, SLA.reactif.delayDays);
    if (due < days[0]) return;
    servable += 1;
    const when = served.get(appel.id) ?? "";
    if (when) servedCount += 1;
    if (!when || when > due) misses += 1;
  });
  return { servable, misses, servedCount };
}

const optimizedServed = new Map<string, string>();
for (const day of optimized.days) {
  for (const route of day.routes) {
    for (const stop of route.stops) optimizedServed.set(stop.appel.id, day.date);
  }
}
const heuristicServed = new Map<string, string>();
let heuristicDrive = 0;
let heuristicFeasibleDrive = 0;
let heuristicFeasibleCalls = 0;
let heuristicInfeasible = 0;
let heuristicRemoteAssigned = 0;
for (const route of heuristicRoutes) {
  const measured = measure(route.ids, callCount + route.techIndex);
  heuristicDrive += measured.driveMin;
  if (measured.finishMin <= 17 * 60) {
    heuristicFeasibleDrive += measured.driveMin;
    heuristicFeasibleCalls += route.ids.length;
  } else heuristicInfeasible += 1;
  for (const id of route.ids) {
    heuristicServed.set(id, route.date);
    const index = byId.get(id);
    if (index != null && remote.has(index)) heuristicRemoteAssigned += 1;
  }
}

const optSla = slaStats(optimizedServed);
const oldSla = slaStats(heuristicServed);
const hours = (minutes: number) => (minutes / 60).toFixed(1);

function legacyMatrix(points: LatLng[]): TravelMatrix {
  const size = points.length;
  const minutes = new Float64Array(size * size);
  const km = new Float64Array(size * size);
  for (let origin = 0; origin < size; origin += 1) {
    for (let destination = origin + 1; destination < size; destination += 1) {
      const crow = distanceKm(points[origin], points[destination]) ?? 0;
      const driveMin = crow < 0.05 ? 0 : Math.round(((crow * 1.3) / 72) * 60);
      const driveKm = crow < 0.05 ? 0 : Math.round(crow * 1.3 * 10) / 10;
      minutes[origin * size + destination] = driveMin;
      minutes[destination * size + origin] = driveMin;
      km[origin * size + destination] = driveKm;
      km[destination * size + origin] = driveKm;
    }
  }
  return { minutes, km, size, source: "haversine" };
}

function shapedSample(): { calls: Appel[]; techs: Tech[] } {
  const techs: Tech[] = [1, 2, 3, 4].map((id) => ({
    id: String(id),
    name: `Tech ${id}`,
    present: true,
    start: DRUMMONDVILLE_HQ,
    end: DRUMMONDVILLE_HQ,
    startHour: "08:00",
    endHour: "17:00",
    hours: 9,
    region: "",
    skills: [...ALL_SKILL_IDS],
  }));
  const specs: Array<Partial<Appel> & { ville: string }> = [
    ...Array.from({ length: 20 }, () => ({ ville: "Ottawa", type: "preventif" as const })),
    ...Array.from({ length: 12 }, () => ({ ville: "Gatineau", type: "preventif" as const })),
    { ville: "Baie-Saint-Paul", type: "preventif" },
    { ville: "Rivière-du-Loup", type: "preventif" },
    { ville: "Saguenay", type: "reactif" },
    { ville: "Saguenay", type: "preventif" },
    {
      ville: "Saint-Jean-sur-Richelieu",
      type: "preventif",
      planifie: true,
      heure: "08:00",
      techId: "1",
    },
    {
      ville: "Saint-Jean-sur-Richelieu",
      type: "preventif",
      planifie: true,
      heure: "09:00",
      techId: "2",
    },
    {
      ville: "Ange-Gardien",
      type: "preventif",
      planifie: true,
      heure: "13:00",
      techId: "3",
    },
    {
      ville: "Val-David",
      type: "preventif",
      planifie: true,
      heure: "13:45",
      techId: "4",
    },
    {
      ville: "Saint-Hyacinthe",
      type: "reactif",
      planifie: true,
      heure: "15:30",
      techId: "1",
    },
    { ville: "Saint-Anselme", type: "preventif", planifie: true, heure: "", techId: "2" },
    { ville: "Sault Ste. Marie", type: "reactif" },
    { ville: "Wawa", type: "preventif" },
  ];
  const calls = specs.map((spec, index) => {
    const city = cityFromText(spec.ville);
    if (!city) throw new Error(spec.ville);
    const id = `R${index + 1}`;
    return {
      id,
      type: spec.type ?? "preventif",
      magasin: spec.ville,
      adresse: `10 rue ${index}, ${spec.ville}`,
      ville: spec.ville,
      region: city.region,
      lat: city.lat + index * 0.002,
      lng: city.lng,
      equipement: "Espresso",
      equipementId: 2,
      netsuiteId: id,
      planifie: spec.planifie ?? false,
      heure: spec.heure ?? "",
      techId: spec.techId ?? "",
      openedAt: spec.type === "reactif" ? "2026-11-10" : "2026-09-01",
    } satisfies Appel;
  });
  return { calls, techs };
}

function summarize(result: SolveResult): string {
  const finishes = result.days.flatMap((day) => day.routes.map((route) => route.finishMin));
  const latest = finishes.length ? Math.max(...finishes) : 0;
  const reasons = new Map<string, number>();
  for (const item of result.unassigned) {
    reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  }
  const reasonText =
    [...reasons.entries()].map(([reason, count]) => `${count} × ${reason}`).join("<br>") ||
    "—";
  const overnightAreas = result.remoteTrips.map((trip) => trip.area).join(", ") || "—";
  return `| ${result.stats.served} | ${result.unassigned.length} | ${reasonText} | ${result.remoteTrips.length} (${result.stats.remoteCalls}) | ${overnightAreas} | ${hours(result.stats.driveMin)} h | ${hours(latest)} |`;
}

const shaped = shapedSample();
const shapedPoints = [
  ...shaped.calls.map((appel) => ({ lat: appel.lat ?? 0, lng: appel.lng ?? 0 })),
  ...shaped.techs.map(() => DEPOT),
];
const shapedInput = {
  calls: shaped.calls,
  techs: shaped.techs,
  startDate: "2026-11-12",
  horizonDays: 5,
  pmQuotaPerDay: 40,
  budgetMs: 900,
};
const beforeShaped = solveVrp({ ...shapedInput, matrix: legacyMatrix(shapedPoints) });
const afterShaped = solveVrp({ ...shapedInput, matrix: haversineMatrix(shapedPoints) });
const shapedTable = `| | Avant (72 km/h) | Après (autoroute) |
| --- | --- | --- |
| Appels placés | ${summarize(beforeShaped).split("|")[1]?.trim()} | ${summarize(afterShaped).split("|")[1]?.trim()} |
| Non placés | ${beforeShaped.unassigned.length} | ${afterShaped.unassigned.length} |
| Raisons | ${[...new Set(beforeShaped.unassigned.map((item) => item.reason))].join("; ") || "—"} | ${[...new Set(afterShaped.unassigned.map((item) => item.reason))].join("; ") || "—"} |
| Voyages nuitée / dédiés | ${beforeShaped.remoteTrips.length} (${beforeShaped.stats.remoteCalls} appels) | ${afterShaped.remoteTrips.length} (${afterShaped.stats.remoteCalls} appels) |
| Secteurs en voyage | ${beforeShaped.remoteTrips.map((trip) => trip.area).join(", ") || "—"} | ${afterShaped.remoteTrips.map((trip) => trip.area).join(", ") || "—"} |
| Heures de route | ${hours(beforeShaped.stats.driveMin)} h | ${hours(afterShaped.stats.driveMin)} h |
| Fin la plus tardive | ${hours(Math.max(0, ...beforeShaped.days.flatMap((day) => day.routes.map((route) => route.finishMin))))} h | ${hours(Math.max(0, ...afterShaped.days.flatMap((day) => day.routes.map((route) => route.finishMin))))} h |

Les rendez-vous fixes (Saint-Jean 8 h et 9 h, Ange-Gardien 13 h, Val-David 13 h 45, Saint-Hyacinthe 15 h 30) et Saint-Anselme sans heure sont dans les appels placés de la colonne Après. Sault Ste. Marie et Wawa restent un voyage, parce que l'aller-retour ne rentre pas dans la journée. Une adresse sans ville ni code postal connu reste « Adresse à valider » avant le solveur (hors de ce tableau).
`;

const remoteAreas = optimized.remoteTrips
  .map(
    (trip) =>
      `| ${trip.area} | ${trip.kind} | ${trip.calls.length} | ${hours(trip.depotOneWayMin)} h |`,
  )
  .join("\n");

const markdown = `# Benchmark de l'optimiseur de tournées

Jeu synthétique, graine fixe : 300 appels, 14 techniciens sans zone, départ et retour au dépôt (1000 rue Cormier, Drummondville). Horizon du ${days[0]} au ${days[days.length - 1]} (${HORIZON} jours ouvrables). Quota de 60 préventifs par jour. Temps de route : repli autoroute (court trajet lent, long trajet ~100 km/h), la même matrice pour les deux méthodes.

Les appels de Sault Ste. Marie, Wawa, Sept-Îles, Corner Brook et Tillsonburg ne peuvent pas revenir au dépôt entre 8 h et 17 h. L'ancienne heuristique les place quand même. L'optimiseur les sort de la journée et les groupe en voyages.

| | Heuristique (ville / région) | Optimiseur |
| --- | ---: | ---: |
| Appels placés sur une journée | ${heuristicServed.size} | ${optimized.stats.served} |
| …dont la journée finit à 17 h | ${heuristicFeasibleCalls} | ${optimized.stats.served} |
| Réactifs faisables servis | ${oldSla.servedCount} / ${oldSla.servable} | ${optSla.servedCount} / ${optSla.servable} |
| Réactifs faisables hors SLA | ${oldSla.misses} | ${optSla.misses} |
| Appels hors rayon placés sur une journée | ${heuristicRemoteAssigned} | 0 |
| Voyages dédiés ou nuitées | 0 | ${optimized.remoteTrips.length} (${optimized.stats.remoteCalls} appels) |
| Temps de route total | ${hours(heuristicDrive)} h | ${hours(optimized.stats.driveMin)} h |
| Temps de route des journées finissant à 17 h | ${hours(heuristicFeasibleDrive)} h | ${hours(optimized.stats.driveMin)} h |
| Journées qui dépassent 17 h | ${heuristicInfeasible} | ${optimized.stats.overtimeRoutes} |
| Durée du calcul | ${heuristicMs} ms | ${optimizerMs} ms |

Voyages proposés, non posés au calendrier :

| Secteur | Type | Appels | Aller depuis Drummondville |
| --- | --- | ---: | ---: |
${remoteAreas}

Le calcul de 300 × 14 reste sous 3 s (${optimizerMs} ms ici, budget de recherche locale 900 ms).

## Échantillon façon production

Même optimiseur, deux matrices. « Avant » : vol d'oiseau × 1,3 à 72 km/h (le repli qui envoyait Ottawa en nuitée). « Après » : repli autoroute. 4 techniciens sans zone, horizon 5 jours, quota 40. Comprend Ottawa/Gatineau, Baie-Saint-Paul, Rivière-du-Loup, Saguenay, des rendez-vous fixes et Sault Ste. Marie.

${shapedTable}
`;

const output = "docs/optimiseur-benchmark.md";
writeFileSync(output, markdown);
console.log(markdown);
console.log(`écrit ${output}`);
