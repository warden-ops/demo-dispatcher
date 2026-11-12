import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { distanceKm } from "./geo";
import type { LatLng } from "./territory";
import { readEnvValue, type EnvMap } from "../netsuite/config";

/**
 * Repli sans Google. Court trajet : rues lentes. Long trajet : autoroute
 * (~100 km/h, facteur proche de 1,1). Drummondville → Ottawa/Gatineau
 * tombe autour de 2 h 45, pas 4 h.
 */
export const ROAD_FACTOR = 1.3;
export const ROAD_SPEED_KMH = 72;

function roadProfile(crowKm: number): { factor: number; speed: number } {
  if (crowKm <= 30) return { factor: 1.3, speed: 70 };
  if (crowKm >= 160) return { factor: 1.1, speed: 102 };
  const t = (crowKm - 30) / 130;
  return { factor: 1.3 + (1.1 - 1.3) * t, speed: 70 + (102 - 70) * t };
}

const MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const PAIR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const GOOGLE_UNAVAILABLE = "Temps estimés, Google indisponible";

export type TravelMatrix = {
  minutes: Float64Array;
  km: Float64Array;
  size: number;
  source: "haversine" | "google" | "mixed";
  warning?: string;
};

const GOOGLE_BLOCK_MS = 10 * 60 * 1000;
let googleBlockedUntil = 0;

type Pair = { minutes: number; km: number; expiresAt: number };

const memoryPairs = new Map<string, Pair>();
let loadedPath = "";

export function clearTravelCache(): void {
  memoryPairs.clear();
  loadedPath = "";
  googleBlockedUntil = 0;
}

function googleIsBlocked(now: number): boolean {
  return googleBlockedUntil > now;
}

function fatalGoogleStatus(status: number, body: string): boolean {
  if (status === 403 || status === 429) return true;
  const text = body.toUpperCase();
  return (
    text.includes("BILLING_DISABLED") ||
    text.includes("REQUEST_DENIED") ||
    text.includes("OVER_QUERY_LIMIT") ||
    text.includes("OVER_DAILY_LIMIT") ||
    text.includes("RESOURCE_EXHAUSTED")
  );
}

export function travelMinutesFromKm(km: number): number {
  if (km < 0.05) return 0;
  const { factor, speed } = roadProfile(km);
  return Math.max(1, Math.round(((km * factor) / speed) * 60));
}

export function roadKm(km: number): number {
  if (km < 0.05) return 0;
  return Math.round(km * roadProfile(km).factor * 10) / 10;
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
    if (!response.ok) {
      const body = await response.text();
      if (fatalGoogleStatus(response.status, body)) {
        googleBlockedUntil = Date.now() + GOOGLE_BLOCK_MS;
        throw new Error(GOOGLE_UNAVAILABLE);
      }
      return [];
    }
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
  } catch (error) {
    if (error instanceof Error && error.message === GOOGLE_UNAVAILABLE) throw error;
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

const GOOGLE_BATCH = 25;

/**
 * Matrice de temps. Le repli routier est posé tout de suite.
 * Avec une clé, Google est appelé par secteurs (lots de 25×25, dans la limite
 * de l'API), pas seulement quand il y a 25 secteurs ou moins. Le cache disque
 * évite de redemander les mêmes paires. Le repli ne reste que là où Google
 * n'a pas répondu.
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
  if (googleIsBlocked(now)) {
    matrix.warning = GOOGLE_UNAVAILABLE;
    return matrix;
  }

  try {
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
    if (centroids.length >= 2 && Date.now() < deadline) {
      for (let originStart = 0; originStart < centroids.length; originStart += GOOGLE_BATCH) {
        if (Date.now() >= deadline) break;
        const originSlice = centroids.slice(originStart, originStart + GOOGLE_BATCH);
        for (
          let destinationStart = 0;
          destinationStart < centroids.length;
          destinationStart += GOOGLE_BATCH
        ) {
          if (Date.now() >= deadline) break;
          const destinationSlice = centroids.slice(
            destinationStart,
            destinationStart + GOOGLE_BATCH,
          );
          let missing = false;
          for (let origin = 0; origin < originSlice.length && !missing; origin += 1) {
            for (let destination = 0; destination < destinationSlice.length; destination += 1) {
              if (
                originStart + origin !== destinationStart + destination &&
                !recall(originSlice[origin], destinationSlice[destination], now)
              ) {
                missing = true;
                break;
              }
            }
          }
          if (!missing) continue;
          const pairs = await fetchGoogleMatrix({
            origins: originSlice,
            destinations: destinationSlice,
            apiKey,
            fetchImpl: options?.fetchImpl,
          });
          for (const pair of pairs) {
            const origin = originSlice[pair.origin];
            const destination = destinationSlice[pair.destination];
            if (!origin || !destination) continue;
            remember(origin, destination, pair.minutes, pair.km, now);
          }
        }
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
  } catch (error) {
    if (error instanceof Error && error.message === GOOGLE_UNAVAILABLE) {
      const fallback = haversineMatrix(points);
      fallback.warning = GOOGLE_UNAVAILABLE;
      return fallback;
    }
    throw error;
  }
}
