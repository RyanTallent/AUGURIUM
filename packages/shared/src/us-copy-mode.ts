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

/** Strict US catalog match threshold — default 0.90, never lowered by broad intel. */
export function getUsCompatMinConfidence(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): number {
  const raw = env.US_COMPAT_MIN_CONFIDENCE;
  if (raw != null && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0.9;
}

/** Global slug translation on US — disabled unless explicitly enabled (default off). */
export function shouldTryGlobalSlugOnUs(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  return env.US_COMPAT_TRY_GLOBAL_SLUG === "true";
}

/** Relaxed slug matching — disabled unless explicitly enabled (default off). */
export function shouldRelaxUsSlugMatch(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  return env.US_COMPAT_RELAXED_SLUG === "true";
}

/**
 * Broad intel path (global trade ingest, score-traders, rising wallets).
 * Default OFF — opt in with COPY_US_BROAD_INTEL=true.
 */
export function isUsBroadIntelMode(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  if (env.COPY_US_BROAD_INTEL === "false" || env.COPY_US_BROAD_INTEL === "0") {
    return false;
  }
  if (env.COPY_US_BROAD_INTEL === "true" || env.COPY_US_BROAD_INTEL === "1") {
    return true;
  }
  return false;
}
