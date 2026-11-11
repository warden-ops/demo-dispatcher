import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Appel } from "../guertech/types";
import type { EnvMap } from "./config";
import { readEnvValue } from "./config";

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const REQUEST_BUDGET_MS = 8_000;
const MAX_LOOKUPS = 40;
const CONCURRENCY = 4;

type CacheEntry = {
  lat: number | null;
  lng: number | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
let loadedFrom = "";
let diskDirty = false;

export function clearGeocodeCache(): void {
  cache.clear();
  loadedFrom = "";
  diskDirty = false;
}

function diskFile(env: EnvMap): string | null {
  if (readEnvValue(env, "GEOCODE_CACHE_DISABLE") === "1") return null;
  const configured = readEnvValue(env, "GEOCODE_CACHE_PATH");
  if (configured) return configured;
  if (process.env.NODE_TEST_CONTEXT) return null;
  return path.join(process.cwd(), ".cache", "geocode.json");
}

async function ensureDisk(env: EnvMap, now: number): Promise<void> {
  const file = diskFile(env);
  if (!file || loadedFrom === file) return;
  loadedFrom = file;
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { entries?: Record<string, CacheEntry> };
    for (const [key, entry] of Object.entries(parsed.entries ?? {})) {
      if (!entry || entry.expiresAt <= now) continue;
      cache.set(key, entry);
    }
  } catch {
    // fichier absent ou illisible : on recommence en mémoire
  }
}

async function persistDisk(env: EnvMap): Promise<void> {
  const file = diskFile(env);
  if (!file || !diskDirty) return;
  const entries: Record<string, CacheEntry> = {};
  for (const [key, entry] of cache) entries[key] = entry;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ entries }), "utf8");
    diskDirty = false;
  } catch {
    // le cache mémoire reste valide pour la requête en cours
  }
}

function mapsKey(env: EnvMap): string {
  return (
    readEnvValue(env, "GOOGLE_MAPS_SERVER_API_KEY") ||
    readEnvValue(env, "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY")
  );
}

function cacheKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function queryAddress(address: string): string {
  return address.replace(/\r\n|\n|\r/g, ", ").replace(/\s+/g, " ").trim();
}

function readHit(
  address: string,
  now: number,
): { lat: number; lng: number } | null | undefined {
  const entry = cache.get(cacheKey(address));
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(cacheKey(address));
    return undefined;
  }
  if (entry.lat == null || entry.lng == null) return null;
  return { lat: entry.lat, lng: entry.lng };
}

function writeHit(
  address: string,
  point: { lat: number; lng: number } | null,
  now: number,
): void {
  cache.set(cacheKey(address), {
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    expiresAt: now + (point ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  diskDirty = true;
}

async function lookup(
  address: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", queryAddress(address));
  url.searchParams.set("components", "country:CA");
  url.searchParams.set("region", "ca");
  url.searchParams.set("key", apiKey);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
    };
    const location = payload.results?.[0]?.geometry?.location;
    if (
      payload.status !== "OK" ||
      location?.lat == null ||
      location.lng == null ||
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng)
    ) {
      return null;
    }
    return { lat: location.lat, lng: location.lng };
  } catch {
    return null;
  }
}

/**
 * Complète lat/lng quand NetSuite n'en a pas. Sans clé, ou si Google échoue,
 * les appels reviennent inchangés. Le résultat est mis en cache en mémoire.
 */
export async function geocodeAppels(
  appels: Appel[],
  env: EnvMap,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
  limits?: { maxLookups?: number; budgetMs?: number },
): Promise<Appel[]> {
  await ensureDisk(env, now);
  const apiKey = mapsKey(env);
  const maxLookups = limits?.maxLookups ?? MAX_LOOKUPS;
  const budgetMs = limits?.budgetMs ?? REQUEST_BUDGET_MS;
  const resolved = new Map<string, { lat: number; lng: number } | null>();
  const needsLookup: string[] = [];
  const seen = new Set<string>();

  for (const appel of appels) {
    if (appel.lat != null && appel.lng != null) continue;
    const address = appel.adresse.trim();
    if (address.length < 8) continue;
    const key = cacheKey(address);
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = readHit(address, now);
    if (hit !== undefined) {
      resolved.set(key, hit);
      continue;
    }
    if (apiKey) needsLookup.push(address);
  }

  if (apiKey && needsLookup.length > 0) {
    const deadline = Date.now() + budgetMs;
    let lookedUp = 0;
    for (
      let index = 0;
      index < needsLookup.length &&
      lookedUp < maxLookups &&
      Date.now() < deadline;
      index += CONCURRENCY
    ) {
      const batch = needsLookup.slice(index, index + CONCURRENCY);
      const points = await Promise.all(
        batch.map((address) => lookup(address, apiKey, fetchImpl)),
      );
      batch.forEach((address, batchIndex) => {
        const point = points[batchIndex] ?? null;
        writeHit(address, point, Date.now());
        resolved.set(cacheKey(address), point);
      });
      lookedUp += batch.length;
    }
    await persistDisk(env);
  }

  return appels.map((appel) => {
    if (appel.lat != null && appel.lng != null) return appel;
    const point = resolved.get(cacheKey(appel.adresse));
    if (!point) return appel;
    return { ...appel, lat: point.lat, lng: point.lng };
  });
}
