export const MARKET_CATEGORIES = [
  "Crypto",
  "Politics",
  "Elections",
  "Sports",
  "Esports",
  "Weather",
  "Macro",
  "Economics",
  "AI",
  "Technology",
  "Entertainment",
  "Other",
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

const KEYWORD_RULES: { category: MarketCategory; patterns: RegExp[] }[] = [
  {
    category: "Crypto",
    patterns: [
      /\bbitcoin\b/i,
      /\bbtc\b/i,
      /\bethereum\b/i,
      /\beth\b/i,
      /\bcrypto\b/i,
      /\bsolana\b/i,
      /\bdoge\b/i,
      /\btoken\b/i,
      /\bdefi\b/i,
    ],
  },
  {
    category: "Elections",
    patterns: [
      /\belection\b/i,
      /\bprimary\b/i,
      /\bgovernor\b/i,
      /\bsenate\b/i,
      /\bhouse\b/i,
      /\bballot\b/i,
      /\bvote\b/i,
      /\bpresident\b/i,
    ],
  },
  {
    category: "Politics",
    patterns: [
      /\bpolitic/i,
      /\btrump\b/i,
      /\bbiden\b/i,
      /\bcongress\b/i,
      /\bsupreme court\b/i,
      /\bimpeach/i,
      /\bminister\b/i,
      /\bparliament\b/i,
    ],
  },
  {
    category: "Esports",
    patterns: [/\besports?\b/i, /\bleague of legends\b/i, /\bdota\b/i, /\bcs2\b/i, /\bvalorant\b/i],
  },
  {
    category: "Sports",
    patterns: [
      /\bnfl\b/i,
      /\bnba\b/i,
      /\bmlb\b/i,
      /\bsoccer\b/i,
      /\bfootball\b/i,
      /\bbasketball\b/i,
      /\btennis\b/i,
      /\bgolf\b/i,
      /\bchampion/i,
      /\bsuper bowl\b/i,
      /\bworld cup\b/i,
    ],
  },
  {
    category: "Weather",
    patterns: [/\bweather\b/i, /\bhurricane\b/i, /\btemperature\b/i, /\brainfall\b/i, /\bstorm\b/i],
  },
  {
    category: "Macro",
    patterns: [/\bfed\b/i, /\brate cut\b/i, /\binflation\b/i, /\brecession\b/i, /\bgdp\b/i, /\bcpi\b/i],
  },
  {
    category: "Economics",
    patterns: [/\beconom/i, /\btreasury\b/i, /\bjobs report\b/i, /\bunemployment\b/i, /\byield\b/i],
  },
  {
    category: "AI",
    patterns: [/\bopenai\b/i, /\bchatgpt\b/i, /\bartificial intelligence\b/i, /\bllm\b/i, /\bagi\b/i],
  },
  {
    category: "Technology",
    patterns: [/\btech\b/i, /\bapple\b/i, /\bgoogle\b/i, /\bmicrosoft\b/i, /\biphone\b/i, /\bspacex\b/i],
  },
  {
    category: "Entertainment",
    patterns: [/\bmovie\b/i, /\boscar\b/i, /\bgrammy\b/i, /\bcelebrity\b/i, /\btv\b/i, /\bnetflix\b/i],
  },
];

const GAMMA_CATEGORY_MAP: Record<string, MarketCategory> = {
  crypto: "Crypto",
  politics: "Politics",
  elections: "Elections",
  sports: "Sports",
  esports: "Esports",
  weather: "Weather",
  macro: "Macro",
  economics: "Economics",
  ai: "AI",
  technology: "Technology",
  tech: "Technology",
  entertainment: "Entertainment",
  culture: "Entertainment",
  finance: "Economics",
  business: "Economics",
};

function matchKeywords(text: string): MarketCategory | null {
  for (const rule of KEYWORD_RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.category;
  }
  return null;
}

export function normalizeMarketCategory(input: {
  gammaCategory?: string | null;
  tags?: string[] | null;
  title?: string | null;
  slug?: string | null;
  eventSlug?: string | null;
}): MarketCategory {
  const gamma = (input.gammaCategory ?? "").trim().toLowerCase();
  if (gamma && GAMMA_CATEGORY_MAP[gamma]) return GAMMA_CATEGORY_MAP[gamma];

  const tagText = (input.tags ?? []).join(" ");
  const blob = [input.title, input.slug, input.eventSlug, tagText, input.gammaCategory]
    .filter(Boolean)
    .join(" ");
  const fromKeywords = matchKeywords(blob);
  if (fromKeywords) return fromKeywords;

  return "Other";
}

export function formatSpecialistLabel(category: string | null): string | null {
  if (!category || category === "Other" || category === "uncategorized") return null;
  return `${category} Specialist`;
}
