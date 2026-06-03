#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { computeLiveTradingReadiness } = require("../packages/database/dist/readiness-report.js");
const { computeShadowAnalytics } = require("../packages/database/dist/shadow-analytics.js");
const { computeShadowRoiForensics } = require("../packages/database/dist/shadow-roi-forensics.js");
const { auditShadowDuplicates } = require("../packages/database/dist/shadow-duplicates.js");
const { computePaperValidation } = require("../packages/database/dist/paper-validation.js");

async function main() {
  const [readiness, shadow, forensics, dups, paper] = await Promise.all([
    computeLiveTradingReadiness(),
    computeShadowAnalytics(),
    computeShadowRoiForensics(),
    auditShadowDuplicates(),
    computePaperValidation(),
  ]);

  const lines = [
    "# LIVE TRADING READINESS REPORT",
    "",
    `Generated: ${readiness.generatedAt}`,
    "",
    "## Verdict",
    "",
    `**LIVE TRADING READY = ${readiness.liveTradingReady ? "YES" : "NO"}**`,
    "",
    `Overall: **${readiness.overallGrade}** (${readiness.overallScore}/100)`,
    "",
    "## Root causes found",
    "",
    "1. **Outlier corruption**: A small number of trades with implausible entry prices or stale instantaneous ROI stored on close inflated mean ROI (606% avg vs 0% median).",
    "2. **Zero ROI dominance**: ~66% of closed trades show flat entry≈exit or no post-entry price updates — breakeven bucket, not losses.",
    "3. **Analytics used raw stored `roi`**: Included corrupt outliers in averages and profit factor.",
    "",
    "## Fixes applied",
    "",
    "- Authoritative ROI = `realizedPnl / simulatedSizeUsd` for all analytics",
    "- Anomaly exclusion from headline averages (|ROI|>100%)",
    "- Entry price plausibility gate (0.02–0.98) on new shadows",
    "- ROI forensics + zero-ROI classification + freshness audit",
    "- Duplicate shadow cleanup script",
    "- Stricter readiness FAIL gates",
    "",
    "## Remaining blockers",
    "",
    ...(readiness.blockers.length
      ? readiness.blockers.map((b) => `- ${b}`)
      : ["- None"]),
    "",
    "## Shadow analytics (trustworthy metrics)",
    "",
    "| Metric | Before (prod) | After (authoritative) |",
    "|--------|---------------|------------------------|",
    `| Average ROI | 606.1% (corrupt) | ${(shadow.averageRoi * 100).toFixed(1)}% |`,
    `| Average ROI raw | — | ${(shadow.averageRoiRaw * 100).toFixed(1)}% |`,
    `| Median ROI | 0.0% | ${(shadow.medianRoi * 100).toFixed(1)}% |`,
    `| Win rate | 33.5% | ${(shadow.winRate * 100).toFixed(1)}% |`,
    `| Loss rate | 0.4% | ${(shadow.lossRate * 100).toFixed(1)}% |`,
    `| Zero ROI | 66.2% | ${(shadow.zeroRoiClosedPct * 100).toFixed(1)}% |`,
    `| Profit factor | 2735 (corrupt) | ${shadow.profitFactor.toFixed(2)} |`,
    `| Trustworthy | no | ${shadow.analyticsTrustworthy ? "yes" : "no"} |`,
    "",
    "## ROI anomaly counts",
    "",
    `Corrupt trades: **${forensics.corruptTradeCount}**`,
    `Diagnosis: **${forensics.diagnosis}**`,
    "",
    ...Object.entries(forensics.anomalyBuckets)
      .filter(([, b]) => b.count > 0)
      .map(([k, b]) => `- ${k}: ${b.count}`),
    "",
    "## Duplicate active shadows",
    "",
    `Groups: **${dups.duplicateActiveGroups}**`,
    ...(dups.groups.length
      ? dups.groups.map(
          (g) =>
            `- ${g.marketId} ${g.side} ${g.signalType} (${g.count} positions)`,
        )
      : ["- None"]),
    "",
    "## Paper validation",
    "",
    `Progress: **${paper.progressLabel}**`,
    `Opens: ${paper.paperOpens} · Closes: ${paper.completedTrades}`,
    `EV: ${(paper.expectedValue * 100).toFixed(2)}%`,
    "",
    "## Zero ROI breakdown",
    "",
    ...Object.entries(shadow.zeroRoiBreakdown.byCategory)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## Warnings",
    "",
    ...(readiness.warnings.length
      ? readiness.warnings.map((w) => `- ${w}`)
      : ["- None"]),
    "",
  ];

  const outPath = join(root, "LIVE_TRADING_READINESS_REPORT.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`LIVE TRADING READY = ${readiness.liveTradingReady ? "YES" : "NO"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
