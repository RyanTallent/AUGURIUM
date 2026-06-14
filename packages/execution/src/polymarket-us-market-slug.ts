import { getPolymarketUsClient, getPolymarketUsPublicClient, isPolymarketUsReady } from "./polymarket-us-client.js";
import { prisma } from "@augurium/database";

function isUsBroadIntelLocal(): boolean {
  const env = process.env;
  if (env.COPY_US_BROAD_INTEL === "false" || env.COPY_US_BROAD_INTEL === "0") return false;
  if (env.COPY_US_BROAD_INTEL === "true" || env.COPY_US_BROAD_INTEL === "1") return true;
  return env.EXECUTION_PROVIDER === "polymarket-us" && env.LIVE_COPY_ENABLED === "true";
}

export function getUsMatchMinConfidence(): number {
  const raw = process.env.US_COMPAT_MIN_CONFIDENCE;
  if (raw != null && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return isUsBroadIntelLocal() ? 0.75 : 0.9;
}

function shouldTryGlobalSlugOnUs(): boolean {
  if (process.env.US_COMPAT_TRY_GLOBAL_SLUG === "false") return false;
  if (process.env.US_COMPAT_TRY_GLOBAL_SLUG === "true") return true;
  return isUsBroadIntelLocal();
}

function shouldRelaxUsSlugMatch(): boolean {
  if (process.env.US_COMPAT_RELAXED_SLUG === "false") return false;
  if (process.env.US_COMPAT_RELAXED_SLUG === "true") return true;
  return isUsBroadIntelLocal();
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

function stripPropSuffix(slug: string): string {
  return slug.replace(/-game\d+.*$/i, "").replace(/-total-games.*$/i, "");
}

function buildUsSlugCandidates(globalSlug: string): string[] {
  const trimmed = globalSlug.trim();
  if (!trimmed) return [];

  const base = stripPropSuffix(trimmed);
  const candidates = new Set<string>([trimmed, base, `aec-${base}`, `aec-${trimmed}`]);

  for (const prefix of ["val", "cs2", "dota2", "lol", "cod"] as const) {
    if (!base.startsWith(`${prefix}-`)) continue;
    const rest = base.slice(prefix.length + 1);
    const sport = prefix === "val" ? "valorant" : prefix;
    candidates.add(`aec-${sport}-${rest}`);
  }

  return [...candidates];
}

function buildSearchQueries(title: string): string[] {
  const queries = new Set<string>();
  const trimmed = title.trim();
  if (trimmed) queries.add(trimmed.slice(0, 120));

  const matchup = extractEsportsMatchup(title);
  if (matchup) {
    queries.add(matchup.slice(0, 120));
    const sides = matchup.split(/\s+vs\.?\s+/);
    if (sides.length === 2) {
      queries.add(`${sides[0]} ${sides[1]}`.slice(0, 120));
      for (const side of sides) {
        const team = side.trim();
        if (team.length >= 3) queries.add(team.slice(0, 80));
      }
    }
  }

  const norm = normalizeTitle(title);
  if (norm.includes("valorant")) queries.add("valorant");
  if (norm.includes("counter-strike") || norm.includes("cs2")) queries.add("cs2");
  if (norm.includes("dota")) queries.add("dota2");
  if (norm.includes("temperature") || norm.includes("°")) {
    queries.add("temperature");
    const cityMatch = title.match(/\bin\s+([^,?]+?)(?:\s+be|\s+between|\?)/i);
    if (cityMatch) {
      const city = cityMatch[1].trim();
      if (city.length >= 3) queries.add(city.slice(0, 80));
    }
  }

  return [...queries];
}

function readSearchMarketTitle(market: { title?: string; question?: string }): string {
  return market.title ?? market.question ?? "";
}

function isUsMoneylineSlug(slug: string): boolean {
  if (!slug.startsWith("aec-")) return false;
  return !/-game\d|-total|-handicap|-round-|-kill-|-spread|-o-u|-neg-|-pos-/i.test(slug);
}

function slugMatchScore(slug: string): number {
  let score = 0;
  if (slug.startsWith("aec-")) score += 10;
  if (isUsMoneylineSlug(slug)) score += 20;
  return score;
}

function buildUsEventSlugCandidates(globalSlug: string): string[] {
  const base = stripPropSuffix(globalSlug.trim());
  const match = base.match(/^(val|cs2|dota2|lol|cod)-(.+)-(\d{4}-\d{2}-\d{2})$/);
  if (!match) return [];

  const [, sportPrefix, middle, date] = match;
  const sport = sportPrefix === "val" ? "valorant" : sportPrefix;
  const teams = middle.split("-");
  const stripDigits = (token: string) => token.replace(/\d+/g, "");

  return [
    `${sport}-${middle}-${date}`,
    `${sport}-${teams.map(stripDigits).join("-")}-${date}`,
  ];
}

function pickBestMarketSlug(
  expectedTitle: string,
  markets: Array<{ slug?: string; title?: string; question?: string; active?: boolean; closed?: boolean }>,
  eventTitle?: string,
): string | null {
  let bestSlug: string | null = null;
  let bestScore = -1;

  for (const m of markets) {
    if (!m.slug || !m.active || m.closed) continue;

    const marketTitle = readSearchMarketTitle(m);
    const matches =
      usMarketTitlesMatch(expectedTitle, marketTitle) ||
      (eventTitle ? usMarketTitlesMatch(expectedTitle, eventTitle) : false);
    if (!matches) continue;

    const score = slugMatchScore(m.slug);
    if (score > bestScore) {
      bestScore = score;
      bestSlug = m.slug;
    }
  }

  return bestSlug;
}

async function tryEventSlugCandidates(
  client: ReturnType<typeof getPolymarketUsClient>,
  globalSlug: string,
  expectedTitle: string,
): Promise<string | null> {
  for (const eventSlug of buildUsEventSlugCandidates(globalSlug)) {
    try {
      const retrieved = await client.events.retrieveBySlug(eventSlug);
      const event = retrieved.event;
      if (!event) continue;

      const slug = pickBestMarketSlug(expectedTitle, event.markets ?? [], event.title);
      if (slug) return slug;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function trySlugCandidates(
  client: ReturnType<typeof getPolymarketUsClient>,
  globalSlug: string,
  expectedTitle: string,
): Promise<string | null> {
  for (const candidate of buildUsSlugCandidates(globalSlug)) {
    try {
      const retrieved = await client.markets.retrieveBySlug(candidate);
      const market = retrieved.market;
      if (market?.closed || market?.active === false) continue;

      const usTitle = readUsMarketTitle(retrieved);
      if (usMarketTitlesMatch(expectedTitle, usTitle)) {
        return candidate;
      }
      console.warn(
        `[execution] rejected US slug ${candidate} — title mismatch expected="${expectedTitle}" us="${usTitle}"`,
      );
    } catch {
      // Try next candidate.
    }
  }
  return null;
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
  if (tokens.length === 0) return 0.7;
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
    return { ok: confidence >= getUsMatchMinConfidence(), usTitle, confidence };
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

/** Match leader global market metadata against US catalog rows (no global slug translation). */
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

async function searchUsApiByTitle(
  client: ReturnType<typeof getPolymarketUsClient>,
  expectedTitle: string,
): Promise<UsCompatibilityMatch> {
  const queries = buildSearchQueries(expectedTitle);
  let best: UsCompatibilityMatch = {
    slug: null,
    confidence: 0,
    reason: "no US API title search match",
  };

  for (const query of queries) {
    try {
      const search = await client.search.query({ query, limit: 24, status: "active" });
      for (const event of search.events ?? []) {
        const slug = pickBestMarketSlug(expectedTitle, event.markets ?? [], event.title ?? "");
        if (!slug) continue;
        const found = event.markets?.find((m) => m.slug === slug);
        const marketTitle = found
          ? readSearchMarketTitle(found as { title?: string; question?: string })
          : (event.title ?? "");
        const confidence = titleMatchConfidence(expectedTitle, marketTitle);
        if (confidence > best.confidence) {
          best = {
            slug,
            confidence,
            reason: `US API title search (${(confidence * 100).toFixed(0)}%)`,
            usTitle: marketTitle,
          };
        }
      }
    } catch {
      // continue queries
    }
  }

  return best;
}

/**
 * US compatibility gate for live execution.
 * When US_COMPAT_TRY_GLOBAL_SLUG is enabled, tries leader global slug on Polymarket US first.
 */
export async function resolveUsMarketForExecution(
  leader: UsMarketLookup,
): Promise<UsCompatibilityMatch> {
  const client = isPolymarketUsReady() ? getPolymarketUsClient() : getPolymarketUsPublicClient();
  const minConfidence = getUsMatchMinConfidence();
  const tryGlobalSlug = shouldTryGlobalSlugOnUs();
  const relaxedSlug = shouldRelaxUsSlugMatch();

  if (tryGlobalSlug && leader.slug?.trim()) {
    const globalSlug = leader.slug.trim();
    const slugHit =
      (await trySlugCandidates(client, globalSlug, leader.title)) ??
      (await tryEventSlugCandidates(client, globalSlug, leader.title));
    if (slugHit) {
      const verified = await verifyUsMarketActive(client, slugHit, leader.title);
      if (verified.ok || relaxedSlug) {
        return {
          slug: slugHit,
          confidence: Math.max(verified.confidence, relaxedSlug ? 0.85 : 0),
          reason: relaxedSlug
            ? `global slug on US (relaxed): ${slugHit}`
            : `global slug on US: ${slugHit}`,
          usTitle: verified.usTitle,
        };
      }
    }
  }

  const catalogMatch = await matchUsMarketFromCatalog(leader);
  if (catalogMatch.slug && catalogMatch.confidence >= minConfidence) {
    const verified = await verifyUsMarketActive(client, catalogMatch.slug, leader.title);
    if (verified.ok) {
      return {
        slug: catalogMatch.slug,
        confidence: verified.confidence,
        reason: `catalog+verified: ${catalogMatch.reason}`,
        usTitle: verified.usTitle,
      };
    }
  }

  const searchMatch = await searchUsApiByTitle(client, leader.title);
  if (searchMatch.slug && searchMatch.confidence >= minConfidence) {
    const verified = await verifyUsMarketActive(client, searchMatch.slug, leader.title);
    if (verified.ok) {
      return {
        slug: searchMatch.slug,
        confidence: verified.confidence,
        reason: `api-search+verified: ${searchMatch.reason}`,
        usTitle: verified.usTitle,
      };
    }
  }

  const best = catalogMatch.confidence >= searchMatch.confidence ? catalogMatch : searchMatch;
  if (best.confidence < minConfidence) {
    return {
      slug: null,
      confidence: best.confidence,
      reason: `uncertain match (${(best.confidence * 100).toFixed(0)}% < ${minConfidence * 100}% threshold) — skip`,
    };
  }

  return {
    slug: null,
    confidence: best.confidence,
    reason: "US market inactive or failed verification — skip",
  };
}

/** Legacy resolver — prefers stored US slug; avoids global slug translation when possible. */
export async function resolveUsMarketSlug(market: UsMarketLookup): Promise<string | null> {
  const match = await resolveUsMarketForExecution(market);
  return match.slug;
}
