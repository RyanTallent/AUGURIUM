import { getProductionHealthReport } from "./production-health.js";
import { computeShadowAnalytics } from "./shadow-analytics.js";
import { auditShadowDuplicates } from "./shadow-duplicates.js";
import { computeSignalValidation } from "./signal-validation.js";
import { computePortfolioValidation } from "./portfolio-validation.js";
import { computePaperValidation } from "./paper-validation.js";
import { computeShadowRoiForensics } from "./shadow-roi-forensics.js";
import { auditShadowFreshness } from "./shadow-freshness-audit.js";
import { computeShadowPayoutAudit, countImpossiblePnl } from "./shadow-payout-audit.js";
import { prisma } from "./client.js";
import type { ReadinessGrade } from "./portfolio-validation.js";

export interface ReadinessSection {
  name: string;
  grade: ReadinessGrade;
  summary: string;
  details: Record<string, unknown>;
}

export interface LiveTradingReadinessReport {
  overallScore: number;
  overallGrade: ReadinessGrade;
  liveTradingAllowed: boolean;
  liveTradingReady: boolean;
  blockers: string[];
  warnings: string[];
  sections: ReadinessSection[];
  shadowAnalyticsTrustworthy: boolean;
  shadowPayoutAuditPass: boolean;
  roiAnomalyCount: number;
  impossiblePnlCount: number;
  invalidForAnalyticsCount: number;
  duplicateActiveGroups: number;
  paperProgressLabel: string;
  zeroRoiBreakdown: Record<string, number>;
  cleanedAverageRoi: number;
  medianRoi: number;
  generatedAt: string;
}

const ROI_ANOMALY_FAIL_THRESHOLD = Number(
  process.env.READINESS_ROI_ANOMALY_MAX ?? "3",
);
const INVALID_ANALYTICS_THRESHOLD = Number(
  process.env.READINESS_INVALID_ANALYTICS_MAX ?? "5",
);
const STALE_SHADOW_WARNING_PCT = Number(
  process.env.READINESS_STALE_SHADOW_PCT ?? "50",
);

export async function computeLiveTradingReadiness(): Promise<LiveTradingReadinessReport> {
  const [
    health,
    shadow,
    duplicates,
    signals,
    portfolio,
    paper,
    forensics,
    freshness,
    payoutAudit,
    impossiblePnl,
    invalidForAnalyticsCount,
    executionRecon,
  ] = await Promise.all([
    getProductionHealthReport(),
    computeShadowAnalytics(),
    auditShadowDuplicates(),
    computeSignalValidation(),
    computePortfolioValidation(),
    computePaperValidation(),
    computeShadowRoiForensics(),
    auditShadowFreshness(),
    computeShadowPayoutAudit(50),
    countImpossiblePnl(),
    prisma.shadowTrade.count({
      where: { invalidForAnalytics: true, status: { in: ["CLOSED", "EXPIRED"] } },
    }),
    prisma.executionReconciliation.findUnique({ where: { id: "current" } }),
  ]);

  const blockers: string[] = [];
  const warnings: string[] = [];

  const roiAnomalyCount = forensics.corruptTradeCount;
  const shadowPayoutAuditPass =
    impossiblePnl === 0 && payoutAudit.impossiblePnlCount === 0;

  if (impossiblePnl > 0) {
    blockers.push(`${impossiblePnl} impossible PnL trades (entry=exit, PnL≠0)`);
  }
  if (!shadow.analyticsTrustworthy) {
    blockers.push("Shadow analytics not trustworthy");
  }
  if (!shadowPayoutAuditPass) {
    blockers.push("Shadow payout audit FAIL");
  }
  if (roiAnomalyCount > ROI_ANOMALY_FAIL_THRESHOLD) {
    blockers.push(`ROI anomalies: ${roiAnomalyCount}`);
  }
  if (invalidForAnalyticsCount > INVALID_ANALYTICS_THRESHOLD) {
    blockers.push(`Invalid for analytics: ${invalidForAnalyticsCount}`);
  }
  if (duplicates.duplicateActiveGroups > 0) {
    blockers.push(`${duplicates.duplicateActiveGroups} duplicate active shadow groups`);
  }
  if (!paper.meetsMinimumSample) {
    blockers.push(`Paper validation ${paper.progressLabel}`);
  }
  if (!health.shadowSyncRunAcceptable) {
    blockers.push("Shadow sync run not acceptable");
  }

  const executionOk = executionRecon?.status === "OK";
  if (!executionOk) {
    blockers.push("Execution reconciliation not OK");
  }

  if (health.shadowStalePct > STALE_SHADOW_WARNING_PCT) {
    warnings.push(`Stale shadow pricing ${health.shadowStalePct.toFixed(0)}%`);
  }
  if (!health.scoringHealthy) {
    warnings.push("Scoring backlog");
  }

  const shadowGrade: ReadinessGrade =
    shadowPayoutAuditPass &&
    shadow.analyticsTrustworthy &&
    duplicates.duplicateActiveGroups === 0 &&
    impossiblePnl === 0
      ? "PASS"
      : "FAIL";

  const sections: ReadinessSection[] = [
    {
      name: "Ingestion",
      grade: health.walletsTotal > 1000 ? "PASS" : "WARNING",
      summary: `${health.walletsTotal} wallets`,
      details: { walletsTotal: health.walletsTotal },
    },
    {
      name: "Scoring",
      grade: health.scoringHealthy ? "PASS" : "WARNING",
      summary: health.scoringHealthy ? "Complete" : "Backlog",
      details: { scoredWallets: health.scoredWallets },
    },
    {
      name: "Signals",
      grade: "WARNING",
      summary: `TRADE_NOW active: ${signals.activeByType.TRADE_NOW ?? 0}`,
      details: signals as unknown as Record<string, unknown>,
    },
    {
      name: "Shadow payout",
      grade: shadowPayoutAuditPass ? "PASS" : "FAIL",
      summary: `Impossible PnL: ${impossiblePnl} · invalid: ${invalidForAnalyticsCount}`,
      details: { payoutAudit, shadow, forensics },
    },
    {
      name: "Shadow",
      grade: shadowGrade,
      summary: `Trustworthy n=${shadow.trustworthySampleCount} · cleaned avg ${(shadow.averageRoi * 100).toFixed(1)}%`,
      details: { shadow, duplicates, freshness },
    },
    {
      name: "Portfolio",
      grade: portfolio.grade,
      summary: `${portfolio.openPositions} open`,
      details: portfolio as unknown as Record<string, unknown>,
    },
    {
      name: "Execution",
      grade:
        paper.meetsMinimumSample && paper.expectedValue > 0 && executionOk
          ? "PASS"
          : "FAIL",
      summary: `Paper ${paper.progressLabel} · recon ${executionRecon?.status ?? "unknown"}`,
      details: { paper, executionRecon },
    },
    {
      name: "Discord",
      grade: "WARNING",
      summary: "Env-gated",
      details: {},
    },
  ];

  const passCount = sections.filter((s) => s.grade === "PASS").length;
  const overallScore = Math.round((passCount / sections.length) * 100);
  let overallGrade: ReadinessGrade = "FAIL";
  if (blockers.length === 0 && overallScore >= 85) overallGrade = "PASS";
  else if (blockers.length === 0) overallGrade = "WARNING";

  const liveTradingReady =
    blockers.length === 0 &&
    shadowPayoutAuditPass &&
    shadow.analyticsTrustworthy &&
    paper.meetsMinimumSample &&
    paper.expectedValue > 0 &&
    executionOk;

  return {
    overallScore,
    overallGrade,
    liveTradingAllowed: liveTradingReady,
    liveTradingReady,
    blockers,
    warnings,
    sections,
    shadowAnalyticsTrustworthy: shadow.analyticsTrustworthy,
    shadowPayoutAuditPass,
    roiAnomalyCount,
    impossiblePnlCount: impossiblePnl,
    invalidForAnalyticsCount,
    duplicateActiveGroups: duplicates.duplicateActiveGroups,
    paperProgressLabel: paper.progressLabel,
    zeroRoiBreakdown: shadow.zeroRoiBreakdown.byCategory,
    cleanedAverageRoi: shadow.averageRoi,
    medianRoi: shadow.medianRoi,
    generatedAt: new Date().toISOString(),
  };
}
