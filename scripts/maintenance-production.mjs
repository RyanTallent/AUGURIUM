#!/usr/bin/env node
/**
 * Production maintenance: diagnose, repair (optional), verify, report.
 * Usage: npm run maintenance:production [-- --dry-run]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const DRY_RUN = process.argv.includes("--dry-run");

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return { label, ok: r.status === 0, status: r.status ?? 1 };
}

async function main() {
  const { collectMaintenanceMetrics } = require(
    "../packages/database/dist/maintenance-metrics.js",
  );
  const { runProductionMaintenance } = require(
    "../packages/database/dist/production-maintenance.js",
  );

  const before = await collectMaintenanceMetrics();
  const verifySteps = [];

  verifySteps.push(
    run("npm", ["run", "db:generate"], "db:generate check"),
  );

  if (DRY_RUN) {
    console.log("\n=== backfill:categories (dry-run skip) ===");
    verifySteps.push({ label: "backfill:categories", ok: true, status: 0, skipped: true });
  } else {
    verifySteps.push(
      run("npm", ["run", "backfill:categories"], "backfill:categories"),
    );
  }

  const repair = await runProductionMaintenance({
    dryRun: DRY_RUN,
    reportPath: join(root, "PRODUCTION_MAINTENANCE_REPORT.md"),
  });

  repair.steps.push(
    ...verifySteps.map((v) => ({
      name: v.label,
      status: v.ok ? (DRY_RUN && v.skipped ? "dry_run" : "ok") : "failed",
      detail: { exitCode: v.status, skipped: v.skipped ?? false },
    })),
  );

  const verifyScripts = [
    "verify:shadow-roi-forensics",
    "verify:shadow-duplicates",
    "verify:production-health",
    "verify:readiness",
  ];

  for (const script of verifyScripts) {
    const v = run("npm", ["run", script], script);
    repair.steps.push({
      name: script,
      status: v.ok ? "ok" : "failed",
      detail: { exitCode: v.status },
    });
  }

  const after = await collectMaintenanceMetrics();

  const lines = [
    "# PRODUCTION MAINTENANCE REPORT",
    "",
    `Generated: ${after.generatedAt}`,
    `Mode: **${DRY_RUN ? "DRY RUN" : "LIVE REPAIR"}**`,
    "",
    "## Verdict",
    "",
    `**LIVE TRADING READY = ${after.liveTradingReady ? "YES" : "NO"}**`,
    "",
    `Readiness: **${after.readinessScore}/100**`,
    "",
    "## Metrics (before → after)",
    "",
    "| Metric | Before | After |",
    "|--------|--------|-------|",
    `| Impossible PnL | ${before.impossiblePnlCount} | ${after.impossiblePnlCount} |`,
    `| ROI anomalies | ${before.roiAnomalyCount} | ${after.roiAnomalyCount} |`,
    `| invalid_for_analytics | ${before.invalidForAnalyticsCount} | ${after.invalidForAnalyticsCount} |`,
    `| Duplicate active groups | ${before.duplicateActiveGroups} | ${after.duplicateActiveGroups} |`,
    `| Category coverage % | ${before.categoryCoveragePct} | ${after.categoryCoveragePct} |`,
    `| Scoring backlog | ${before.scoringEligibleBacklog} | ${after.scoringEligibleBacklog} |`,
    `| Shadow FRESH % | ${before.shadowFreshPct} | ${after.shadowFreshPct} |`,
    `| Shadow STALE % | ${before.shadowStalePct} | ${after.shadowStalePct} |`,
    `| Ingestion failures 24h | ${before.ingestionFailedRuns24h} | ${after.ingestionFailedRuns24h} |`,
    `| Worker heap MB | ${before.workerMemoryHeapUsedMb ?? "—"} | ${after.workerMemoryHeapUsedMb ?? "—"} |`,
    "",
    "## Steps",
    "",
    ...repair.steps.map((s) => `- ${s.name}: ${s.status}`),
    "",
  ];

  const reportPath = join(root, "PRODUCTION_MAINTENANCE_REPORT.md");
  writeFileSync(reportPath, lines.join("\n"), "utf8");

  console.log(`\nWrote ${reportPath}`);
  console.log(`LIVE TRADING READY = ${after.liveTradingReady ? "YES" : "NO"}`);

  const failedVerify = repair.steps.some(
    (s) => s.name.startsWith("verify:") && s.status === "failed",
  );
  if (repair.status === "failed" || failedVerify) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
