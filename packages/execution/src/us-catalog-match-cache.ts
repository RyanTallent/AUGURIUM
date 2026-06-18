import type { UsCompatibilityResult } from "./us-compatibility-gate.js";

const TTL_MS = Number(process.env.US_CATALOG_MATCH_CACHE_MS ?? "3600000");

type CacheEntry = { result: UsCompatibilityResult; at: number };

const byTitle = new Map<string, CacheEntry>();

function cacheKey(title: string, category?: string | null): string {
  return `${title.trim().toLowerCase()}|${(category ?? "").toLowerCase()}`;
}

export function getCachedUsCatalogMatch(
  title: string,
  category?: string | null,
): UsCompatibilityResult | null {
  const row = byTitle.get(cacheKey(title, category));
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) {
    byTitle.delete(cacheKey(title, category));
    return null;
  }
  return row.result;
}

export function setCachedUsCatalogMatch(
  title: string,
  category: string | null | undefined,
  result: UsCompatibilityResult,
): void {
  byTitle.set(cacheKey(title, category), { result, at: Date.now() });
  if (byTitle.size > 2000) {
    const oldest = [...byTitle.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 500);
    for (const [k] of oldest) byTitle.delete(k);
  }
}

export function clearUsCatalogMatchCache(): void {
  byTitle.clear();
}
