import { APP_NAME } from "@augurium/shared";
import { prisma } from "@augurium/database";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

async function getStats() {
  try {
    const [markets, traders, tradeRows, positions, signals, tradeNow, lastRun] =
      await Promise.all([
        prisma.market.count(),
        prisma.trader.count(),
        prisma.trade.count(),
        prisma.position.count({ where: { status: "open" } }),
        prisma.signal.count({ where: { status: "active" } }),
        prisma.signal.count({ where: { status: "active", signalType: "TRADE_NOW" } }),
        prisma.ingestionRun.findFirst({ orderBy: { startedAt: "desc" } }),
      ]);
    return {
      markets,
      traders,
      tradeRows,
      positions,
      signals,
      tradeNow,
      lastRun,
      dbOk: true,
    };
  } catch {
    return {
      markets: 0,
      traders: 0,
      tradeRows: 0,
      positions: 0,
      signals: 0,
      tradeNow: 0,
      lastRun: null,
      dbOk: false,
    };
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
          <h2>Wallets</h2>
          <p className={styles.metric}>{stats.traders}</p>
          <p className={styles.hint}>Discovered via trades & holders</p>
        </article>
        <article className={styles.card}>
          <h2>Trades ingested</h2>
          <p className={styles.metric}>{stats.tradeRows}</p>
          <p className={styles.hint}>Deduped on-chain fills</p>
        </article>
        <article className={styles.card}>
          <h2>Open positions</h2>
          <p className={styles.metric}>{stats.positions}</p>
          <p className={styles.hint}>API sync + trade reconstruction</p>
        </article>
        <article className={styles.card}>
          <h2>Active signals</h2>
          <p className={styles.metric}>{stats.signals}</p>
          <p className={styles.hint}>
            Trade Now: {stats.tradeNow} · <a href="/signals">view all</a>
          </p>
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
        <h2>Build phases</h2>
        <ul>
          <li>Phase A — ingestion (complete): markets, trades, wallets, positions</li>
          <li>
            Phase B — trader scoring & copyability (complete){" "}
            <a href="/traders">traders</a>
          </li>
          <li>
            Phase C — consensus & signals (complete){" "}
            <a href="/overview">overview</a> · <a href="/signals">signals</a>
          </li>
          <li>Phase D–G — shadow, simulation, portfolio, execution (pending)</li>
        </ul>
      </section>
    </main>
  );
}
