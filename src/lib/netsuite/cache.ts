export const NETSUITE_CACHE_TTL_MS = 60_000;

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

const store = new Map<string, CacheEntry>();

export function readCache<T>(key: string, now = Date.now()): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function writeCache<T>(
  key: string,
  value: T,
  now = Date.now(),
  ttl = NETSUITE_CACHE_TTL_MS,
): void {
  store.set(key, { value, expiresAt: now + ttl });
}

export function clearNetsuiteCache(): void {
  store.clear();
}

export async function cachedRead<T>(
  key: string,
  load: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const hit = readCache<T>(key, now);
  if (hit !== undefined) return hit;
  const value = await load();
  writeCache(key, value, now);
  return value;
}
