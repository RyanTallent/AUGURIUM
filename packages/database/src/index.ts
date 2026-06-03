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
