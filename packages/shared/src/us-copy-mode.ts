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

export function getUsCompatMinConfidence(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): number {
  const raw = env.US_COMPAT_MIN_CONFIDENCE;
  if (raw != null && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (isUsBroadIntelMode(env)) return 0.75;
  return 0.9;
}

export function shouldTryGlobalSlugOnUs(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  if (env.US_COMPAT_TRY_GLOBAL_SLUG === "false") return false;
  if (env.US_COMPAT_TRY_GLOBAL_SLUG === "true") return true;
  return isUsBroadIntelMode(env);
}

export function shouldRelaxUsSlugMatch(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  if (env.US_COMPAT_RELAXED_SLUG === "false") return false;
  if (env.US_COMPAT_RELAXED_SLUG === "true") return true;
  return isUsBroadIntelMode(env);
}

/** Re-enable score-traders, full COPY controls, rising wallets while executing on Polymarket US. */
export function isUsBroadIntelMode(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  if (env.COPY_US_BROAD_INTEL === "false" || env.COPY_US_BROAD_INTEL === "0") {
    return false;
  }
  if (env.COPY_US_BROAD_INTEL === "true" || env.COPY_US_BROAD_INTEL === "1") {
    return true;
  }
  // Default on for US live copy when env not synced from blueprint yet.
  return isUsOnlyLiveCopyMode(env);
}
