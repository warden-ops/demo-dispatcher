import { DRUMMONDVILLE_HQ } from "./constants";
import type { EnvMap } from "../netsuite/config";
import { geocodeAppels } from "../netsuite/geocode";
import type { Appel, PlanStats, RemoteTrip, Tech, Unassigned } from "./types";
import { pointForAppel, type LatLng } from "./territory";
import { splitRoadTechs, TECH_PROFILES, type ProfileMap } from "./tech-profiles";
import { TECH_BASES, type TechBase } from "./tech-bases.data";
import { resolveTechEndpoints, type ResolvedEndpoint } from "./tech-endpoints";
import { TECH_HOME_BASES, type HomeBase } from "./tech-home-bases";
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
  /**
   * Domiciles fixes (départ et retour) confirmés par Guertech. Par défaut :
   * TECH_HOME_BASES. Passer {} pour faire partir et revenir tout le monde au
   * dépôt. Une adresse saisie dans la liste des techniciens a toujours priorité.
   */
  homeBases?: Record<string, HomeBase>;
  /**
   * Départs estimés (premier arrêt habituel de la journée). Désactivés par
   * défaut depuis les domiciles confirmés ; true pour les réactiver.
   */
  useEstimatedStarts?: boolean;
  /** Départs estimés à utiliser quand useEstimatedStarts est vrai. Par défaut : TECH_BASES. */
  bases?: Record<string, TechBase>;
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
  const homeBases = input.homeBases ?? TECH_HOME_BASES;
  const estimatedBases = input.useEstimatedStarts ? (input.bases ?? TECH_BASES) : {};
  const endpoints = present.map((tech) =>
    resolveTechEndpoints(tech, { homeBases, estimatedBases }, TECH_HOME_BASES),
  );
  for (const { start } of endpoints) points.push({ lat: start.lat, lng: start.lng });
  // Points d'arrivée séparés seulement si au moins un retour diffère du départ.
  const separateEnds = endpoints.some(
    ({ start, end }) => start.lat !== end.lat || start.lng !== end.lng,
  );
  if (separateEnds) {
    for (const { end } of endpoints) points.push({ lat: end.lat, lng: end.lng });
  }
  const estimatedStarts: NonNullable<PlanStats["estimatedStarts"]> = [];
  const techEndpoints: NonNullable<PlanStats["techEndpoints"]> = [];
  const addressWarnings: string[] = [];
  present.forEach((tech, index) => {
    const { start, end } = endpoints[index];
    if (start.kind === "estimé") {
      estimatedStarts.push({ id: tech.id, name: tech.name, label: start.label });
    }
    techEndpoints.push({
      id: tech.id,
      name: tech.name,
      start: describeEndpoint(start),
      end: describeEndpoint(end),
      startKind: start.kind,
      endKind: end.kind,
      startAddress: start.address,
      endAddress: end.address,
    });
    const who = tech.name.split(" · ")[0];
    if (start.unresolved) {
      addressWarnings.push(`${who} : départ « ${start.unresolved} » non reconnu, dépôt utilisé`);
    }
    if (end.unresolved) {
      addressWarnings.push(`${who} : arrivée « ${end.unresolved} » non reconnue, dépôt utilisé`);
    }
  });

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
      ...(estimatedStarts.length ? { estimatedStarts } : {}),
      techEndpoints,
      ...(addressWarnings.length ? { addressWarnings } : {}),
    },
  };
}

function describeEndpoint(point: ResolvedEndpoint): string {
  if (point.kind === "dépôt") return "Dépôt";
  if (point.kind === "domicile") return `Domicile (${point.label})`;
  if (point.kind === "estimé") return `Estimé (${point.label})`;
  return point.label;
}

/** Départ laissé au dépôt (valeur par défaut). */
export function startsAtDepot(start: string | undefined): boolean {
  const text = (start ?? "").trim().toLowerCase();
  return !text || text === DRUMMONDVILLE_HQ.toLowerCase();
}
