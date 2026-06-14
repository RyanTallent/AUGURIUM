import { getUsCompatMinConfidence } from "@augurium/shared";
import { getPolymarketUsClient, getPolymarketUsPublicClient, isPolymarketUsReady } from "./polymarket-us-client.js";
import { prisma } from "@augurium/database";

export function getUsMatchMinConfidence(): number {
  return getUsCompatMinConfidence();
}

export interface UsMarketLookup {
  slug?: string | null;
  title: string;
  category?: string | null;
}

/** @deprecated use getUsMatchMinConfidence() */
export const US_MATCH_MIN_CONFIDENCE = 0.9;

export interface UsCompatibilityMatch {
  slug: string | null;
  confidence: number;
  reason: string;
  usTitle?: string;
}

function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/°\s*[cf]\b/g, " degrees ")
    .replace(/[?!.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

const ESPORTS_BOILERPLATE = /esports event .+ scheduled for/;

function isUsEsportsBoilerplate(title: string): boolean {
  return ESPORTS_BOILERPLATE.test(normalizeTitle(title));
}

/** Pull "Team A vs Team B" from global or US esports titles. */
function extractEsportsMatchup(title: string): string | null {
  const norm = normalizeTitle(title);
  const usMatch = norm.match(/esports event (.+?) scheduled for/);
  if (usMatch) return usMatch[1].replace(/\./g, "").trim();

  const colon = norm.indexOf(":");
  if (colon >= 0) {
    let rest = norm.slice(colon + 1).trim();
    rest = rest.replace(/\s*\(bo\d+\).*$/, "").trim();
    return rest.replace(/\./g, "").trim();
  }
  return null;
}

function normalizeMatchupTokens(matchup: string): string[] {
  return matchup
    .replace(/\bteam\b/g, "")
    .split(/\s+vs\.?\s+/)
    .map((side) =>
      side
        .replace(/[^a-z0-9]/g, "")
        .trim(),
    )
    .filter(Boolean)
    .sort();
}

function matchupsEquivalent(a: string, b: string): boolean {
  const ta = normalizeMatchupTokens(a);
  const tb = normalizeMatchupTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  return ta[0] === tb[0] && ta[1] === tb[1];
}

/** Reject cross-sport / wrong-market matches before placing real-money US orders. */
export function usMarketTitlesMatch(expectedTitle: string, usTitle: string): boolean {
  const expected = normalizeTitle(expectedTitle);
  const actual = normalizeTitle(usTitle);
  if (!expected || !actual) return false;
  if (expected === actual) return true;

  const expectedMatchup = extractEsportsMatchup(expectedTitle);
  const actualMatchup = extractEsportsMatchup(usTitle);
  if (expectedMatchup && actualMatchup && matchupsEquivalent(expectedMatchup, actualMatchup)) {
    return true;
  }

  const eitherEsportsBoilerplate = isUsEsportsBoilerplate(expectedTitle) || isUsEsportsBoilerplate(usTitle);
  if (!eitherEsportsBoilerplate) {
    for (const kw of CATEGORY_KEYWORDS) {
      const inExpected = expected.includes(kw);
      const inActual = actual.includes(kw);
      if (inExpected !== inActual) return false;
    }
  }

  const coreExpected = (expected.split(":").pop() ?? expected).trim();
  const coreActual = eitherEsportsBoilerplate ? actual : (actual.split(":").pop() ?? actual).trim();
  if (coreExpected === coreActual) return true;

  const compareTarget = eitherEsportsBoilerplate ? actual : coreActual;
  const tokens = coreExpected
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.+-]/g, ""))
    .filter((t) => t.length > 2 && !["bo1", "bo3", "bo5", "major", "playoffs", "stage"].includes(t));

  if (tokens.length === 0) return false;
  const matched = tokens.filter((t) => compareTarget.includes(t)).length;
  return matched / tokens.length >= 0.6;
}

function readUsMarketTitle(retrieved: {
  market?: { title?: string; question?: string };
  title?: string;
  question?: string;
}): string {
  return (
    retrieved.market?.title ??
    retrieved.market?.question ??
    retrieved.title ??
    retrieved.question ??
    ""
  );
}

function titleMatchConfidence(expectedTitle: string, usTitle: string): number {
  if (!usMarketTitlesMatch(expectedTitle, usTitle)) return 0;
  const expected = normalizeTitle(expectedTitle);
  const actual = normalizeTitle(usTitle);
  if (expected === actual) return 1;
  const tokens = expected
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9.+-]/g, ""))
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const matched = tokens.filter((t) => actual.includes(t)).length;
  return Math.min(0.99, 0.6 + (matched / tokens.length) * 0.35);
}

async function verifyUsMarketActive(
  client: ReturnType<typeof getPolymarketUsClient>,
  slug: string,
  expectedTitle: string,
): Promise<{ ok: boolean; usTitle: string; confidence: number }> {
  try {
    const retrieved = await client.markets.retrieveBySlug(slug);
    const market = retrieved.market;
    if (!market || market.closed || market.active === false) {
      return { ok: false, usTitle: "", confidence: 0 };
    }
    const usTitle = readUsMarketTitle(retrieved);
    const confidence = titleMatchConfidence(expectedTitle, usTitle);
    const minConfidence = getUsMatchMinConfidence();
    return { ok: confidence >= minConfidence, usTitle, confidence };
  } catch {
    return { ok: false, usTitle: "", confidence: 0 };
  }
}

function extractCatalogSearchTokens(title: string): string[] {
  const matchup = extractEsportsMatchup(title);
  if (matchup) {
    return matchup
      .split(/\s+vs\.?\s+/)
      .map((s) => s.replace(/[^a-z0-9]/gi, "").trim())
      .filter((s) => s.length >= 3);
  }

  const norm = normalizeTitle(title);
  const stop = new Set(["will", "the", "what", "who", "when"]);
  const tokens: string[] = [];

  if (norm.includes("temperature")) {
    const cityMatch = title.match(/\bin\s+([^,?]+?)(?:\s+be|\s+between|\?)/i);
    if (cityMatch) {
      const city = cityMatch[1].trim().toLowerCase();
      for (const part of city.split(/\s+/)) {
        if (part.length >= 3) tokens.push(part.replace(/[^a-z0-9]/g, ""));
      }
    }
    tokens.push("temperature");
  }

  for (const t of norm.split(/\s+/)) {
    const cleaned = t.replace(/[^a-z0-9.+-]/g, "");
    if (cleaned.length >= 4 && !stop.has(cleaned)) tokens.push(cleaned);
  }

  return [...new Set(tokens)].slice(0, 8);
}

/** Match PolymarketScan leader title to Polymarket US catalog ONLY. */
export async function matchUsMarketFromCatalog(
  leader: UsMarketLookup,
): Promise<UsCompatibilityMatch> {
  const tokens = extractCatalogSearchTokens(leader.title);
  const catalog =
    tokens.length > 0
      ? await prisma.market.findMany({
          where: {
            source: "polymarket-us",
            active: true,
            closed: false,
            OR: tokens.map((token) => ({
              title: { contains: token, mode: "insensitive" as const },
            })),
          },
          select: { slug: true, title: true, category: true },
          take: 400,
        })
      : await prisma.market.findMany({
          where: { source: "polymarket-us", active: true, closed: false },
          select: { slug: true, title: true, category: true },
          take: 500,
          orderBy: { updatedAt: "desc" },
        });

  let best: UsCompatibilityMatch = {
    slug: null,
    confidence: 0,
    reason: "no US catalog match",
  };

  for (const row of catalog) {
    if (!row.slug) continue;
    if (
      leader.category &&
      row.category &&
      normalizeTitle(leader.category) !== normalizeTitle(row.category)
    ) {
      continue;
    }
    const confidence = titleMatchConfidence(leader.title, row.title);
    if (confidence > best.confidence) {
      best = {
        slug: row.slug,
        confidence,
        reason: `catalog title match (${(confidence * 100).toFixed(0)}%)`,
        usTitle: row.title,
      };
    }
  }

  return best;
}

/**
 * US compatibility resolver — catalog-only, strict confidence ≥ US_COMPAT_MIN_CONFIDENCE (default 0.90).
 * Global slugs and API fuzzy search are never used.
 */
export async function resolveUsMarketForExecution(
  leader: UsMarketLookup,
): Promise<UsCompatibilityMatch> {
  const minConfidence = getUsMatchMinConfidence();
  const client = isPolymarketUsReady() ? getPolymarketUsClient() : getPolymarketUsPublicClient();

  const catalogMatch = await matchUsMarketFromCatalog(leader);
  if (!catalogMatch.slug || catalogMatch.confidence < minConfidence) {
    return {
      slug: null,
      confidence: catalogMatch.confidence,
      reason:
        catalogMatch.confidence > 0
          ? `uncertain match (${(catalogMatch.confidence * 100).toFixed(0)}% < ${minConfidence * 100}% threshold) — skip`
          : "no US catalog match — skip",
    };
  }

  const verified = await verifyUsMarketActive(client, catalogMatch.slug, leader.title);
  if (!verified.ok || verified.confidence < minConfidence) {
    return {
      slug: null,
      confidence: verified.confidence,
      reason: verified.confidence > 0
        ? `US market failed strict verification (${(verified.confidence * 100).toFixed(0)}%) — skip`
        : "US market inactive or closed — skip",
    };
  }

  return {
    slug: catalogMatch.slug,
    confidence: verified.confidence,
    reason: `catalog+verified: ${catalogMatch.reason}`,
    usTitle: verified.usTitle,
  };
}

/** Legacy resolver — catalog-only strict match. */
export async function resolveUsMarketSlug(market: UsMarketLookup): Promise<string | null> {
  const match = await resolveUsMarketForExecution(market);
  return match.slug;
}
