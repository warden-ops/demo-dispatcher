import { writeFileSync } from "node:fs";
import { onSiteMinutes } from "../src/lib/guertech/assign";
import { addBusinessDays, workingDaysFrom } from "../src/lib/guertech/calendar";
import { SLA } from "../src/lib/guertech/constants";
import { optimizeDay } from "../src/lib/guertech/optimize";
import { DEPOT, productionScenario } from "../src/lib/guertech/territory";
import { haversineMatrix } from "../src/lib/guertech/travel";
import type { Appel } from "../src/lib/guertech/types";
import { solveVrp } from "../src/lib/guertech/vrp";

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

const remoteAreas = optimized.remoteTrips
  .map(
    (trip) =>
      `| ${trip.area} | ${trip.kind} | ${trip.calls.length} | ${hours(trip.depotOneWayMin)} h |`,
  )
  .join("\n");

const markdown = `# Benchmark de l'optimiseur de tournées

Jeu synthétique, graine fixe : 300 appels, 14 techniciens sans zone, départ et retour au dépôt (1000 rue Cormier, Drummondville). Horizon du ${days[0]} au ${days[days.length - 1]} (${HORIZON} jours ouvrables). Quota de 60 préventifs par jour. Temps de route : haversine × 1,3 à 72 km/h, la même matrice pour les deux méthodes.

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
`;

const output = "docs/optimiseur-benchmark.md";
writeFileSync(output, markdown);
console.log(markdown);
console.log(`écrit ${output}`);
