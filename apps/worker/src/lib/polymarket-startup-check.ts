import { computeLiveCopyReadiness } from "@augurium/copy-trading";
import {
  getExecutionConfig,
  hasConfigSecret,
  validateClobConnection,
  validatePolymarketUsConnection,
  isPolymarketUsReady,
} from "@augurium/execution";
import { resolveLiveCopyBankroll } from "./resolve-live-copy-bankroll.js";
import { notifyWorkerOnline } from "./live-copy-ops-discord.js";

export async function logPolymarketStartupCheck(): Promise<void> {
  if (process.env.LIVE_COPY_ENABLED !== "true") return;

  const cfg = getExecutionConfig();

  if (cfg.provider === "polymarket-us") {
    const hasKeyId = hasConfigSecret("POLYMARKET_US_KEY_ID");
    const hasSecret = hasConfigSecret("POLYMARKET_US_SECRET_KEY");
    if (!hasKeyId || !hasSecret) {
      console.warn(
        "[worker] polymarket-us: missing POLYMARKET_US_KEY_ID or POLYMARKET_US_SECRET_KEY — live copy will not trade",
      );
      return;
    }

    console.log("[worker] polymarket-us: checking US API");
    const us = await validatePolymarketUsConnection();
    if (us.ok) {
      console.log(`[worker] polymarket US ready: ${us.message}`);
    } else {
      console.error(`[worker] polymarket US FAILED: ${us.message}`);
    }
  } else {
    const hasKey = Boolean(process.env.POLYMARKET_PRIVATE_KEY?.trim());
    const hasFunder = Boolean(process.env.POLYMARKET_FUNDER_ADDRESS?.trim());
    if (!hasKey || !hasFunder) {
      console.warn(
        `[worker] polymarket: missing env (${!hasKey ? "POLYMARKET_PRIVATE_KEY " : ""}${!hasFunder ? "POLYMARKET_FUNDER_ADDRESS" : ""}) — live copy will not trade`,
      );
      return;
    }

    const sigType = process.env.POLYMARKET_SIGNATURE_TYPE ?? "1";
    console.log(`[worker] polymarket: checking CLOB (signatureType=${sigType})`);
    const clob = await validateClobConnection();
    if (clob.ok) {
      console.log(`[worker] polymarket CLOB ready: ${clob.message}`);
    } else {
      console.error(`[worker] polymarket CLOB FAILED: ${clob.message}`);
    }
  }

  const readiness = await computeLiveCopyReadiness();
  console.log(
    `[worker] live copy readiness: ready=${readiness.ready} mode=${readiness.executionMode} blockers=${readiness.blockers.length}`,
  );
  if (readiness.blockers.length > 0) {
    console.log("[worker] live copy blockers:", readiness.blockers);
  }

  if (process.env.LIVE_COPY_ENABLED === "true") {
    let bankrollUsd: number | null = null;
    try {
      const bankroll = await resolveLiveCopyBankroll();
      bankrollUsd = bankroll.bankrollUsd;
    } catch {
      bankrollUsd = null;
    }
    void notifyWorkerOnline({
      bankrollUsd,
      usReady: cfg.provider === "polymarket-us" ? isPolymarketUsReady() : false,
    }).catch((err) => console.warn("[discord] worker online notify failed", err));
  }
}
