import { computeLiveTradingReadiness } from "./readiness-report.js";
import { buildReadinessBlockerDetails, type ReadinessBlockerDetail } from "./readiness-blockers.js";
import { collectMaintenanceMetrics } from "./maintenance-metrics.js";
import { computeIngestionHealthSummary } from "./ingestion-health-summary.js";
import { computePortfolioRejectionSummary } from "./portfolio-rejection-summary.js";
import { getProductionHealthReport } from "./production-health.js";

export interface ReadinessForensicsItem extends ReadinessBlockerDetail {
  rootCause: string;
  blocksPaperTrading: boolean;
  blocksLiveTradingExplicit: boolean;
}

export interface ReadinessForensicsReport {
  readinessScore: number;
  liveTradingReady: boolean;
  items: ReadinessForensicsItem[];
  warnings: string[];
  metrics: Awaited<ReturnType<typeof collectMaintenanceMetrics>>;
  ingestion: Awaited<ReturnType<typeof computeIngestionHealthSummary>>;
  portfolio: Awaited<ReturnType<typeof computePortfolioRejectionSummary>>;
  shadowStalePct: number;
  categoryCoveragePct: number;
  scoringBacklog: number;
  generatedAt: string;
}

const ROOT_CAUSES: Record<string, { rootCause: string; blocksPaper: boolean }> = {
  impossible_pnl: {
    rootCause: "Historical shadow closes stored PnL inconsistent with entry/exit prices.",
    blocksPaper: true,
  },
  analytics_untrustworthy: {
    rootCause: "Too many invalid or outlier ROI rows for trustworthy headline analytics.",
    blocksPaper: true,
  },
  payout_audit: {
    rootCause: "Authoritative payout validation failed on closed shadows.",
    blocksPaper: true,
  },
  roi_anomalies: {
    rootCause: "Forensics flagged corrupt/outlier ROI beyond threshold.",
    blocksPaper: true,
  },
  invalid_analytics: {
    rootCause: "Unreconcilable or corrupt rows flagged invalid_for_analytics.",
    blocksPaper: true,
  },
  duplicate_shadows: {
    rootCause: "Multiple OPEN shadow trades for same market+side+signalType.",
    blocksPaper: true,
  },
  paper_validation: {
    rootCause: "Fewer than 100 closed paper positions — sample not statistically ready for live.",
    blocksPaper: false,
  },
  shadow_sync: {
    rootCause: "Last shadow price sync failed or did not process enough trades.",
    blocksPaper: true,
  },
  execution_recon: {
    rootCause: "Paper/provider position counts do not reconcile.",
    blocksPaper: true,
  },
};

export async function computeReadinessForensics(): Promise<ReadinessForensicsReport> {
  const [readiness, metrics, ingestion, portfolio, health] = await Promise.all([
    computeLiveTradingReadiness(),
    collectMaintenanceMetrics(),
    computeIngestionHealthSummary(),
    computePortfolioRejectionSummary(),
    getProductionHealthReport(),
  ]);

  const details = buildReadinessBlockerDetails(readiness.blockers);
  const items: ReadinessForensicsItem[] = details.map((d) => {
    const extra = ROOT_CAUSES[d.id] ?? {
      rootCause: "Operational or data quality gate.",
      blocksPaper: d.blocksLiveTrading,
    };
    return {
      ...d,
      rootCause: extra.rootCause,
      blocksPaperTrading: extra.blocksPaper,
      blocksLiveTradingExplicit: d.blocksLiveTrading,
    };
  });

  if (health.shadowStalePct > 50 && !readiness.blockers.some((b) => b.includes("Shadow sync"))) {
    items.push({
      id: "stale_shadow_warning",
      message: `Stale shadow pricing ${health.shadowStalePct.toFixed(0)}%`,
      whyItMatters: "Marks may be stale; portfolio and paper marks can be wrong.",
      repairCommand: "npm run shadow:sync",
      repairable: true,
      blocksLiveTrading: false,
      rootCause: "Post-entry tape missing or SHADOW_PRICE_STALE_MS exceeded.",
      blocksPaperTrading: true,
      blocksLiveTradingExplicit: false,
    });
  }

  if (!health.scoringHealthy) {
    items.push({
      id: "scoring_backlog",
      message: `Scoring backlog: ${health.unscoredEligibleRemaining}`,
      whyItMatters: "Signals depend on fresh trader scores.",
      repairCommand: "npm run score:traders",
      repairable: true,
      blocksLiveTrading: false,
      rootCause: "Eligible wallets without recent score.",
      blocksPaperTrading: false,
      blocksLiveTradingExplicit: false,
    });
  }

  return {
    readinessScore: readiness.overallScore,
    liveTradingReady: readiness.liveTradingReady,
    items,
    warnings: readiness.warnings,
    metrics,
    ingestion,
    portfolio,
    shadowStalePct: health.shadowStalePct,
    categoryCoveragePct: metrics.categoryCoveragePct,
    scoringBacklog: health.unscoredEligibleRemaining,
    generatedAt: new Date().toISOString(),
  };
}
