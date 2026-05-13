type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const globalForCache = globalThis as typeof globalThis & {
  __gouweiMemoryCache?: Map<string, CacheEntry<unknown>>;
};

globalForCache.__gouweiMemoryCache ??= new Map();

export async function remember<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const current = globalForCache.__gouweiMemoryCache?.get(key) as CacheEntry<T> | undefined;

  if (current && current.expiresAt > now) {
    return current.value;
  }

  const value = await loader();
  globalForCache.__gouweiMemoryCache?.set(key, {
    value,
    expiresAt: now + ttlMs,
  });
  return value;
}

export function readRemembered<T>(key: string): T | null {
  const current = globalForCache.__gouweiMemoryCache?.get(key) as CacheEntry<T> | undefined;

  if (!current || current.expiresAt <= Date.now()) {
    return null;
  }

  return current.value;
}
