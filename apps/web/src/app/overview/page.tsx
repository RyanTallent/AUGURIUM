import Link from "next/link";
import { prisma } from "@augurium/database";
import { getProductionWarnings } from "../../lib/ops-status";
import { getScoringHealthMetrics } from "../../lib/scoring-health";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let stats = {
    tradeNow: 0,
    watchlist: 0,
    research: 0,
    ignore: 0,
    avgAlpha: 0,
    avgConfidence: 0,
    scoredWallets: 0,
    eligibleWallets: 0,
    scoreCoverageEligiblePct: 0,
    unscoredEligibleRemaining: 0,
    scoringHealthy: false,
    categorizedPct: 0,
    shadowFreshPct: 0,
    activeSignals: 0,
    dbOk: true,
  };

  try {
    const [
      tradeNow,
      watchlist,
      research,
      ignore,
      activeSignals,
      scoring,
      marketTotal,
      categorized,
      shadowTotal,
      shadowFresh,
      aggregates,
    ] = await Promise.all([
        prisma.signal.count({ where: { status: "active", signalType: "TRADE_NOW" } }),
        prisma.signal.count({ where: { status: "active", signalType: "WATCHLIST" } }),
        prisma.signal.count({ where: { status: "active", signalType: "RESEARCH" } }),
        prisma.signal.count({ where: { status: "active", signalType: "IGNORE" } }),
        prisma.signal.count({ where: { status: "active" } }),
        getScoringHealthMetrics(),
        prisma.market.count(),
        prisma.market.count({
          where: {
            AND: [
              { category: { not: null } },
              { category: { notIn: ["", "Other", "uncategorized"] } },
            ],
          },
        }),
        prisma.shadowTrade.count(),
        prisma.shadowTrade.count({ where: { priceStatus: "FRESH" } }),
        prisma.signal.aggregate({
          where: { status: "active" },
          _avg: { alphaScore: true, systemConfidenceScore: true },
        }),
      ]);

    stats = {
      tradeNow,
      watchlist,
      research,
      ignore,
      avgAlpha: aggregates._avg.alphaScore ?? 0,
      avgConfidence: aggregates._avg.systemConfidenceScore ?? 0,
      scoredWallets: scoring.scoredWallets,
      eligibleWallets: scoring.eligibleWallets,
      scoreCoverageEligiblePct: scoring.scoreCoverageEligiblePct,
      unscoredEligibleRemaining: scoring.unscoredEligibleRemaining,
      scoringHealthy: scoring.scoringHealthy,
      categorizedPct: marketTotal > 0 ? (categorized / marketTotal) * 100 : 0,
      shadowFreshPct: shadowTotal > 0 ? (shadowFresh / shadowTotal) * 100 : 0,
      activeSignals,
      dbOk: true,
    };
  } catch {
    stats.dbOk = false;
  }

  const warnings = stats.dbOk ? await getProductionWarnings() : { messages: [] };

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Overview
          </p>
          <h1>Intelligence overview</h1>
          <p className={styles.hint}>Advisory signals — live execution disabled</p>
        </div>
        <span className={stats.dbOk && stats.scoringHealthy ? styles.ok : styles.warn}>
          {stats.dbOk
            ? stats.scoringHealthy
              ? "Scoring healthy"
              : `${stats.unscoredEligibleRemaining} eligible unscored`
            : "DB offline"}
        </span>
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Avg alpha score</h2>
          <p className={styles.metric}>{stats.avgAlpha.toFixed(1)}</p>
        </article>
        <article className={styles.card}>
          <h2>System confidence</h2>
          <p className={styles.metric}>{stats.avgConfidence.toFixed(1)}</p>
        </article>
        <article className={styles.card}>
          <h2>Trade Now</h2>
          <p className={styles.metric}>{stats.tradeNow}</p>
        </article>
        <article className={styles.card}>
          <h2>Watchlist</h2>
          <p className={styles.metric}>{stats.watchlist}</p>
        </article>
        <article className={styles.card}>
          <h2>Research</h2>
          <p className={styles.metric}>{stats.research}</p>
        </article>
        <article className={styles.card}>
          <h2>Scored wallets</h2>
          <p className={styles.metric}>{stats.scoredWallets}</p>
        </article>
        <article className={styles.card}>
          <h2>Eligible wallets</h2>
          <p className={styles.metric}>{stats.eligibleWallets}</p>
        </article>
      </section>

      <section className={styles.grid} style={{ marginTop: "1.5rem" }}>
        <article className={styles.card}>
          <h2>Category coverage</h2>
          <p className={styles.metric}>{stats.categorizedPct.toFixed(0)}%</p>
        </article>
        <article className={styles.card}>
          <h2>Eligible score coverage</h2>
          <p className={styles.metric}>{stats.scoreCoverageEligiblePct.toFixed(0)}%</p>
          <p className={styles.hint}>
            {stats.unscoredEligibleRemaining} unscored eligible remaining
          </p>
        </article>
        <article className={styles.card}>
          <h2>Shadow FRESH prices</h2>
          <p className={styles.metric}>{stats.shadowFreshPct.toFixed(0)}%</p>
        </article>
      </section>

      {warnings.messages.length > 0 && (
        <section className={styles.modules}>
          <h2>System notes</h2>
          <ul>
            {warnings.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.modules}>
        <h2>Confidence breakdown</h2>
        <p className={styles.hint}>
          System confidence blends ingestion freshness, scored-trader depth, categorized markets,
          price-tape coverage, and shadow mark-to-market health. It stays low when evidence is thin.
        </p>
        <ul>
          <li>Avg signal system confidence: {stats.avgConfidence.toFixed(1)} / 100</li>
          <li>
            Scored wallets: {stats.scoredWallets} / {stats.eligibleWallets} eligible (
            {stats.scoreCoverageEligiblePct.toFixed(0)}% coverage)
          </li>
          <li>Categorized markets: {stats.categorizedPct.toFixed(0)}%</li>
          <li>Shadow trades with FRESH prices: {stats.shadowFreshPct.toFixed(0)}%</li>
        </ul>
      </section>

      <section className={styles.modules}>
        <h2>Quick links</h2>
        <ul>
          <li>
            <Link href="/signals">All signals</Link> ({stats.activeSignals} active)
          </li>
          <li>
            <Link href="/markets">Markets</Link>
          </li>
          <li>
            <Link href="/traders">Traders</Link>
          </li>
          <li>
            <Link href="/health">Production health</Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
