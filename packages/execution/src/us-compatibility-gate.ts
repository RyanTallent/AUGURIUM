import {
  matchUsMarketFromCatalog,
  resolveUsMarketForExecution,
  getUsMatchMinConfidence,
  type UsMarketLookup,
} from "./polymarket-us-market-slug.js";
import {
  getCachedUsCatalogMatch,
  setCachedUsCatalogMatch,
} from "./us-catalog-match-cache.js";

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

/** Catalog-only match for leader refresh (no live US API verify). */
export async function evaluateUsCatalogMatch(
  input: UsCompatibilityInput,
): Promise<UsCompatibilityResult> {
  const cached = getCachedUsCatalogMatch(input.globalTitle, input.category);
  if (cached) return cached;

  const minConfidence = getUsMatchMinConfidence();
  const leader: UsMarketLookup = {
    title: input.globalTitle,
    category: input.category,
  };
  const match = await matchUsMarketFromCatalog(leader);
  const allowed = Boolean(match.slug) && match.confidence >= minConfidence;
  const result: UsCompatibilityResult = {
    allowed,
    confidence: match.confidence,
    reason: match.reason,
    usMarketSlug: match.slug,
  };
  setCachedUsCatalogMatch(input.globalTitle, input.category, result);
  return result;
}

/** US compatibility gate — catalog match + live US API verify at order time. */
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
