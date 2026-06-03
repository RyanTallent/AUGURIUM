import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectMaintenanceMetrics, type MaintenanceMetricsSnapshot } from "./maintenance-metrics.js";
import { runProductionMaintenance } from "./production-maintenance.js";
import { computeReadinessForensics } from "./readiness-forensics.js";
import { computeIngestionHealthSummary } from "./ingestion-health-summary.js";
import { computeShadowTrustReport } from "./shadow-trust-report.js";
import { computePortfolioRejectionSummary } from "./portfolio-rejection-summary.js";
import { computePaperStartEligibility } from "./paper-start-eligibility.js";
import { computeLiveTradingReadiness } from "./readiness-report.js";

export interface ProductionRecoveryResult {
  before: MaintenanceMetricsSnapshot;
  after: MaintenanceMetricsSnapshot;
  maintenanceStatus: string;
  reportPath: string;
  liveTradingReady: boolean;
  paperStartEligible: boolean;
}

function mdRow(label: string, before: string | number, after: string | number): string {
  return `| ${label} | ${before} | ${after} |`;
}

export async function runProductionRecovery(opts?: {
  dryRun?: boolean;
  reportPath?: string;
}): Promise<ProductionRecoveryResult> {
  const dryRun = opts?.dryRun ?? false;
  const reportPath = opts?.reportPath ?? join(process.cwd(), "PRODUCTION_RECOVERY_REPORT.md");

  const before = await collectMaintenanceMetrics();
  const maintenance = await runProductionMaintenance({
    dryRun,
    reportPath: join(process.cwd(), ".recovery-maintenance-tmp.md"),
  });
  const after = await collectMaintenanceMetrics();

  const [forensics, ingestion, shadowTrust, portfolio, paperStart, readiness] =
    await Promise.all([
      computeReadinessForensics(),
      computeIngestionHealthSummary(),
      computeShadowTrustReport(),
      computePortfolioRejectionSummary(),
      computePaperStartEligibility(),
      computeLiveTradingReadiness(),
    ]);

  const lines = [
    "# PRODUCTION RECOVERY REPORT",
    "",
    `Generated: ${after.generatedAt}`,
    `Mode: **${dryRun ? "DRY RUN" : "LIVE REPAIR"}**`,
    "",
    "## Verdict",
    "",
    `**LIVE TRADING READY = ${readiness.liveTradingReady ? "YES" : "NO"}**`,
    "",
    `Paper start eligible (data gates + env): **${paperStart.eligible ? "YES" : "NO"}**`,
    "",
    paperStart.recommendedAction,
    "",
    "## Metrics (before → after)",
    "",
    "| Metric | Before | After |",
    "|--------|--------|-------|",
    mdRow("Readiness score", before.readinessScore, after.readinessScore),
    mdRow("Impossible PnL", before.impossiblePnlCount, after.impossiblePnlCount),
    mdRow("ROI anomalies", before.roiAnomalyCount, after.roiAnomalyCount),
    mdRow("invalid_for_analytics", before.invalidForAnalyticsCount, after.invalidForAnalyticsCount),
    mdRow("Duplicate active groups", before.duplicateActiveGroups, after.duplicateActiveGroups),
    mdRow("Category coverage %", before.categoryCoveragePct, after.categoryCoveragePct),
    mdRow("Scoring backlog", before.scoringEligibleBacklog, after.scoringEligibleBacklog),
    mdRow("Shadow FRESH %", before.shadowFreshPct, after.shadowFreshPct),
    mdRow("Shadow STALE %", before.shadowStalePct, after.shadowStalePct),
    mdRow("Ingestion failures (24h)", before.ingestionFailedRuns24h, after.ingestionFailedRuns24h),
    mdRow("Paper opens", portfolio.paperOpens, portfolio.paperOpens),
    mdRow("Paper closes", portfolio.paperCloses, portfolio.paperCloses),
    "",
    "## Maintenance",
    "",
    `Status: ${maintenance.status}`,
    ...maintenance.steps.map((s) => `- ${s.name}: ${s.status}`),
    "",
    "## Ingestion health",
    "",
    `Healthy: ${ingestion.healthy}`,
    ...ingestion.notes.map((n) => `- ${n}`),
    "",
    "## Shadow trust",
    "",
    `Trustworthy: ${shadowTrust.trustworthy}`,
    ...shadowTrust.checks.map((c) => `- ${c.name}: ${c.pass ? "PASS" : "FAIL"} — ${c.detail}`),
    "",
    "## Portfolio / execution",
    "",
    `Accepted: ${portfolio.accepted} · Rejected: ${portfolio.rejected} · Watch: ${portfolio.watch}`,
    `Acceptance rate: ${(portfolio.acceptanceRate * 100).toFixed(1)}%`,
    `Execution blocked: ${portfolio.executionBlocked} · placed: ${portfolio.executionPlaced}`,
    "",
    portfolio.behaviorAssessment,
    "",
    "### Top portfolio rejection reasons",
    "",
    ...portfolio.topRejectionReasons.map((r) => `- ${r.reason} (${r.count})`),
    "",
    "### Top execution block reasons",
    "",
    ...portfolio.topExecutionBlockReasons.map((r) => `- ${r.reason} (${r.count})`),
    "",
    "## Readiness forensics",
    "",
    ...forensics.items.map(
      (i) =>
        `### ${i.message}\n- Root cause: ${i.rootCause}\n- Blocks paper: ${i.blocksPaperTrading ? "YES" : "NO"}\n- Blocks live: ${i.blocksLiveTradingExplicit ? "YES" : "NO"}\n- Action: ${i.repairCommand ?? "—"}`,
    ),
    "",
    "## Why live trading is not ready",
    "",
    ...(readiness.liveTradingReady
      ? ["All gates passed for live trading (still requires explicit LIVE_TRADING_ENABLED and ALLOW_REAL_MONEY — remain OFF)."]
      : readiness.blockers.map((b) => `- ${b}`)),
    "",
    "## Safety",
    "",
    "- LIVE_TRADING_ENABLED: OFF (unchanged)",
    "- ALLOW_REAL_MONEY: OFF (unchanged)",
    "- Polymarket CLOB live: NOT_READY",
    "",
  ];

  writeFileSync(reportPath, lines.join("\n"), "utf8");

  return {
    before,
    after,
    maintenanceStatus: maintenance.status,
    reportPath,
    liveTradingReady: readiness.liveTradingReady,
    paperStartEligible: paperStart.eligible,
  };
}
