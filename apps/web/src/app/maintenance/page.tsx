import Link from "next/link";
import {
  computeLiveTradingReadiness,
  getLastMaintenanceRun,
  getProductionHealthReport,
} from "@augurium/database";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  let readiness: Awaited<ReturnType<typeof computeLiveTradingReadiness>> | null = null;
  let lastRun: Awaited<ReturnType<typeof getLastMaintenanceRun>> = null;
  let health: Awaited<ReturnType<typeof getProductionHealthReport>> | null = null;

  try {
    [readiness, lastRun, health] = await Promise.all([
      computeLiveTradingReadiness(),
      getLastMaintenanceRun(),
      getProductionHealthReport(),
    ]);
  } catch {
    /* DB unavailable */
  }

  const repairable = readiness?.blockerDetails.filter((b) => b.repairable) ?? [];
  const unrepaired = readiness?.blockerDetails.filter((b) => !b.repairable) ?? [];

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Maintenance
          </p>
          <h1>Production maintenance</h1>
        </div>
        {readiness && (
          <span className={readiness.liveTradingReady ? styles.ok : styles.warn}>
            Ready: {readiness.liveTradingReady ? "YES" : "NO"} · {readiness.overallScore}/100
          </span>
        )}
      </header>

      <section className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.kicker}>Last maintenance run</span>
          <strong>{lastRun ? lastRun.source : "None"}</strong>
          <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            {lastRun
              ? `${lastRun.status} · ${lastRun.dryRun ? "dry-run" : "live"} · ${lastRun.startedAt.toISOString()}`
              : "No run recorded yet"}
          </p>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>Worker memory</span>
          <strong
            className={health?.workerMemoryHigh ? styles.warn : styles.ok}
          >
            {health?.workerMemoryHeapUsedMb != null
              ? `${health.workerMemoryHeapUsedMb} MB`
              : "—"}
          </strong>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>Ingestion failures (24h)</span>
          <strong>{health?.ingestionFailedRuns24h ?? "—"}</strong>
        </div>
      </section>

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Run maintenance (CLI)</h2>
      <p style={{ fontSize: "0.9rem", maxWidth: "48rem" }}>
        Maintenance is not exposed as a web button (unsafe on production). Run from Render
        one-off job or locally against the production database:
      </p>
      <pre
        style={{
          background: "var(--surface)",
          padding: "1rem",
          borderRadius: "6px",
          fontSize: "0.8rem",
          overflow: "auto",
        }}
      >
        {`npm run maintenance:production -- --dry-run\nnpm run maintenance:production`}
      </pre>
      <p style={{ fontSize: "0.85rem" }}>
        Report: <code>PRODUCTION_MAINTENANCE_REPORT.md</code> · Worker schedules{" "}
        <code>maintenance:daily</code> every 24h
      </p>

      {lastRun && lastRun.steps.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Latest run steps</h2>
          <ul>
            {lastRun.steps.map((s) => (
              <li key={s.name}>
                {s.name}: {s.status}
              </li>
            ))}
          </ul>
        </>
      )}

      {repairable.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Repairable blockers</h2>
          <ul style={{ fontSize: "0.9rem" }}>
            {repairable.map((b) => (
              <li key={b.id} style={{ marginBottom: "0.75rem" }}>
                <strong>{b.message}</strong>
                <br />
                {b.whyItMatters}
                {b.repairCommand && (
                  <>
                    <br />
                    <code>{b.repairCommand}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {unrepaired.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Operational blockers</h2>
          <ul style={{ fontSize: "0.9rem" }}>
            {unrepaired.map((b) => (
              <li key={b.id} style={{ marginBottom: "0.75rem" }}>
                <strong>{b.message}</strong>
                <br />
                {b.whyItMatters}
                {b.repairCommand && (
                  <>
                    <br />
                    <code>{b.repairCommand}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p style={{ marginTop: "2rem", fontSize: "0.8rem" }}>
        <Link href="/readiness">Readiness</Link> · <Link href="/health">Health</Link> ·{" "}
        <Link href="/shadow/payout-audit">Payout audit</Link>
      </p>
    </main>
  );
}
