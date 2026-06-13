import {
  resolveUsMarketForExecution,
  type UsMarketLookup,
} from "./polymarket-us-market-slug.js";

export interface UsCompatibilityInput {
  globalMarketId: string;
  globalTitle: string;
  globalSlug?: string | null;
  side: string;
  category?: string | null;
}

export interface UsCompatibilityResult {
  allowed: boolean;
  confidence: number;
  reason: string;
  usMarketSlug: string | null;
}

const MIN_CONFIDENCE = Number(process.env.US_COMPAT_MIN_CONFIDENCE ?? "0.90");

/** Strict US compatibility gate — skip copy when match confidence is below threshold. */
export async function evaluateUsCompatibilityGate(
  input: UsCompatibilityInput,
): Promise<UsCompatibilityResult> {
  const leader: UsMarketLookup = {
    slug: input.globalSlug,
    title: input.globalTitle,
    category: input.category,
  };

  const match = await resolveUsMarketForExecution(leader);
  const allowed = Boolean(match.slug) && match.confidence >= MIN_CONFIDENCE;

  return {
    allowed,
    confidence: match.confidence,
    reason: match.reason,
    usMarketSlug: match.slug,
  };
}
