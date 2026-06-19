/** US-only live copy: Polymarket US execution — all markets are native US. */
export function isUsOnlyLiveCopyMode(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  return env.EXECUTION_PROVIDER === "polymarket-us" && env.LIVE_COPY_ENABLED === "true";
}

/** True when running the US-only architecture (default for US live copy). */
export function isUsOnlyArchitecture(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  if (env.COPY_US_ONLY_ARCHITECTURE === "false") return false;
  return isUsOnlyLiveCopyMode(env);
}

/**
 * @deprecated PolymarketScan is no longer the primary intel source.
 * Only enabled when explicitly set via COPY_INTEL_SOURCE=polymarketscan.
 */
export function usePolymarketScanIntel(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  return env.COPY_INTEL_SOURCE === "polymarketscan";
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

/** @deprecated US compatibility scoring removed — all catalog markets are US-native. */
export function getUsCompatMinConfidence(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): number {
  const raw = env.US_COMPAT_MIN_CONFIDENCE;
  if (raw != null && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

/** @deprecated */
export function shouldTryGlobalSlugOnUs(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  return env.US_COMPAT_TRY_GLOBAL_SLUG === "true";
}

/** @deprecated */
export function shouldRelaxUsSlugMatch(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  return env.US_COMPAT_RELAXED_SLUG === "true";
}

/**
 * @deprecated Global broad intel path disabled in US-only architecture.
 */
export function isUsBroadIntelMode(
  env: Record<string, string | undefined> = globalThis.process?.env ?? {},
): boolean {
  if (!isUsOnlyArchitecture(env)) {
    return env.COPY_US_BROAD_INTEL === "true" || env.COPY_US_BROAD_INTEL === "1";
  }
  return false;
}
