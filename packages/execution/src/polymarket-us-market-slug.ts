import { getPolymarketUsClient } from "./polymarket-us-client.js";

export interface UsMarketLookup {
  slug?: string | null;
  title: string;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function resolveUsMarketSlug(market: UsMarketLookup): Promise<string | null> {
  const client = getPolymarketUsClient();
  const slug = market.slug?.trim();

  if (slug) {
    try {
      await client.markets.retrieveBySlug(slug);
      return slug;
    } catch {
      // Fall through to title search — Global slugs often differ from US slugs.
    }
  }

  const query = market.title.trim().slice(0, 120);
  if (!query) return null;

  try {
    const search = await client.search.query({ query, limit: 8, status: "active" });
    const target = normalizeTitle(market.title);

    for (const event of search.events ?? []) {
      for (const m of event.markets ?? []) {
        if (!m.slug || !m.active || m.closed) continue;
        const title = normalizeTitle(m.title ?? "");
        if (title === target || title.includes(target) || target.includes(title)) {
          return m.slug;
        }
      }
    }

    const listed = await client.markets.list({ active: true, limit: 20 });
    for (const m of listed.markets ?? []) {
      if (!m.slug || !m.active || m.closed) continue;
      const title = normalizeTitle(m.title ?? "");
      if (title === target || title.includes(target) || target.includes(title)) {
        return m.slug;
      }
    }
  } catch {
    return null;
  }

  return null;
}
