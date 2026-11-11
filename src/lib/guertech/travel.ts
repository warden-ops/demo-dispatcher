import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { distanceKm } from "./geo";
import type { LatLng } from "./territory";
import { readEnvValue, type EnvMap } from "../netsuite/config";

/** Facteur route / vol d'oiseau, vitesse moyenne hors autoroute urbaine. */
export const ROAD_FACTOR = 1.3;
export const ROAD_SPEED_KMH = 72;

const MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const PAIR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TravelMatrix = {
  minutes: Float64Array;
  km: Float64Array;
  size: number;
  source: "haversine" | "google" | "mixed";
};

type Pair = { minutes: number; km: number; expiresAt: number };

const memoryPairs = new Map<string, Pair>();
let loadedPath = "";

export function clearTravelCache(): void {
  memoryPairs.clear();
  loadedPath = "";
}

export function travelMinutesFromKm(km: number): number {
  if (km < 0.05) return 0;
  return Math.max(1, Math.round(((km * ROAD_FACTOR) / ROAD_SPEED_KMH) * 60));
}

export function roadKm(km: number): number {
  if (km < 0.05) return 0;
  return Math.round(km * ROAD_FACTOR * 10) / 10;
}

function pairKey(origin: LatLng, destination: LatLng): string {
  return `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}>${destination.lat.toFixed(3)},${destination.lng.toFixed(3)}`;
}

export function haversineMatrix(points: LatLng[]): TravelMatrix {
  const size = points.length;
  const minutes = new Float64Array(size * size);
  const km = new Float64Array(size * size);
  for (let origin = 0; origin < size; origin += 1) {
    for (let destination = origin + 1; destination < size; destination += 1) {
      const crow = distanceKm(points[origin], points[destination]) ?? 0;
      const driveKm = roadKm(crow);
      const driveMin = travelMinutesFromKm(crow);
      minutes[origin * size + destination] = driveMin;
      minutes[destination * size + origin] = driveMin;
      km[origin * size + destination] = driveKm;
      km[destination * size + origin] = driveKm;
    }
  }
  return { minutes, km, size, source: "haversine" };
}

function diskFile(env: EnvMap): string | null {
  if (readEnvValue(env, "ROUTE_MATRIX_CACHE_DISABLE") === "1") return null;
  const configured = readEnvValue(env, "ROUTE_MATRIX_CACHE_PATH");
  if (configured) return configured;
  if (process.env.NODE_TEST_CONTEXT) return null;
  return path.join(process.cwd(), ".cache", "route-matrix.json");
}

async function ensureDisk(env: EnvMap, now: number): Promise<void> {
  const file = diskFile(env);
  if (!file || loadedPath === file) return;
  loadedPath = file;
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { pairs?: Record<string, Pair> };
    for (const [key, entry] of Object.entries(parsed.pairs ?? {})) {
      if (!entry || entry.expiresAt <= now) continue;
      if (!Number.isFinite(entry.minutes) || !Number.isFinite(entry.km)) continue;
      memoryPairs.set(key, entry);
    }
  } catch {
    // pas de cache disque
  }
}

async function persistDisk(env: EnvMap): Promise<void> {
  const file = diskFile(env);
  if (!file) return;
  const pairs: Record<string, Pair> = {};
  for (const [key, entry] of memoryPairs) pairs[key] = entry;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ pairs }), "utf8");
  } catch {
    // le calcul haversine reste disponible
  }
}

type MatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  distanceMeters?: number;
  duration?: string;
  condition?: string;
};

function parseDurationSeconds(value?: string): number {
  if (!value) return 0;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) return 0;
  return Math.round(Number(match[1]));
}

export async function fetchGoogleMatrix(options: {
  origins: LatLng[];
  destinations: LatLng[];
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ origin: number; destination: number; minutes: number; km: number }>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(MATRIX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": options.apiKey,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify({
        origins: options.origins.map((point) => ({
          waypoint: {
            location: {
              latLng: { latitude: point.lat, longitude: point.lng },
            },
          },
        })),
        destinations: options.destinations.map((point) => ({
          waypoint: {
            location: {
              latLng: { latitude: point.lat, longitude: point.lng },
            },
          },
        })),
        travelMode: "DRIVE",
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as MatrixElement[] | { error?: unknown };
    if (!Array.isArray(payload)) return [];
    const pairs: Array<{ origin: number; destination: number; minutes: number; km: number }> = [];
    for (const element of payload) {
      if (element.condition === "ROUTE_NOT_FOUND") continue;
      const origin = element.originIndex;
      const destination = element.destinationIndex;
      if (origin == null || destination == null) continue;
      const seconds = parseDurationSeconds(element.duration);
      const meters = element.distanceMeters ?? 0;
      if (origin !== destination && seconds <= 0 && meters <= 0) continue;
      pairs.push({
        origin,
        destination,
        minutes: Math.round(seconds / 60),
        km: Math.round((meters / 1000) * 10) / 10,
      });
    }
    return pairs;
  } catch {
    return [];
  }
}

function remember(
  origin: LatLng,
  destination: LatLng,
  minutes: number,
  km: number,
  now: number,
): void {
  memoryPairs.set(pairKey(origin, destination), {
    minutes,
    km,
    expiresAt: now + PAIR_TTL_MS,
  });
}

function recall(
  origin: LatLng,
  destination: LatLng,
  now: number,
): { minutes: number; km: number } | null {
  const entry = memoryPairs.get(pairKey(origin, destination));
  if (!entry || entry.expiresAt <= now) return null;
  return { minutes: entry.minutes, km: entry.km };
}

function clusterKey(point: LatLng): string {
  return `${(Math.round(point.lat * 20) / 20).toFixed(2)},${(Math.round(point.lng * 20) / 20).toFixed(2)}`;
}

function parseClusterKey(key: string): LatLng {
  const [lat, lng] = key.split(",").map(Number);
  return { lat, lng };
}

/**
 * Matrice de temps. Haversine × facteur route tout de suite.
 * Avec une clé, une matrice Google complète jusqu'à 25 points, sinon une
 * calibration par secteurs (~5 km) dans le budget. Le reste reste haversine.
 */
export async function buildTravelMatrix(
  points: LatLng[],
  options?: {
    env?: EnvMap;
    fetchImpl?: typeof fetch;
    budgetMs?: number;
    now?: number;
  },
): Promise<TravelMatrix> {
  const matrix = haversineMatrix(points);
  const env = options?.env ?? {};
  const apiKey =
    readEnvValue(env, "GOOGLE_MAPS_SERVER_API_KEY") ||
    readEnvValue(env, "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
  const now = options?.now ?? Date.now();
  await ensureDisk(env, now);
  if (!apiKey || points.length < 2) return matrix;

  const deadline = now + (options?.budgetMs ?? 1500);
  let googleCells = 0;
  const size = points.length;

  const applyPair = (
    originIndex: number,
    destinationIndex: number,
    minutes: number,
    km: number,
  ) => {
    if (originIndex === destinationIndex) return;
    matrix.minutes[originIndex * size + destinationIndex] = minutes;
    matrix.km[originIndex * size + destinationIndex] = km;
    remember(points[originIndex], points[destinationIndex], minutes, km, now);
    googleCells += 1;
  };

  const cached = (origin: number, destination: number): boolean => {
    const hit = recall(points[origin], points[destination], now);
    if (!hit) return false;
    matrix.minutes[origin * size + destination] = hit.minutes;
    matrix.km[origin * size + destination] = hit.km;
    googleCells += 1;
    return true;
  };

  if (size <= 25) {
    const missingOrigins: number[] = [];
    for (let origin = 0; origin < size; origin += 1) {
      let missing = false;
      for (let destination = 0; destination < size; destination += 1) {
        if (origin === destination) continue;
        if (!cached(origin, destination)) missing = true;
      }
      if (missing) missingOrigins.push(origin);
    }
    if (missingOrigins.length > 0 && Date.now() < deadline) {
      const pairs = await fetchGoogleMatrix({
        origins: points,
        destinations: points,
        apiKey,
        fetchImpl: options?.fetchImpl,
      });
      for (const pair of pairs) {
        applyPair(pair.origin, pair.destination, pair.minutes, pair.km);
      }
    }
  } else {
    const groups = new Map<string, number[]>();
    points.forEach((point, index) => {
      const key = clusterKey(point);
      const list = groups.get(key) ?? [];
      list.push(index);
      groups.set(key, list);
    });
    const keys = [...groups.keys()];
    const centroids = keys.map(parseClusterKey);
    if (centroids.length >= 2 && centroids.length <= 25 && Date.now() < deadline) {
      const known = centroids.map((origin, originIndex) =>
        centroids.map((destination, destinationIndex) => {
          if (originIndex === destinationIndex) return true;
          return recall(origin, destination, now) != null;
        }),
      );
      const needNetwork = known.some((row, originIndex) =>
        row.some((hit, destinationIndex) => originIndex !== destinationIndex && !hit),
      );
      const pairs = needNetwork
        ? await fetchGoogleMatrix({
            origins: centroids,
            destinations: centroids,
            apiKey,
            fetchImpl: options?.fetchImpl,
          })
        : [];
      for (const pair of pairs) {
        remember(
          centroids[pair.origin],
          centroids[pair.destination],
          pair.minutes,
          pair.km,
          now,
        );
      }
      for (let originIndex = 0; originIndex < keys.length; originIndex += 1) {
        for (
          let destinationIndex = 0;
          destinationIndex < keys.length;
          destinationIndex += 1
        ) {
          if (originIndex === destinationIndex) continue;
          const hit = recall(
            centroids[originIndex],
            centroids[destinationIndex],
            now,
          );
          if (!hit) continue;
          const crow = distanceKm(centroids[originIndex], centroids[destinationIndex]) ?? 0;
          const baseMin = travelMinutesFromKm(crow);
          const baseKm = roadKm(crow);
          if (baseMin <= 0 || baseKm <= 0) continue;
          const minuteFactor = Math.min(1.85, Math.max(0.75, hit.minutes / baseMin));
          const kmFactor = Math.min(1.85, Math.max(0.75, hit.km / baseKm));
          const origins = groups.get(keys[originIndex]) ?? [];
          const destinations = groups.get(keys[destinationIndex]) ?? [];
          for (const origin of origins) {
            for (const destination of destinations) {
              const crowPair = distanceKm(points[origin], points[destination]) ?? 0;
              matrix.minutes[origin * size + destination] = Math.max(
                1,
                Math.round(travelMinutesFromKm(crowPair) * minuteFactor),
              );
              matrix.km[origin * size + destination] =
                Math.round(roadKm(crowPair) * kmFactor * 10) / 10;
              googleCells += 1;
            }
          }
        }
      }
    }
  }

  if (googleCells > 0) {
    matrix.source = "mixed";
    const offDiagonal = size * (size - 1);
    if (size <= 25 && googleCells >= offDiagonal) matrix.source = "google";
    await persistDisk(env);
  }
  return matrix;
}
