#!/usr/bin/env node
/**
 * Full production recovery: repair + forensics report.
 * Usage: npm run recovery:production [-- --dry-run]
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const require = createRequire(import.meta.url);

async function main() {
  if (!DRY_RUN) {
    console.log("=== backfill:categories ===");
    const bf = spawnSync("npm", ["run", "backfill:categories"], {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (bf.status !== 0) process.exit(bf.status ?? 1);
  }

  const { runProductionRecovery } = require(
    "../packages/database/dist/production-recovery.js",
  );
  const result = await runProductionRecovery({ dryRun: DRY_RUN });

  const verify = [
    "verify:shadow-roi-forensics",
    "verify:shadow-duplicates",
    "verify:production-health",
    "verify:readiness",
  ];
  for (const script of verify) {
    console.log(`\n=== ${script} ===`);
    spawnSync("npm", ["run", script], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  }

  console.log(`\nWrote ${result.reportPath}`);
  console.log(`LIVE TRADING READY = ${result.liveTradingReady ? "YES" : "NO"}`);
  console.log(`Paper start eligible = ${result.paperStartEligible ? "YES" : "NO"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
