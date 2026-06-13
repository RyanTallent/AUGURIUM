import { getPolymarketUsClient } from "./polymarket-us-client.js";

export interface UsMarketLookup {
  slug?: string | null;
  title: string;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

const CATEGORY_KEYWORDS = [
  "counter-strike",
  "dota",
  "cs2",
  "league of legends",
  "valorant",
  "baseball",
  "mlb",
  "nba",
  "nfl",
  "nhl",
  "soccer",
  "tennis",
];

/** Reject cross-sport / wrong-market matches before placing real-money US orders. */
export function usMarketTitlesMatch(expectedTitle: string, usTitle: string): boolean {
  const expected = normalizeTitle(expectedTitle);
  const actual = normalizeTitle(usTitle);
  if (!expected || !actual) return false;
  if (expected === actual) return true;

  for (const kw of CATEGORY_KEYWORDS) {
    const inExpected = expected.includes(kw);
    const inActual = actual.includes(kw);
    if (inExpected !== inActual) return false;
  }

  const coreExpected = (expected.split(":").pop() ?? expected).trim();
  const coreActual = (actual.split(":").pop() ?? actual).trim();
  if (coreExpected === coreActual) return true;

  const tokens = coreExpected
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.+-]/g, ""))
    .filter((t) => t.length > 2 && !["bo3", "bo5", "major", "playoffs", "stage"].includes(t));

  if (tokens.length === 0) return false;
  const matched = tokens.filter((t) => coreActual.includes(t)).length;
  return matched / tokens.length >= 0.6;
}

function readUsMarketTitle(retrieved: { market?: { title?: string }; title?: string }): string {
  return retrieved.market?.title ?? retrieved.title ?? "";
}

export async function resolveUsMarketSlug(market: UsMarketLookup): Promise<string | null> {
  const client = getPolymarketUsClient();
  const slug = market.slug?.trim();
  const target = normalizeTitle(market.title);

  if (slug) {
    try {
      const retrieved = await client.markets.retrieveBySlug(slug);
      const usTitle = readUsMarketTitle(retrieved);
      if (usMarketTitlesMatch(market.title, usTitle)) {
        return slug;
      }
      console.warn(
        `[execution] rejected US slug ${slug} — title mismatch expected="${market.title}" us="${usTitle}"`,
      );
    } catch {
      // Fall through to strict title search only.
    }
  }

  const query = market.title.trim().slice(0, 120);
  if (!query || !target) return null;

  try {
    const search = await client.search.query({ query, limit: 12, status: "active" });

    for (const event of search.events ?? []) {
      for (const m of event.markets ?? []) {
        if (!m.slug || !m.active || m.closed) continue;
        const title = normalizeTitle(m.title ?? "");
        if (title === target && usMarketTitlesMatch(market.title, m.title ?? "")) {
          return m.slug;
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}
