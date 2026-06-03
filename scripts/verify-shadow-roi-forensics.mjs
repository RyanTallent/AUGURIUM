#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeShadowRoiForensics } = require("../packages/database/dist/shadow-roi-forensics.js");

async function main() {
  const report = await computeShadowRoiForensics();
  console.log("=== Shadow ROI forensics ===");
  console.log(`Sample: ${report.sampleSize}`);
  console.log(`Diagnosis: ${report.diagnosis}`);
  console.log(`Corrupt/anomaly trades: ${report.corruptTradeCount}`);
  console.log(`Engine mismatch (stored vs PnL): ${report.engineMismatchCount}`);
  console.log(`Mean stored ROI: ${(report.meanStoredRoi * 100).toFixed(2)}%`);
  console.log(`Mean authoritative ROI: ${(report.meanAuthoritativeRoi * 100).toFixed(2)}%`);
  console.log(
    `Mean authoritative (excl. anomalies): ${(report.meanAuthoritativeRoiExcludingAnomalies * 100).toFixed(2)}%`,
  );

  for (const [key, bucket] of Object.entries(report.anomalyBuckets)) {
    if (bucket.count > 0) {
      console.log(
        `  ${key}: ${bucket.count} (${(bucket.pctOfSample * 100).toFixed(1)}%) contrib=${bucket.contributionToMean.toFixed(2)}`,
      );
    }
  }

  const threshold = Number(process.env.READINESS_ROI_ANOMALY_MAX ?? "3");
  if (report.corruptTradeCount > threshold) {
    console.error(`FAIL: ${report.corruptTradeCount} ROI anomalies > ${threshold}`);
    process.exit(1);
  }
  console.log("PASS: ROI forensics within anomaly threshold");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
