export type GeoPoint = {
  lat?: number;
  lng?: number;
};

export function distanceKm(a: GeoPoint, b: GeoPoint): number | null {
  if (
    a.lat == null ||
    a.lng == null ||
    b.lat == null ||
    b.lng == null ||
    !Number.isFinite(a.lat) ||
    !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lng)
  ) {
    return null;
  }
  const earthKm = 6371;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestStopKm(origin: GeoPoint, stops: GeoPoint[]): number | null {
  let best: number | null = null;
  for (const stop of stops) {
    const distance = distanceKm(origin, stop);
    if (distance == null) continue;
    if (best == null || distance < best) best = distance;
  }
  return best;
}

/** Plus haut score d'abord. À score égal, le point le plus proche gagne. */
export function compareScoreThenDistance(
  a: { score: number; distanceKm: number | null },
  b: { score: number; distanceKm: number | null },
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.distanceKm == null && b.distanceKm == null) return 0;
  if (a.distanceKm == null) return 1;
  if (b.distanceKm == null) return -1;
  return a.distanceKm - b.distanceKm;
}
