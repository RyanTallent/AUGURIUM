export { prisma } from "./client.js";
export * from "@prisma/client";
export {
  getProductionHealthReport,
  type ProductionHealthReport,
  type ShadowSyncRunStats,
} from "./production-health.js";
export {
  computeScoringHealth,
  scoringWarningMessage,
  type ScoringHealthMetrics,
} from "./scoring-health.js";
export {
  isShadowSyncRunAcceptable,
  parseShadowSyncRunOutcome,
  type ShadowSyncRunOutcome,
} from "./shadow-sync-health.js";
export {
  computeShadowAnalytics,
  type ShadowAnalyticsReport,
} from "./shadow-analytics.js";
export {
  computeShadowRoiForensics,
  listShadowForensicRows,
  type ShadowRoiForensicsReport,
  type ShadowTradeForensicRow,
} from "./shadow-roi-forensics.js";
export {
  computeZeroRoiBreakdown,
  type ZeroRoiBreakdown,
  type ZeroRoiCategory,
} from "./shadow-zero-roi.js";
export {
  auditShadowFreshness,
  type ShadowFreshnessAudit,
} from "./shadow-freshness-audit.js";
export {
  computeShadowPayoutAudit,
  countImpossiblePnl,
  type ShadowPayoutAuditReport,
  type PayoutAuditRow,
} from "./shadow-payout-audit.js";
export {
  auditShadowDuplicates,
  type ShadowDuplicateReport,
} from "./shadow-duplicates.js";
export {
  computeSignalValidation,
  type SignalValidationReport,
} from "./signal-validation.js";
export {
  computeTraderReliability,
  type TraderReliabilityReport,
} from "./trader-reliability.js";
export {
  computePortfolioValidation,
  type PortfolioValidationReport,
  type ReadinessGrade,
} from "./portfolio-validation.js";
export {
  computePaperValidation,
  type PaperValidationReport,
} from "./paper-validation.js";
export {
  computeLiveTradingReadiness,
  type LiveTradingReadinessReport,
} from "./readiness-report.js";
export {
  buildReadinessBlockerDetails,
  enrichReadinessReport,
  type ReadinessBlockerDetail,
} from "./readiness-blockers.js";
export {
  collectMaintenanceMetrics,
  type MaintenanceMetricsSnapshot,
} from "./maintenance-metrics.js";
export {
  getLastMaintenanceRun,
  getLastWorkerMemoryFromRuns,
  MAINTENANCE_SOURCE_DAILY,
  MAINTENANCE_SOURCE_PRODUCTION,
  type MaintenanceRunSummary,
} from "./maintenance-status.js";
export {
  runProductionMaintenance,
  runDailyMaintenance,
  type ProductionMaintenanceResult,
} from "./production-maintenance.js";
export {
  cleanupDuplicateShadows,
  reconcileShadowPayouts,
} from "./maintenance-repairs.js";
export {
  computeIngestionHealthSummary,
  type IngestionHealthSummary,
} from "./ingestion-health-summary.js";
export {
  computeShadowTrustReport,
  type ShadowTrustReport,
} from "./shadow-trust-report.js";
export {
  computePortfolioRejectionSummary,
  type PortfolioRejectionSummary,
} from "./portfolio-rejection-summary.js";
export {
  computeReadinessForensics,
  type ReadinessForensicsReport,
  type ReadinessForensicsItem,
} from "./readiness-forensics.js";
export {
  computePaperStartEligibility,
  type PaperStartEligibility,
} from "./paper-start-eligibility.js";
export {
  runProductionRecovery,
  type ProductionRecoveryResult,
} from "./production-recovery.js";
