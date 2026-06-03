import { APP_NAME } from "@augurium/shared";
import { prisma } from "@augurium/database";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

async function getStats() {
  try {
    const [markets, traders, signals, lastRun] = await Promise.all([
      prisma.market.count(),
      prisma.trader.count(),
      prisma.signal.count({ where: { status: "active" } }),
      prisma.ingestionRun.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);
    return { markets, traders, signals, lastRun, dbOk: true };
  } catch {
    return { markets: 0, traders: 0, signals: 0, lastRun: null, dbOk: false };
  }
}

export default async function HomePage() {
  const stats = await getStats();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Prediction Market Intelligence</p>
          <h1>{APP_NAME}</h1>
        </div>
        <span className={stats.dbOk ? styles.ok : styles.warn}>
          {stats.dbOk ? "DB connected" : "DB offline — run docker:up"}
        </span>
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Markets</h2>
          <p className={styles.metric}>{stats.markets}</p>
          <p className={styles.hint}>Tracked from Polymarket</p>
        </article>
        <article className={styles.card}>
          <h2>Traders</h2>
          <p className={styles.metric}>{stats.traders}</p>
          <p className={styles.hint}>Scored & clustered</p>
        </article>
        <article className={styles.card}>
          <h2>Active signals</h2>
          <p className={styles.metric}>{stats.signals}</p>
          <p className={styles.hint}>Risk-adjusted alpha</p>
        </article>
        <article className={styles.card}>
          <h2>Last ingestion</h2>
          <p className={styles.metricSmall}>
            {stats.lastRun
              ? new Date(stats.lastRun.startedAt).toLocaleString()
              : "—"}
          </p>
          <p className={styles.hint}>
            {stats.lastRun?.status ?? "Worker not run yet"}
          </p>
        </article>
      </section>

      <section className={styles.modules}>
        <h2>Platform modules</h2>
        <ul>
          <li>Market data ingestion pipeline</li>
          <li>Intelligence / scoring engine</li>
          <li>Signal generation</li>
          <li>Portfolio management</li>
          <li>Simulation & replay engines</li>
          <li>Discord notifications</li>
        </ul>
      </section>
    </main>
  );
}
