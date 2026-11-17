import type { EnvMap } from "../netsuite/config";
import { geocodeAppels } from "../netsuite/geocode";
import type { Appel, PlanStats, RemoteTrip, Tech, Unassigned } from "./types";
import { pointForAppel, pointForStart, type LatLng } from "./territory";
import { splitRoadTechs, TECH_PROFILES, type ProfileMap } from "./tech-profiles";
import { buildTravelMatrix } from "./travel";
import { solveVrp, type PlannedRoute } from "./vrp";

export type DispatchPlan = {
  days: Array<{ date: string; routes: PlannedRoute[] }>;
  unassigned: Unassigned[];
  remoteTrips: RemoteTrip[];
  stats: PlanStats;
};

export async function planDispatch(input: {
  calls: Appel[];
  techs: Tech[];
  startDate: string;
  horizonDays?: number;
  pmQuotaPerDay?: number;
  durations?: { preventif: number; reactif: number };
  allowOvertime?: boolean;
  moveAssigned?: boolean;
  /** Envoyer aussi les techniciens d'atelier sur la route. */
  includeWorkshop?: boolean;
  /** Profils (secteurs, rôle). Par défaut : profils tirés de NetSuite. Passer {} pour les ignorer. */
  profiles?: ProfileMap;
  env?: EnvMap;
  fetchImpl?: typeof fetch;
}): Promise<DispatchPlan> {
  const env = input.env ?? {};
  const fetchImpl = input.fetchImpl ?? fetch;
  const profiles = input.profiles ?? TECH_PROFILES;
  const split = splitRoadTechs(
    input.techs.filter((tech) => tech.present),
    input.calls,
    { includeWorkshop: input.includeWorkshop, profiles },
  );
  const present = split.road;
  const geocodeStarted = Date.now();
  const geocoded = await geocodeAppels(
    input.calls,
    env,
    fetchImpl,
    geocodeStarted,
    { maxLookups: 40, budgetMs: 1_200 },
  );
  const located: Appel[] = [];
  const missing: Unassigned[] = [];
  const points: LatLng[] = [];
  for (const appel of geocoded) {
    const point = pointForAppel(appel);
    if (!point) {
      missing.push({
        appel,
        reason: "Adresse à valider",
      });
      continue;
    }
    located.push({ ...appel, lat: point.lat, lng: point.lng });
    points.push(point);
  }
  for (const tech of present) points.push(pointForStart(tech.start));

  const travelStarted = Date.now();
  const matrix = await buildTravelMatrix(points, {
    env,
    fetchImpl,
    budgetMs: 8_000,
    now: travelStarted,
  });
  const travelMs = Date.now() - travelStarted;
  const solved = solveVrp({
    calls: located,
    techs: present,
    matrix,
    startDate: input.startDate,
    horizonDays: input.horizonDays,
    pmQuotaPerDay: input.pmQuotaPerDay,
    durations: input.durations,
    allowOvertime: input.allowOvertime,
    moveAssigned: input.moveAssigned,
    budgetMs: 900,
    profiles,
    pinOnlyTechIds: split.pinOnly,
  });

  return {
    days: solved.days,
    unassigned: [...missing, ...solved.unassigned],
    remoteTrips: solved.remoteTrips,
    stats: {
      ...solved.stats,
      travelMs,
      travelSource: matrix.source,
      ...(matrix.warning ? { travelWarning: matrix.warning } : {}),
      excludedTechs: split.excluded,
    },
  };
}
