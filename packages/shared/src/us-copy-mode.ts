/** US-only live copy: Polymarket US execution with PolymarketScan intelligence. */
export function isUsOnlyLiveCopyMode(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  return env.EXECUTION_PROVIDER === "polymarket-us" && env.LIVE_COPY_ENABLED === "true";
}

/** Intelligence from PolymarketScan API (not global wallet master / holder scan). */
export function usePolymarketScanIntel(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  if (env.COPY_INTEL_SOURCE === "polymarketscan") return true;
  return isUsOnlyLiveCopyMode(env);
}

export function requirePolymarketUsForLiveCopy(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): { ok: true } | { ok: false; reason: string } {
  if (!isUsOnlyLiveCopyMode(env)) return { ok: true };
  if (env.EXECUTION_PROVIDER !== "polymarket-us") {
    return {
      ok: false,
      reason: `LIVE_COPY requires EXECUTION_PROVIDER=polymarket-us (current: ${env.EXECUTION_PROVIDER ?? "unset"})`,
    };
  }
  return { ok: true };
}
