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
const { computeShadowPayoutAudit } = require("../packages/database/dist/shadow-payout-audit.js");

async function main() {
  const [readiness, shadow, forensics, dups, paper, payout] = await Promise.all([
    computeLiveTradingReadiness(),
    computeShadowAnalytics(),
    computeShadowRoiForensics(),
    auditShadowDuplicates(),
    computePaperValidation(),
    computeShadowPayoutAudit(200),
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
    "1. **Payout corruption**: Exit path could apply resolution-style PnL while UI showed flat entry≈exit (e.g. $3800 on $100 at 0.025/0.025).",
    "2. **Runner misuse**: Low entry treated as huge ROI without price reaching runner target (YES +50% → entry×1.5, not $1 unless resolved).",
    "3. **Stale repricing**: Closed shadows could be repriced without resetting realized PnL.",
    "4. **Zero ROI dominance**: Most closed trades lack post-entry marks — breakeven bucket, not wins.",
    "",
    "## Fixes applied",
    "",
    "- Centralized share-based payout (`packages/shadow/src/payout.ts`)",
    "- Exit rules + partial/runner/consensus collapse use correct formulas",
    "- `invalidForAnalytics` + `/shadow/payout-audit` + `npm run reconcile:shadow-payouts`",
    "- Closed shadows skip price-only DB updates",
    "- Readiness fails on impossible PnL, payout audit, invalid rows, ROI anomalies",
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
    `| Trustworthy sample | — | ${shadow.trustworthySampleCount} (excl. ${shadow.invalidExcludedCount} invalid) |`,
    "",
    "## Shadow payout audit",
    "",
    `Impossible PnL (entry≈exit, PnL≠0): **${payout.impossiblePnlCount}**`,
    `Invalid for analytics: **${payout.invalidCount}**`,
    `ROI > 100%: **${payout.roiGt100}** · > 500%: **${payout.roiGt500}** · > 1000%: **${payout.roiGt1000}**`,
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
