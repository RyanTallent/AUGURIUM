/** In-process funnel streak tracking (resets on worker restart). */
let consecutiveZeroCopyEnabled = 0;

export function recordCopyEnabledStreak(copyEnabled: number): {
  streak: number;
  shouldWarn: boolean;
} {
  if (copyEnabled > 0) {
    consecutiveZeroCopyEnabled = 0;
    return { streak: 0, shouldWarn: false };
  }
  consecutiveZeroCopyEnabled += 1;
  return {
    streak: consecutiveZeroCopyEnabled,
    shouldWarn: consecutiveZeroCopyEnabled >= 3,
  };
}

export function getCopyEnabledStreak(): number {
  return consecutiveZeroCopyEnabled;
}
