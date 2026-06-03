import { getProductionHealthReport } from "./production-health.js";
import { computeShadowAnalytics } from "./shadow-analytics.js";
import { auditShadowDuplicates } from "./shadow-duplicates.js";
import { computeSignalValidation } from "./signal-validation.js";
import { computePortfolioValidation } from "./portfolio-validation.js";
import { computePaperValidation } from "./paper-validation.js";
import { computeShadowRoiForensics } from "./shadow-roi-forensics.js";
import { auditShadowFreshness } from "./shadow-freshness-audit.js";
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
  roiAnomalyCount: number;
  duplicateActiveGroups: number;
  paperProgressLabel: string;
  zeroRoiBreakdown: Record<string, number>;
  generatedAt: string;
}

const ROI_ANOMALY_FAIL_THRESHOLD = Number(
  process.env.READINESS_ROI_ANOMALY_MAX ?? "3",
);
const STALE_SHADOW_WARNING_PCT = Number(
  process.env.READINESS_STALE_SHADOW_PCT ?? "50",
);

export async function computeLiveTradingReadiness(): Promise<LiveTradingReadinessReport> {
  const [health, shadow, duplicates, signals, portfolio, paper, forensics, freshness] =
    await Promise.all([
      getProductionHealthReport(),
      computeShadowAnalytics(),
      auditShadowDuplicates(),
      computeSignalValidation(),
      computePortfolioValidation(),
      computePaperValidation(),
      computeShadowRoiForensics(),
      auditShadowFreshness(),
    ]);

  const blockers: string[] = [];
  const warnings: string[] = [];

  const roiAnomalyCount = forensics.corruptTradeCount;

  if (!shadow.analyticsTrustworthy) {
    blockers.push("Shadow analytics corrupted or untrustworthy");
  }
  if (roiAnomalyCount > ROI_ANOMALY_FAIL_THRESHOLD) {
    blockers.push(
      `ROI anomalies: ${roiAnomalyCount} trades exceed ${ROI_ANOMALY_FAIL_THRESHOLD} threshold`,
    );
  }
  if (duplicates.duplicateActiveGroups > 0) {
    blockers.push(`${duplicates.duplicateActiveGroups} duplicate active shadow groups`);
  }
  if (!paper.meetsMinimumSample) {
    blockers.push(`Paper validation ${paper.progressLabel} (need 100 closes)`);
  }
  if (!health.shadowSyncRunAcceptable) {
    blockers.push("Shadow sync run not acceptable");
  }

  if (health.shadowStalePct > STALE_SHADOW_WARNING_PCT) {
    warnings.push(`Stale shadow pricing ${health.shadowStalePct.toFixed(0)}%`);
  }
  if (!health.scoringHealthy) {
    warnings.push("Scoring backlog on eligible wallets");
  }
  if ((signals.activeByType.TRADE_NOW ?? 0) === 0 && signals.recentBaseTradeNowCount > 0) {
    warnings.push("TRADE_NOW quality gates block all promotions");
  }
  if (!freshness.sumMatchesTotal) {
    warnings.push("Shadow freshness counts do not sum to total");
  }

  const shadowGrade: ReadinessGrade =
    shadow.analyticsTrustworthy &&
    duplicates.duplicateActiveGroups === 0 &&
    roiAnomalyCount <= ROI_ANOMALY_FAIL_THRESHOLD
      ? "PASS"
      : "FAIL";

  const sections: ReadinessSection[] = [
    {
      name: "Ingestion",
      grade: health.walletsTotal > 1000 ? "PASS" : "WARNING",
      summary: `${health.walletsTotal} wallets ingested`,
      details: { walletsTotal: health.walletsTotal },
    },
    {
      name: "Scoring",
      grade: health.scoringHealthy ? "PASS" : "WARNING",
      summary: health.scoringHealthy
        ? "Eligible wallet scoring complete"
        : "Scoring backlog remains",
      details: {
        scoredWallets: health.scoredWallets,
        unscoredEligibleRemaining: health.unscoredEligibleRemaining,
      },
    },
    {
      name: "Signals",
      grade: "WARNING",
      summary: `Active TRADE_NOW: ${signals.activeByType.TRADE_NOW ?? 0}`,
      details: signals as unknown as Record<string, unknown>,
    },
    {
      name: "Shadow",
      grade: shadowGrade,
      summary: `Trustworthy: ${shadow.analyticsTrustworthy} · anomalies: ${roiAnomalyCount} · zero ROI: ${(shadow.zeroRoiClosedPct * 100).toFixed(0)}%`,
      details: {
        shadow,
        duplicates,
        forensics: { diagnosis: forensics.diagnosis, corruptTradeCount: roiAnomalyCount },
        freshness,
      },
    },
    {
      name: "Portfolio",
      grade: portfolio.grade,
      summary: `${portfolio.openPositions} open positions`,
      details: portfolio as unknown as Record<string, unknown>,
    },
    {
      name: "Execution",
      grade: paper.meetsMinimumSample && paper.expectedValue > 0 ? "PASS" : "FAIL",
      summary: `Paper ${paper.progressLabel} · opens ${paper.paperOpens}`,
      details: paper as unknown as Record<string, unknown>,
    },
    {
      name: "Discord",
      grade: "WARNING",
      summary: "Env-gated — verify DISCORD_ENABLED",
      details: {},
    },
  ];

  const passCount = sections.filter((s) => s.grade === "PASS").length;
  const overallScore = Math.round((passCount / sections.length) * 100);
  let overallGrade: ReadinessGrade = "WARNING";
  if (blockers.length === 0 && overallScore >= 85) overallGrade = "PASS";
  if (blockers.length > 0) overallGrade = "FAIL";

  const liveTradingAllowed =
    blockers.length === 0 &&
    shadow.analyticsTrustworthy &&
    paper.meetsMinimumSample &&
    paper.expectedValue > 0;

  return {
    overallScore,
    overallGrade,
    liveTradingAllowed,
    liveTradingReady: liveTradingAllowed,
    blockers,
    warnings,
    sections,
    shadowAnalyticsTrustworthy: shadow.analyticsTrustworthy,
    roiAnomalyCount,
    duplicateActiveGroups: duplicates.duplicateActiveGroups,
    paperProgressLabel: paper.progressLabel,
    zeroRoiBreakdown: shadow.zeroRoiBreakdown.byCategory,
    generatedAt: new Date().toISOString(),
  };
}
