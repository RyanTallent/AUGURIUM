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

export async function resolveUsMarketSlug(market: UsMarketLookup): Promise<string | null> {
  const client = getPolymarketUsClient();
  const slug = market.slug?.trim();

  if (slug) {
    const resolved =
      (await trySlugCandidates(client, slug, market.title)) ??
      (await tryEventSlugCandidates(client, slug, market.title));
    if (resolved) return resolved;
  }

  const queries = buildSearchQueries(market.title);
  if (queries.length === 0) return null;

  let bestSlug: string | null = null;
  let bestScore = -1;

  try {
    for (const query of queries) {
      const search = await client.search.query({ query, limit: 24, status: "active" });

      for (const event of search.events ?? []) {
        const slug = pickBestMarketSlug(market.title, event.markets ?? [], event.title ?? "");
        if (!slug) continue;

        const score = slugMatchScore(slug);
        if (score > bestScore) {
          bestScore = score;
          bestSlug = slug;
        }
      }
    }
  } catch {
    return bestSlug;
  }

  return bestSlug;
}
