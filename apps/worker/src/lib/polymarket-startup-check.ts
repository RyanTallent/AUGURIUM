import { computeLiveCopyReadiness } from "@augurium/copy-trading";
import { validateClobConnection } from "@augurium/execution";

export async function logPolymarketStartupCheck(): Promise<void> {
  if (process.env.LIVE_COPY_ENABLED !== "true") return;

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

  const readiness = await computeLiveCopyReadiness();
  console.log(
    `[worker] live copy readiness: ready=${readiness.ready} mode=${readiness.executionMode} blockers=${readiness.blockers.length}`,
  );
  if (readiness.blockers.length > 0) {
    console.log("[worker] live copy blockers:", readiness.blockers);
  }
}
