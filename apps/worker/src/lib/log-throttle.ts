const counts = new Map<string, number>();

/** Aggregate repetitive log lines; flush summary periodically. */
export function noteThrottledLog(key: string, increment = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + increment);
}

export function flushThrottledLogs(prefix: string): void {
  if (counts.size === 0) return;
  const parts: string[] = [];
  for (const [key, n] of counts) {
    parts.push(`${key}=${n}`);
  }
  console.log(`[${prefix}] aggregated skips: ${parts.join(", ")}`);
  counts.clear();
}
