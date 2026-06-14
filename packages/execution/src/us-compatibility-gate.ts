import {
  resolveUsMarketForExecution,
  getUsMatchMinConfidence,
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

/** US compatibility gate — catalog-only, strict confidence threshold (no bypasses). */
export async function evaluateUsCompatibilityGate(
  input: UsCompatibilityInput,
): Promise<UsCompatibilityResult> {
  const minConfidence = getUsMatchMinConfidence();
  const leader: UsMarketLookup = {
    title: input.globalTitle,
    category: input.category,
  };

  const match = await resolveUsMarketForExecution(leader);
  const allowed = Boolean(match.slug) && match.confidence >= minConfidence;

  return {
    allowed,
    confidence: match.confidence,
    reason: match.reason,
    usMarketSlug: match.slug,
  };
}
