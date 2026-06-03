import type { LiveTradingReadinessReport } from "./readiness-report.js";

export interface ReadinessBlockerDetail {
  id: string;
  message: string;
  whyItMatters: string;
  repairCommand: string | null;
  repairable: boolean;
  blocksLiveTrading: boolean;
}

const BLOCKER_CATALOG: Record<
  string,
  Omit<ReadinessBlockerDetail, "id" | "message"> & { match: RegExp }
> = {
  impossible_pnl: {
    match: /impossible PnL/i,
    whyItMatters:
      "Flat entry/exit with nonzero realized PnL breaks shadow analytics and readiness payout gates.",
    repairCommand: "npm run reconcile:shadow-payouts",
    repairable: true,
    blocksLiveTrading: true,
  },
  analytics_untrustworthy: {
    match: /not trustworthy/i,
    whyItMatters:
      "Headline ROI and win rate are excluded from invalid or corrupt rows until the portfolio is clean.",
    repairCommand: "npm run maintenance:production",
    repairable: true,
    blocksLiveTrading: true,
  },
  payout_audit: {
    match: /payout audit FAIL/i,
    whyItMatters: "Closed shadow trades fail authoritative payout validation.",
    repairCommand: "npm run reconcile:shadow-payouts",
    repairable: true,
    blocksLiveTrading: true,
  },
  roi_anomalies: {
    match: /ROI anomalies/i,
    whyItMatters: "Outlier ROI rows distort forensics and readiness.",
    repairCommand: "npm run reconcile:shadow-payouts",
    repairable: true,
    blocksLiveTrading: true,
  },
  invalid_analytics: {
    match: /Invalid for analytics/i,
    whyItMatters:
      "Corrupt or unreconcilable trades are flagged invalid_for_analytics and block trustworthy sample size.",
    repairCommand: "npm run reconcile:shadow-payouts",
    repairable: true,
    blocksLiveTrading: true,
  },
  duplicate_shadows: {
    match: /duplicate active shadow/i,
    whyItMatters: "Multiple OPEN shadows per market+side double-count risk and PnL.",
    repairCommand: "npm run cleanup:duplicate-shadows",
    repairable: true,
    blocksLiveTrading: true,
  },
  paper_validation: {
    match: /Paper validation/i,
    whyItMatters:
      "Live trading requires at least 100 paper closes with positive expected value.",
    repairCommand:
      "Keep EXECUTION_ENABLED=true (paper mode); run portfolio + execution until 100 closes",
    repairable: false,
    blocksLiveTrading: true,
  },
  shadow_sync: {
    match: /Shadow sync run not acceptable/i,
    whyItMatters: "Shadow prices must sync reliably before trusting portfolio metrics.",
    repairCommand: "npm run shadow:sync",
    repairable: true,
    blocksLiveTrading: true,
  },
  execution_recon: {
    match: /Execution reconciliation/i,
    whyItMatters: "Paper/live execution state must reconcile with portfolio records.",
    repairCommand: "npm run execution:run",
    repairable: true,
    blocksLiveTrading: true,
  },
};

export function buildReadinessBlockerDetails(
  blockers: string[],
): ReadinessBlockerDetail[] {
  return blockers.map((message, i) => {
    for (const [id, spec] of Object.entries(BLOCKER_CATALOG)) {
      if (spec.match.test(message)) {
        return {
          id,
          message,
          whyItMatters: spec.whyItMatters,
          repairCommand: spec.repairCommand,
          repairable: spec.repairable,
          blocksLiveTrading: spec.blocksLiveTrading,
        };
      }
    }
    return {
      id: `blocker_${i}`,
      message,
      whyItMatters: "This gate must clear before live trading.",
      repairCommand: "npm run maintenance:production",
      repairable: true,
      blocksLiveTrading: true,
    };
  });
}

export function enrichReadinessReport<T extends LiveTradingReadinessReport>(
  report: T,
): T & { blockerDetails: ReadinessBlockerDetail[] } {
  return {
    ...report,
    blockerDetails: buildReadinessBlockerDetails(report.blockers),
  };
}
