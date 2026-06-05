import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectMaintenanceMetrics,
  computeLiveTradingReadiness,
  computeShadowTrustReport,
  computePortfolioRejectionSummary,
  computePaperValidation,
  getLastMaintenanceRun,
  prisma,
  type MaintenanceMetricsSnapshot,
} from "@augurium/database";
import { computeAcceptanceForensics } from "./acceptance-forensics.js";
import { computeCopyBoard } from "./compute-copy-board.js";
import { computeLiveCopyReadiness } from "./live-copy-readiness.js";
import { evaluateCopyWeeklyStopLoss } from "./copy-weekly-stop.js";
import { detectOutlierOpportunities } from "./outliers.js";

export interface CopyTradingReadinessReport {
  before: MaintenanceMetricsSnapshot | null;
  after: MaintenanceMetricsSnapshot;
  paperTradingReady: boolean;
  liveTradingReady: boolean;
  liveCopyReady: boolean;
  liveCopyBlockers: string[];
  topTradersToCopy: Array<{ address: string; copyScore: number; recommendation: string }>;
  copyPortfolioRecommendations: Array<{ id: string; label: string; roi30d: number }>;
  riskAllocations: string[];
  paperOpens: number;
  paperCloses: number;
  copyPaperOpens: number;
  copyPaperCloses: number;
  acceptedTrades: number;
  remainingBlockers: string[];
  repairsApplied: string[];
  generatedAt: string;
}

export async function computeCopyTradingReadiness(): Promise<CopyTradingReadinessReport> {
  const [after, readiness, shadowTrust, portfolio, paper, board, , lastMaint, liveCopy, weekly] =
    await Promise.all([
      collectMaintenanceMetrics(),
      computeLiveTradingReadiness(),
      computeShadowTrustReport(),
      computePortfolioRejectionSummary(),
      computePaperValidation(),
      computeCopyBoard(60),
      detectOutlierOpportunities(),
      getLastMaintenanceRun(),
      computeLiveCopyReadiness(),
      evaluateCopyWeeklyStopLoss(),
    ]);

  const copyPaperOpens = await prisma.copyPaperPosition.count({ where: { status: "OPEN" } });
  const copyPaperCloses = await prisma.copyPaperPosition.count({ where: { status: "CLOSED" } });

  const remainingBlockers: string[] = [];
  if (after.impossiblePnlCount > 0) {
    remainingBlockers.push(`${after.impossiblePnlCount} impossible PnL`);
  }
  if (after.duplicateActiveGroups > 0) {
    remainingBlockers.push(`${after.duplicateActiveGroups} duplicate shadow groups`);
  }
  if (!shadowTrust.trustworthy) {
    remainingBlockers.push("shadow trust checks failing");
  }
  if (!readiness.shadowAnalyticsTrustworthy) {
    remainingBlockers.push("shadow analytics not trustworthy");
  }
  if (board.topTradersToday.length === 0) {
    remainingBlockers.push("no traders meet COPY criteria today");
  }
  if (paper.completedTrades < 100) {
    remainingBlockers.push(
      `paper closes ${paper.completedTrades}/100 required for paper validation`,
    );
  }
  if (!liveCopy.ready) {
    remainingBlockers.push(...liveCopy.blockers.slice(0, 3).map((b) => `live copy: ${b}`));
  }
  if (weekly.halted) {
    remainingBlockers.push(weekly.haltedReason ?? "weekly copy loss limit");
  }

  const repairsApplied: string[] = [];
  if (lastMaint?.steps?.length) {
    for (const s of lastMaint.steps) {
      if (s.status === "ok" && s.detail) {
        repairsApplied.push(`${s.name}: ${JSON.stringify(s.detail)}`);
      }
    }
  }

  const paperTradingReady =
    after.impossiblePnlCount === 0 &&
    after.duplicateActiveGroups === 0 &&
    shadowTrust.trustworthy &&
    readiness.shadowAnalyticsTrustworthy &&
    board.topTradersToday.length > 0;

  const before = lastMaint?.before as MaintenanceMetricsSnapshot | null;

  return {
    before,
    after,
    paperTradingReady,
    liveTradingReady: readiness.liveTradingReady,
    liveCopyReady: liveCopy.ready,
    liveCopyBlockers: liveCopy.blockers,
    topTradersToCopy: board.topTradersToday.slice(0, 10).map((t) => ({
      address: t.address,
      copyScore: t.copyScore,
      recommendation: t.recommendation,
    })),
    copyPortfolioRecommendations: board.strategies.map((s) => ({
      id: s.id,
      label: s.label,
      roi30d: s.roi30d,
    })),
    riskAllocations: [
      "max 5% capital per trader",
      "max 20% per market",
      "max 20% per category",
      "max 30% per event",
      "max 20% trader drawdown before auto-disable",
    ],
    paperOpens: portfolio.paperOpens,
    paperCloses: portfolio.paperCloses,
    copyPaperOpens,
    copyPaperCloses,
    acceptedTrades: portfolio.accepted,
    remainingBlockers,
    repairsApplied,
    generatedAt: new Date().toISOString(),
  };
}

export function formatCopyTradingReadinessMarkdown(
  r: CopyTradingReadinessReport,
  acceptance: Awaited<ReturnType<typeof computeAcceptanceForensics>>,
  outlierCount: number,
): string {
  const b = r.before;
  const a = r.after;
  return [
    "# FINAL COPY TRADING READINESS REPORT",
    "",
    `Generated: ${r.generatedAt}`,
    "",
    "## Verdict",
    "",
    `**PAPER TRADING READY = ${r.paperTradingReady ? "YES" : "NO"}**`,
    "",
    `**LIVE TRADING READY = ${r.liveTradingReady ? "YES" : "NO"}** (live/real money remain OFF by policy)`,
    "",
    "## Metrics (before → after)",
    "",
    "| Metric | Before | After |",
    "|--------|--------|-------|",
    `| Readiness score | ${b?.readinessScore ?? "—"} | ${a.readinessScore} |`,
    `| Impossible PnL | ${b?.impossiblePnlCount ?? "—"} | ${a.impossiblePnlCount} |`,
    `| ROI anomalies (valid rows) | ${b?.roiAnomalyCount ?? "—"} | ${a.roiAnomalyCount} |`,
    `| Duplicate groups | ${b?.duplicateActiveGroups ?? "—"} | ${a.duplicateActiveGroups} |`,
    `| Analytics trust | — | ${r.remainingBlockers.includes("shadow analytics not trustworthy") ? "FAIL" : "OK"} |`,
    `| Category coverage % | ${b?.categoryCoveragePct ?? "—"} | ${a.categoryCoveragePct} |`,
    `| Paper opens | — | ${r.paperOpens} |`,
    `| Paper closes | — | ${r.paperCloses} |`,
    `| Copy paper opens | — | ${r.copyPaperOpens} |`,
    `| Copy paper closes | — | ${r.copyPaperCloses} |`,
    `| Portfolio ACCEPT | — | ${r.acceptedTrades} |`,
    "",
    "## Top traders to copy",
    "",
    ...(r.topTradersToCopy.length
      ? r.topTradersToCopy.map(
          (t) => `- \`${t.address}\` — score ${t.copyScore} (${t.recommendation})`,
        )
      : ["- None meet COPY gates today"]),
    "",
    "## Copy portfolio recommendations",
    "",
    ...r.copyPortfolioRecommendations.map(
      (s) => `- **${s.label}** — est. 30d ROI ${(s.roi30d * 100).toFixed(1)}%`,
    ),
    "",
    "## Risk allocations",
    "",
    ...r.riskAllocations.map((x) => `- ${x}`),
    "",
    "## Acceptance bottleneck forensics",
    "",
    `Acceptance rate: ${(acceptance.acceptanceRate * 100).toFixed(1)}% (${acceptance.accepted} ACCEPT / ${acceptance.rejected} REJECT)`,
    "",
    "### Threshold bottlenecks",
    ...acceptance.thresholdBottlenecks.map((x) => `- ${x}`),
    "",
    "### Signal bottlenecks",
    ...acceptance.signalBottlenecks.map((x) => `- ${x}`),
    "",
    "### Allocation bottlenecks",
    ...acceptance.allocationBottlenecks.map((x) => `- ${x}`),
    "",
    "## Outlier opportunities (surface only)",
    "",
    `${outlierCount} flagged — never auto-traded`,
    "",
    "## Production repairs applied",
    "",
    ...(r.repairsApplied.length
      ? r.repairsApplied.map((x) => `- ${x}`)
      : ["- No maintenance run recorded on this database"]),
    "",
    "## Remaining blockers",
    "",
    ...(r.remainingBlockers.length ? r.remainingBlockers.map((x) => `- ${x}`) : ["- None"]),
    "",
    "## Why live trading stays NO",
    "",
    "- `EXECUTION_ENABLED` / `LIVE_TRADING_ENABLED` / `ALLOW_REAL_MONEY` must not be enabled without explicit ops review",
    "- Readiness gates for shadow integrity and paper validation must pass first",
    "",
    "## Exact next step",
    "",
    r.paperTradingReady
      ? "Enable `PAPER_COPY_ENABLED=true` on worker only; keep live flags false; monitor `/copy` and copy paper positions."
      : "Run `npm run recovery:production` on Render worker against production DATABASE_URL, then re-run this report.",
    "",
  ].join("\n");
}

export async function writeCopyTradingReadinessReport(
  path = join(process.cwd(), "FINAL_COPY_TRADING_READINESS_REPORT.md"),
): Promise<CopyTradingReadinessReport> {
  const [r, acceptance, outliers] = await Promise.all([
    computeCopyTradingReadiness(),
    computeAcceptanceForensics(),
    detectOutlierOpportunities(),
  ]);
  writeFileSync(path, formatCopyTradingReadinessMarkdown(r, acceptance, outliers.length), "utf8");
  return r;
}
