import Link from "next/link";
import { prisma } from "@augurium/database";
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
    scoredTraders: 0,
    activeSignals: 0,
    dbOk: true,
  };

  try {
    const [tradeNow, watchlist, research, ignore, activeSignals, scoredTraders, aggregates] =
      await Promise.all([
        prisma.signal.count({ where: { status: "active", signalType: "TRADE_NOW" } }),
        prisma.signal.count({ where: { status: "active", signalType: "WATCHLIST" } }),
        prisma.signal.count({ where: { status: "active", signalType: "RESEARCH" } }),
        prisma.signal.count({ where: { status: "active", signalType: "IGNORE" } }),
        prisma.signal.count({ where: { status: "active" } }),
        prisma.trader.count({
          where: { metricsSnapshots: { some: { skipReason: null } } },
        }),
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
      scoredTraders,
      activeSignals,
      dbOk: true,
    };
  } catch {
    stats.dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Overview
          </p>
          <h1>Intelligence overview</h1>
          <p className={styles.hint}>Phase C — advisory signals only (no execution)</p>
        </div>
        <span className={stats.dbOk ? styles.ok : styles.warn}>
          {stats.dbOk ? "DB connected" : "DB offline"}
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
          <h2>Scored traders</h2>
          <p className={styles.metric}>{stats.scoredTraders}</p>
        </article>
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
        </ul>
      </section>
    </main>
  );
}
