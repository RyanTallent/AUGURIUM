/** @deprecated US compatibility gates removed — all markets are native US. */

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

export async function evaluateUsCatalogMatch(
  input: UsCompatibilityInput,
): Promise<UsCompatibilityResult> {
  const slug = input.globalSlug?.trim() ?? null;
  return {
    allowed: Boolean(slug),
    confidence: 1,
    reason: "us-native-market",
    usMarketSlug: slug,
  };
}

export async function evaluateUsCompatibilityGate(
  input: UsCompatibilityInput,
): Promise<UsCompatibilityResult> {
  return evaluateUsCatalogMatch(input);
}
