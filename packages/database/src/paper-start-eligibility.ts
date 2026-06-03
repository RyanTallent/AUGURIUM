import { collectMaintenanceMetrics } from "./maintenance-metrics.js";
import { computeIngestionHealthSummary } from "./ingestion-health-summary.js";
import { computeShadowTrustReport } from "./shadow-trust-report.js";
import { isShadowSyncRunAcceptable, parseShadowSyncRunOutcome } from "./shadow-sync-health.js";
import { prisma } from "./client.js";

export interface PaperStartEligibility {
  eligible: boolean;
  executionEnabled: boolean;
  paperProvider: boolean;
  conditions: Array<{
    id: string;
    pass: boolean;
    detail: string;
  }>;
  recommendedAction: string;
  generatedAt: string;
}

function isPaperExecutionEnabledEnv(): boolean {
  const enabled =
    process.env.EXECUTION_ENABLED === "true" || process.env.EXECUTION_ENABLED === "1";
  const provider = (process.env.EXECUTION_PROVIDER ?? "paper").toLowerCase();
  return enabled && provider === "paper";
}

export async function computePaperStartEligibility(): Promise<PaperStartEligibility> {
  const executionEnabled =
    process.env.EXECUTION_ENABLED === "true" || process.env.EXECUTION_ENABLED === "1";
  const provider = (process.env.EXECUTION_PROVIDER ?? "paper").toLowerCase();
  const [metrics, ingestion, shadowTrust] = await Promise.all([
    collectMaintenanceMetrics(),
    computeIngestionHealthSummary(),
    computeShadowTrustReport(100),
  ]);

  const latestShadow = await prisma.ingestionRun.findFirst({
    where: {
      source: "shadow-portfolio",
      finishedAt: { not: null },
    },
    orderBy: { finishedAt: "desc" },
  });
  const shadowOutcome = parseShadowSyncRunOutcome(
    latestShadow
      ? {
          status: latestShadow.status,
          finishedAt: latestShadow.finishedAt,
          itemCount: latestShadow.itemCount,
          metadata: latestShadow.metadata,
        }
      : null,
  );
  const shadowSyncOk = isShadowSyncRunAcceptable(shadowOutcome);

  const analyticsClean =
    metrics.impossiblePnlCount === 0 &&
    metrics.duplicateActiveGroups === 0 &&
    shadowTrust.trustworthy;

  const conditions = [
    {
      id: "impossible_pnl_zero",
      pass: metrics.impossiblePnlCount === 0,
      detail: `impossible PnL=${metrics.impossiblePnlCount}`,
    },
    {
      id: "duplicate_groups_zero",
      pass: metrics.duplicateActiveGroups === 0,
      detail: `duplicate groups=${metrics.duplicateActiveGroups}`,
    },
    {
      id: "ingestion_healthy",
      pass: ingestion.healthy,
      detail: ingestion.notes.join("; ") || "ok",
    },
    {
      id: "shadow_sync_healthy",
      pass: shadowSyncOk,
      detail: shadowSyncOk ? "last shadow sync acceptable" : "shadow sync not acceptable",
    },
    {
      id: "shadow_analytics_clean",
      pass: analyticsClean,
      detail: `trustworthy=${shadowTrust.trustworthy} invalid=${metrics.invalidForAnalyticsCount} roiAnomalies=${metrics.roiAnomalyCount}`,
    },
    {
      id: "execution_env_paper",
      pass: isPaperExecutionEnabledEnv(),
      detail: executionEnabled
        ? `EXECUTION_ENABLED=true provider=${provider}`
        : "EXECUTION_ENABLED=false — paper orders will not run",
    },
  ];

  const dataGatesPass = conditions
    .filter((c) => c.id !== "execution_env_paper")
    .every((c) => c.pass);

  const eligible = dataGatesPass && isPaperExecutionEnabledEnv();

  let recommendedAction =
    "Set EXECUTION_ENABLED=true and EXECUTION_PROVIDER=paper on worker (keep LIVE_TRADING_ENABLED=false). Ensure portfolio produces ACCEPT for TRADE_NOW signals; worker execution:run will place paper orders.";
  if (!dataGatesPass) {
    recommendedAction = "Run npm run recovery:production before enabling paper execution.";
  } else if (!executionEnabled) {
    recommendedAction =
      "Data gates pass. Enable EXECUTION_ENABLED=true with EXECUTION_PROVIDER=paper on Render worker only — do not enable LIVE_TRADING_ENABLED or ALLOW_REAL_MONEY.";
  }

  return {
    eligible,
    executionEnabled,
    paperProvider: provider === "paper",
    conditions,
    recommendedAction,
    generatedAt: new Date().toISOString(),
  };
}
