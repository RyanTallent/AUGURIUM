import Link from "next/link";
import { getDashboardMetricsSnapshot, type DashboardSnapshotPayload } from "@augurium/database";
import { SnapshotNotice } from "../../components/SnapshotNotice";
import { webMemorySnapshot } from "../../lib/web-db-guard";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function ProductionHealthPage() {
  const snap = await getDashboardMetricsSnapshot<DashboardSnapshotPayload>();
  const health = snap?.data?.productionHealth ?? null;
  const mem = webMemorySnapshot();

  if (!health) {
    return (
      <main className={styles.main}>
        <p className={styles.warn}>
          Production health snapshot not available. Worker must run{" "}
          <code>web:snapshot-refresh</code>. Lightweight probe:{" "}
          <a href="/api/health">/api/health</a>
        </p>
        <p className={styles.hint}>
          Web heap {mem.heapUsedMb} MB · in-flight DB queries {mem.inFlightQueries}
        </p>
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
            From worker snapshot · <a href="/api/health">/api/health</a> (ping only)
          </p>
        </div>
        <span
          className={
            health.scoringHealthy && health.shadowSyncRunAcceptable ? styles.ok : styles.warn
          }
        >
          {health.scoringHealthy ? "Healthy" : "Needs attention"}
        </span>
      </header>

      <SnapshotNotice
        meta={{
          source: snap?.meta.stale ? "live" : "snapshot",
          stale: snap?.meta.stale,
          snapshot: snap?.meta,
        }}
      />

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Scored wallets</h2>
          <p className={styles.metric}>{health.scoredWallets}</p>
        </article>
        <article className={styles.card}>
          <h2>Shadow FRESH</h2>
          <p className={styles.metric}>{health.shadowFreshPct}%</p>
        </article>
        <article className={styles.card}>
          <h2>Ingestion failures (24h)</h2>
          <p className={styles.metric}>{health.ingestionFailedRuns24h}</p>
        </article>
        <article className={styles.card}>
          <h2>Web heap (this request)</h2>
          <p className={styles.metric}>{mem.heapUsedMb} MB</p>
        </article>
      </section>

      <p className={styles.hint} style={{ marginTop: "1.5rem" }}>
        Snapshot captured {new Date(health.generatedAt).toLocaleString()}
      </p>
    </main>
  );
}
