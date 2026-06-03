const TIER_WEIGHTS: Record<string, number> = {
  SUPER_ELITE: 1.5,
  ELITE: 1.3,
  RISING: 1.15,
  PROSPECT: 1.0,
  UNRANKED: 0.55,
};

export function tierWeight(tier: string): number {
  return TIER_WEIGHTS[tier] ?? 0.55;
}
