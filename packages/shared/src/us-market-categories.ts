/**
 * Polymarket US category taxonomy for balanced leader discovery and specialty scoring.
 * Maps raw US catalog / scan titles into specialist buckets without disabling any category.
 */

export const SPECIALTY_BUCKETS = [
  "Politics",
  "Sports",
  "Esports",
  "Tech",
  "Econ",
  "Culture",
  "Weather",
  "Other",
] as const;

export type SpecialtyBucket = (typeof SPECIALTY_BUCKETS)[number];

/** Polymarket US catalog category slugs (user-facing list). */
export const US_POLYGON_CATEGORY_SLUGS = [
  "world cup",
  "ufc",
  "nhl",
  "mlb",
  "golf",
  "tennis",
  "esports",
  "cws",
  "nfl",
  "nba",
  "wnba",
  "motorsports",
  "tech",
  "politics",
  "econ",
  "culture",
  "temp",
  "mls",
  "boxing",
  "more",
] as const;

const US_SLUG_TO_BUCKET: Record<string, SpecialtyBucket> = {
  politics: "Politics",
  econ: "Econ",
  tech: "Tech",
  culture: "Culture",
  temp: "Weather",
  esports: "Esports",
  "world cup": "Sports",
  ufc: "Sports",
  nhl: "Sports",
  mlb: "Sports",
  golf: "Sports",
  tennis: "Sports",
  cws: "Sports",
  nfl: "Sports",
  nba: "Sports",
  wnba: "Sports",
  motorsports: "Sports",
  mls: "Sports",
  boxing: "Sports",
  more: "Other",
};

const BUCKET_KEYWORDS: { bucket: SpecialtyBucket; patterns: RegExp[] }[] = [
  {
    bucket: "Esports",
    patterns: [
      /\besports?\b/i,
      /\bcounter-strike\b/i,
      /\bcs2\b/i,
      /\bvalorant\b/i,
      /\bdota\b/i,
      /\bleague of legends\b/i,
      /\blol\b/i,
      /\bvct\b/i,
      /\bblast\b/i,
    ],
  },
  {
    bucket: "Politics",
    patterns: [
      /\bpolitic/i,
      /\belection\b/i,
      /\btrump\b/i,
      /\bbiden\b/i,
      /\bcongress\b/i,
      /\bsenate\b/i,
      /\bgovernor\b/i,
      /\bpresident\b/i,
      /\bimpeach/i,
    ],
  },
  {
    bucket: "Sports",
    patterns: [
      /\bnfl\b/i,
      /\bnba\b/i,
      /\bwnba\b/i,
      /\bmlb\b/i,
      /\bnhl\b/i,
      /\bufc\b/i,
      /\bboxing\b/i,
      /\bgolf\b/i,
      /\btennis\b/i,
      /\bworld cup\b/i,
      /\bmls\b/i,
      /\bmotorsport/i,
      /\bf1\b/i,
      /\bnascar\b/i,
      /\bsuper bowl\b/i,
      /\bcollege world series\b/i,
      /\bcws\b/i,
      /\bchampion/i,
      /\bvs\.?\b/i,
    ],
  },
  {
    bucket: "Tech",
    patterns: [/\btech\b/i, /\bapple\b/i, /\bgoogle\b/i, /\bmicrosoft\b/i, /\bopenai\b/i, /\bspacex\b/i, /\bai\b/i],
  },
  {
    bucket: "Econ",
    patterns: [/\becon/i, /\bfed\b/i, /\binflation\b/i, /\bcpi\b/i, /\bgdp\b/i, /\bjobs report\b/i, /\btreasury\b/i],
  },
  {
    bucket: "Culture",
    patterns: [/\bculture\b/i, /\bmovie\b/i, /\boscar\b/i, /\bgrammy\b/i, /\bcelebrity\b/i, /\bnetflix\b/i],
  },
  {
    bucket: "Weather",
    patterns: [/\btemp(erature)?\b/i, /\bweather\b/i, /\bhurricane\b/i, /\brainfall\b/i, /\bhigh\b.*\blow\b/i],
  },
];

export function mapToSpecialtyBucket(input: {
  usCategory?: string | null;
  title?: string | null;
  slug?: string | null;
}): SpecialtyBucket {
  const rawCat = (input.usCategory ?? "").trim().toLowerCase();
  if (rawCat && US_SLUG_TO_BUCKET[rawCat]) return US_SLUG_TO_BUCKET[rawCat];

  const blob = [input.title, input.slug, input.usCategory].filter(Boolean).join(" ");
  for (const rule of BUCKET_KEYWORDS) {
    if (rule.patterns.some((p) => p.test(blob))) return rule.bucket;
  }
  return "Other";
}

/** Discovery order — esports included but not listed first. */
export const DISCOVERY_BUCKET_ORDER: SpecialtyBucket[] = [
  "Politics",
  "Sports",
  "Econ",
  "Tech",
  "Weather",
  "Culture",
  "Esports",
  "Other",
];

export function discoveryBucketQuota(bucket: SpecialtyBucket, totalWallets: number): number {
  const base = Number(process.env.COPY_DISCOVERY_BUCKET_QUOTA ?? "4");
  const esportsShare = Number(process.env.COPY_DISCOVERY_ESPORTS_SHARE ?? "0.18");
  if (bucket === "Esports") {
    return Math.max(2, Math.floor(totalWallets * esportsShare));
  }
  if (bucket === "Other") return Math.max(2, Math.floor(base / 2));
  return base;
}

export function formatSpecialtyBucketLabel(bucket: SpecialtyBucket | null): string | null {
  if (!bucket || bucket === "Other") return null;
  return `${bucket} specialist`;
}
