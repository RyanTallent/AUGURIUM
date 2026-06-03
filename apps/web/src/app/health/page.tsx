import Link from "next/link";
import { getProductionHealthReport } from "@augurium/database";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function ProductionHealthPage() {
  let health: Awaited<ReturnType<typeof getProductionHealthReport>> | null = null;
  try {
    health = await getProductionHealthReport();
  } catch {
    health = null;
  }

  if (!health) {
    return (
      <main className={styles.main}>
        <p className={styles.warn}>Database unreachable — cannot load production health.</p>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Production health
          </p>
          <h1>Production health</h1>
          <p className={styles.hint}>
            JSON API: <a href="/api/health/production">/api/health/production</a>
          </p>
        </div>
        <span className={health.scoringHealthy ? styles.ok : styles.warn}>
          Scoring {health.scoringHealthy ? "healthy" : "backlog"}
        </span>
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Scored wallets</h2>
          <p className={styles.metric}>{health.scoredWallets}</p>
        </article>
        <article className={styles.card}>
          <h2>Eligible wallets</h2>
          <p className={styles.metric}>{health.eligibleWallets}</p>
          <p className={styles.hint}>≥5 trades with volume (scorable)</p>
        </article>
        <article className={styles.card}>
          <h2>Eligible score coverage</h2>
          <p className={styles.metric}>{health.scoreCoverageEligiblePct}%</p>
        </article>
        <article className={styles.card}>
          <h2>Unscored eligible remaining</h2>
          <p className={styles.metric}>{health.unscoredEligibleRemaining}</p>
        </article>
      </section>

      <section className={styles.grid} style={{ marginTop: "1.5rem" }}>
        <article className={styles.card}>
          <h2>Discovered wallets</h2>
          <p className={styles.metric}>{health.walletsTotal}</p>
          <p className={styles.hint}>Not used for scoring coverage %</p>
        </article>
        <article className={styles.card}>
          <h2>Shadow trades</h2>
          <p className={styles.metric}>{health.shadowTotal}</p>
        </article>
        <article className={styles.card}>
          <h2>Shadow FRESH</h2>
          <p className={styles.metric}>{health.shadowFreshPct}%</p>
        </article>
        <article className={styles.card}>
          <h2>Last shadow sync processed</h2>
          <p className={styles.metric}>{health.latestShadowSyncProcessed ?? "—"}</p>
        </article>
      </section>

      <section className={styles.grid} style={{ marginTop: "1.5rem" }}>
        <article className={styles.card}>
          <h2>Shadow sync running</h2>
          <p className={styles.metricSmall}>
            {health.latestShadowSyncRunning
              ? `${health.latestShadowSyncRunning.status} since ${new Date(health.latestShadowSyncRunning.startedAt).toLocaleString()}`
              : "none"}
          </p>
        </article>
        <article className={styles.card}>
          <h2>Last completed shadow sync</h2>
          <p className={styles.metricSmall}>
            {health.latestShadowSyncCompleted
              ? `${health.latestShadowSyncCompleted.status} · processed ${health.latestShadowSyncCompleted.itemCount ?? "—"}`
              : "—"}
          </p>
        </article>
        <article className={styles.card}>
          <h2>Orphaned running (&gt;10m)</h2>
          <p className={styles.metric}>{health.shadowSyncOrphanedRunningCount}</p>
        </article>
      </section>

      <section className={styles.modules} style={{ marginTop: "2rem" }}>
        <h2>Latest worker runs</h2>
        <ul>
          <li>
            score-traders: {health.latestScoreTradersRun?.status ?? "—"} · items{" "}
            {health.latestScoreTradersRun?.itemCount ?? "—"}
          </li>
          <li>
            shadow-portfolio (latest): {health.latestShadowSyncRun?.status ?? "—"} · selected{" "}
            {health.latestShadowSyncSelected ?? "—"} · processed{" "}
            {health.latestShadowSyncProcessed ?? "—"} · updated{" "}
            {health.latestShadowSyncUpdated ?? "—"}
          </li>
        </ul>
        <p className={styles.hint}>Generated {new Date(health.generatedAt).toLocaleString()}</p>
      </section>
    </main>
  );
}
