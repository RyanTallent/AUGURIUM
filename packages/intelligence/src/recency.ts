/** Exponential recency weight; half-life in hours (default 18h). */
export function recencyWeight(tradedAt: Date, now: Date, halfLifeHours = 18): number {
  const ageMs = now.getTime() - tradedAt.getTime();
  if (ageMs < 0) return 1;
  const halfLifeMs = halfLifeHours * 60 * 60 * 1000;
  return Math.pow(0.5, ageMs / halfLifeMs);
}
