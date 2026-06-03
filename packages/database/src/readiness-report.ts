import { getProductionHealthReport } from "./production-health.js";
import { computeShadowAnalytics } from "./shadow-analytics.js";
import { auditShadowDuplicates } from "./shadow-duplicates.js";
import { computeSignalValidation } from "./signal-validation.js";
import { computeTraderReliability } from "./trader-reliability.js";
import { computePortfolioValidation } from "./portfolio-validation.js";
import { computePaperValidation } from "./paper-validation.js";
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
  blockers: string[];
  sections: ReadinessSection[];
  generatedAt: string;
}

function gradeFromBool(pass: boolean, warn = false): ReadinessGrade {
  if (pass) return "PASS";
  if (warn) return "WARNING";
  return "FAIL";
}

export async function computeLiveTradingReadiness(): Promise<LiveTradingReadinessReport> {
  const [
    health,
    shadow,
    duplicates,
    signals,
    traders,
    portfolio,
    paper,
  ] = await Promise.all([
    getProductionHealthReport(),
    computeShadowAnalytics(),
    auditShadowDuplicates(),
    computeSignalValidation(),
    computeTraderReliability(100),
    computePortfolioValidation(),
    computePaperValidation(),
  ]);

  const blockers: string[] = [];

  const shadowTrustworthy =
    shadow.sampleSize >= 50 &&
    shadow.zeroRoiClosedPct < 0.6 &&
    shadow.zeroMfePct < 0.7;
  if (!shadowTrustworthy) {
    blockers.push("Shadow analytics not trustworthy (high zero ROI/MFE)");
  }
  if (duplicates.duplicateActiveGroups > 0) {
    blockers.push(`${duplicates.duplicateActiveGroups} duplicate active shadow groups`);
  }
  if (!health.shadowSyncRunAcceptable) {
    blockers.push("Shadow sync run not acceptable");
  }
  if (health.shadowStalePct > 0.5) {
    blockers.push(`Shadow pricing stale (${(health.shadowStalePct * 100).toFixed(0)}%)`);
  }
  if (!paper.meetsMinimumSample) {
    blockers.push(`Paper trades ${paper.completedTrades}/100 minimum`);
  }
  if (paper.expectedValue <= 0 && paper.completedTrades >= 20) {
    blockers.push("Paper expected value not positive");
  }

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
        scoreCoverageEligiblePct: health.scoreCoverageEligiblePct,
      },
    },
    {
      name: "Signals",
      grade: gradeFromBool(
        Object.keys(signals.tradeNowRejectedReasons).length > 0 ||
          signals.tradeNowNearMisses === 0,
        true,
      ),
      summary: `TRADE_NOW near-misses (7d): ${signals.tradeNowNearMisses}`,
      details: signals as unknown as Record<string, unknown>,
    },
    {
      name: "Shadow",
      grade: shadowTrustworthy && duplicates.duplicateActiveGroups === 0 ? "PASS" : "FAIL",
      summary: `${shadow.sampleSize} closed/expired · ${(shadow.zeroRoiClosedPct * 100).toFixed(0)}% zero ROI`,
      details: { shadow, duplicates },
    },
    {
      name: "Portfolio",
      grade: portfolio.grade,
      summary: `${portfolio.openPositions} open · accept ${(portfolio.allocationAcceptRate * 100).toFixed(0)}%`,
      details: portfolio as unknown as Record<string, unknown>,
    },
    {
      name: "Execution",
      grade: paper.grade,
      summary: `${paper.completedTrades} paper closes · EV ${(paper.expectedValue * 100).toFixed(2)}%`,
      details: paper as unknown as Record<string, unknown>,
    },
    {
      name: "Discord",
      grade: "WARNING",
      summary: "Configured via env — verify DISCORD_ENABLED in production",
      details: {},
    },
  ];

  const passCount = sections.filter((s) => s.grade === "PASS").length;
  const overallScore = Math.round((passCount / sections.length) * 100);
  let overallGrade: ReadinessGrade = "WARNING";
  if (blockers.length === 0 && overallScore >= 85) overallGrade = "PASS";
  if (blockers.length > 2 || !shadowTrustworthy) overallGrade = "FAIL";

  const liveTradingAllowed =
    blockers.length === 0 &&
    shadowTrustworthy &&
    paper.meetsMinimumSample &&
    paper.expectedValue > 0;

  return {
    overallScore,
    overallGrade,
    liveTradingAllowed,
    blockers,
    sections,
    generatedAt: new Date().toISOString(),
  };
}
