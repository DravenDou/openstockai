import { defineState } from "eve/context";

type Entry = { data: unknown; expiresAt: number };
export const catalogCache = defineState("openstock.catalog-cache", () => ({
  scope: "",
  entries: {} as Record<string, Entry>,
}));

export function readCatalog<T>(scope: string, key: string): T | undefined {
  const cache = catalogCache.get();
  if (cache.scope !== scope) return undefined;
  const entry = cache.entries[key];
  return entry && entry.expiresAt > Date.now() ? (entry.data as T) : undefined;
}

export function writeCatalog(scope: string, key: string, data: unknown) {
  catalogCache.update((cache) => {
    // ponytail: eight entries per turn; catalogs expire after 15s. Stock is never cached.
    const entries =
      cache.scope === scope && (key in cache.entries || Object.keys(cache.entries).length < 8)
        ? cache.entries
        : {};
    return { scope, entries: { ...entries, [key]: { data, expiresAt: Date.now() + 15_000 } } };
  });
}

export function clearCatalogCache() {
  catalogCache.update((cache) => ({ ...cache, entries: {} }));
}
