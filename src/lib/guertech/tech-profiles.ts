import { distanceKm, type GeoPoint } from "./geo";
import { TECH_PROFILES, type TechProfile, type TechZoneAnchor } from "./tech-profiles.data";
import type { Appel, Tech } from "./types";

export { NETSUITE_DURATION_MEDIANS, TECH_PROFILES } from "./tech-profiles.data";
export type { TechProfile, TechRole, TechZoneAnchor } from "./tech-profiles.data";

/** Pénalité maximale (en minutes équivalentes) pour un appel hors des secteurs habituels. */
export const ZONE_SOFT_MAX_MIN = 60;
/** Marge autour du rayon d'un secteur avant que la pénalité commence. */
const ZONE_MARGIN_KM = 15;
const ZONE_BASE_MIN = 10;
const ZONE_PER_KM = 0.3;

export type ProfileMap = Record<string, TechProfile>;

export function profileFor(
  techId: string,
  profiles: ProfileMap = TECH_PROFILES,
): TechProfile | undefined {
  return profiles[techId];
}

/** Secteur habituel le plus proche, ou null si le technicien n'a pas d'historique. */
export function nearestAnchor(
  profile: TechProfile | undefined,
  point: GeoPoint,
): { anchor: TechZoneAnchor; beyondKm: number } | null {
  if (!profile || profile.anchors.length === 0) return null;
  let best: { anchor: TechZoneAnchor; beyondKm: number } | null = null;
  for (const anchor of profile.anchors) {
    const km = distanceKm(anchor, point);
    if (km == null) continue;
    const beyondKm = Math.max(0, km - anchor.radiusKm - ZONE_MARGIN_KM);
    if (!best || beyondKm < best.beyondKm) best = { anchor, beyondKm };
  }
  return best;
}

/**
 * Pénalité douce : 0 dans un secteur habituel (rayon + 15 km), puis 10 min
 * plus 0,3 min par km au-delà, plafonnée à 60 min. Un technicien sans
 * historique n'est pas pénalisé. Ce n'est jamais une interdiction.
 */
export function zoneSoftPenalty(profile: TechProfile | undefined, point: GeoPoint): number {
  const nearest = nearestAnchor(profile, point);
  if (!nearest || nearest.beyondKm <= 0) return 0;
  return Math.min(ZONE_SOFT_MAX_MIN, ZONE_BASE_MIN + nearest.beyondKm * ZONE_PER_KM);
}

export type RoadTechSplit = {
  /** Techniciens envoyés sur la route. */
  road: Tech[];
  /** Techniciens d'atelier gardés seulement pour leurs rendez-vous déjà attribués. */
  pinOnly: string[];
  /** Techniciens retirés de la planification route, avec la raison. */
  excluded: Array<{ id: string; name: string; reason: string }>;
};

/**
 * Les profils « atelier » et « doublon » ne reçoivent pas de tournée route,
 * sauf si includeWorkshop est vrai. Un rendez-vous déjà attribué à l'un
 * d'eux reste à lui (il est gardé pour ce rendez-vous seulement).
 */
export function splitRoadTechs(
  techs: Tech[],
  calls: Appel[],
  options?: { includeWorkshop?: boolean; profiles?: ProfileMap },
): RoadTechSplit {
  const profiles = options?.profiles ?? TECH_PROFILES;
  if (options?.includeWorkshop) return { road: techs, pinOnly: [], excluded: [] };
  const owners = new Set(
    calls.filter((appel) => appel.planifie && appel.techId).map((appel) => appel.techId),
  );
  const road: Tech[] = [];
  const pinOnly: string[] = [];
  const excluded: RoadTechSplit["excluded"] = [];
  for (const tech of techs) {
    const role = profiles[tech.id]?.role ?? "route";
    if (role === "route") {
      road.push(tech);
      continue;
    }
    const reason =
      role === "atelier"
        ? "Technicien d'atelier (historique NetSuite) : pas de tournée route."
        : "Compte en double d'un autre technicien : pas de tournée route.";
    if (owners.has(tech.id)) {
      road.push(tech);
      pinOnly.push(tech.id);
      excluded.push({ id: tech.id, name: tech.name, reason: `${reason} Gardé pour ses rendez-vous.` });
    } else {
      excluded.push({ id: tech.id, name: tech.name, reason });
    }
  }
  return { road, pinOnly, excluded };
}
