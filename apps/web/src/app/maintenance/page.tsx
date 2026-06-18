import Link from "next/link";
import { getLastMaintenanceRun } from "@augurium/database";
import { SnapshotNotice } from "../../components/SnapshotNotice";
import { WatchlistSeedForm } from "../../components/WatchlistSeedForm";
import {
  loadMaintenanceDiagnostics,
  loadMaintenancePageData,
  type PageLoadMeta,
} from "../../lib/page-snapshots";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  let readiness = null;
  let health = null;
  let readinessMeta: PageLoadMeta = { source: "unavailable" };
  let lastRun: Awaited<ReturnType<typeof getLastMaintenanceRun>> = null;
  let diag = null;
  let snapshotAges = null;
  let webMemory: Awaited<
    ReturnType<typeof loadMaintenanceDiagnostics>
  >["webMemory"] | null = null;

  try {
    const [page, diagnostics, run] = await Promise.all([
      loadMaintenancePageData(),
      loadMaintenanceDiagnostics(),
      getLastMaintenanceRun(),
    ]);
    readiness = page.readiness;
    health = page.health;
    readinessMeta = page.readinessMeta;
    lastRun = run;
    diag = diagnostics.diagnostics;
    snapshotAges = diagnostics.snapshotAges;
    webMemory = diagnostics.webMemory;
  } catch {
    /* DB unavailable */
  }

  const repairable = readiness?.blockerDetails.filter((b) => b.repairable) ?? [];
  const unrepaired = readiness?.blockerDetails.filter((b) => !b.repairable) ?? [];
  const needsRecovery =
    (readiness?.impossiblePnlCount ?? 0) > 0 ||
    (readiness?.duplicateActiveGroups ?? 0) > 0;

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

      <SnapshotNotice meta={readinessMeta} />

      {needsRecovery && (
        <p className={styles.warn} style={{ marginTop: "1rem", maxWidth: "48rem" }}>
          Production database needs a repair pass. Metrics below are live from this DB — run{" "}
          <code>npm run recovery:production</code> on Render (one-off job) or via Admin API after
          deploy. Local maintenance does not fix production until it uses production{" "}
          <code>DATABASE_URL</code>.
        </p>
      )}

      <section className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.kicker}>Impossible PnL</span>
          <strong
            className={
              readiness?.impossiblePnlCount === 0 ? styles.ok : styles.warn
            }
          >
            {readiness?.impossiblePnlCount ?? "—"}
          </strong>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>ROI anomalies (valid rows)</span>
          <strong>{readiness?.roiAnomalyCount ?? "—"}</strong>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>Invalid rows</span>
          <strong>{readiness?.invalidForAnalyticsCount ?? "—"}</strong>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>Duplicate groups</span>
          <strong
            className={
              readiness?.duplicateActiveGroups === 0 ? styles.ok : styles.warn
            }
          >
            {readiness?.duplicateActiveGroups ?? "—"}
          </strong>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>Last maintenance run</span>
          <strong>{lastRun ? lastRun.source : "None"}</strong>
          <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            {lastRun
              ? `${lastRun.status} · ${lastRun.dryRun ? "dry-run" : "live"} · ${lastRun.startedAt.toISOString()}`
              : "No run recorded yet — run recovery on this database"}
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
          <p style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
            Historical failed runs only
          </p>
        </div>
        <div className={styles.card}>
          <span className={styles.kicker}>Paper progress</span>
          <strong>{readiness?.paperProgressLabel ?? "—"}</strong>
        </div>
      </section>

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Render one-off (recommended)</h2>
      <p style={{ fontSize: "0.9rem", maxWidth: "48rem" }}>
        In Render → <strong>augurium-worker</strong> → Shell / One-off job, with production env:
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
        {`npm run recovery:production`}
      </pre>
      <p style={{ fontSize: "0.85rem" }}>
        This runs: fix flat-entry impossible PnL → orphan cleanup → duplicate cleanup → payout
        reconcile → verify scripts. Writes <code>PRODUCTION_RECOVERY_REPORT.md</code> in the job log
        (or use Admin API on web after setting <code>MAINTENANCE_ADMIN_TOKEN</code>).
      </p>

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Local / CI (same database)</h2>
      <pre
        style={{
          background: "var(--surface)",
          padding: "1rem",
          borderRadius: "6px",
          fontSize: "0.8rem",
          overflow: "auto",
        }}
      >
        {`# Preview\nnpm run recovery:production -- --dry-run\n\n# Repair\nnpm run recovery:production\nnpm run maintenance:production`}
      </pre>

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Admin API (token required)</h2>
      <p style={{ fontSize: "0.9rem" }}>
        Token on this host:{" "}
        <strong
          className={
            process.env.MAINTENANCE_ADMIN_TOKEN?.trim() ? styles.ok : styles.warn
          }
        >
          {process.env.MAINTENANCE_ADMIN_TOKEN?.trim() ? "configured" : "not set"}
        </strong>
        . Status JSON: <a href="/api/admin/maintenance/status">/api/admin/maintenance/status</a> · Deep
        health: <a href="/api/health/deep">/api/health/deep</a>
      </p>
      <p style={{ fontSize: "0.9rem" }}>
        Set <code>MAINTENANCE_ADMIN_TOKEN</code> on the <strong>web</strong> service. One run at a
        time. Does not enable live trading.
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
        {`curl -X POST $AUGURIUM_DASHBOARD_URL/api/admin/maintenance/run \\\n  -H "Authorization: Bearer $MAINTENANCE_ADMIN_TOKEN"`}
      </pre>

      <WatchlistSeedForm />

      <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Watchlist seed API</h2>
      <p style={{ fontSize: "0.9rem" }}>
        Token on this host:{" "}
        <strong
          className={
            process.env.COPY_ADMIN_TOKEN?.trim() || process.env.MAINTENANCE_ADMIN_TOKEN?.trim()
              ? styles.ok
              : styles.warn
          }
        >
          {process.env.COPY_ADMIN_TOKEN?.trim() || process.env.MAINTENANCE_ADMIN_TOKEN?.trim()
            ? "configured"
            : "not set"}
        </strong>
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
        {`curl -X POST $AUGURIUM_DASHBOARD_URL/api/admin/copy/watchlist \\\n  -H "Authorization: Bearer $COPY_ADMIN_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"wallet":"0x89dd49bf87c41be422927372a0b75c6ab577f662","notes":"sports-mlb"}'`}
      </pre>

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

      <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Web memory & snapshot diagnostics</h2>
      <p className={styles.hint}>
        Render web should read worker snapshots (queue <code>web:snapshot-refresh</code>, default
        every 3m). Health check: <a href="/api/health">/api/health</a> (lightweight).
      </p>
      {webMemory && (
        <ul style={{ fontSize: "0.85rem" }}>
          <li>
            Web process heap: {webMemory.heapUsedMb} MB / {webMemory.heapTotalMb} MB · RSS{" "}
            {webMemory.rssMb} MB · in-flight queries: {webMemory.inFlightQueries}
          </li>
        </ul>
      )}
      {diag && (
        <ul style={{ fontSize: "0.85rem" }}>
          <li>Worker last refresh: {diag.refreshedAt}</li>
          <li>
            Worker heap at refresh: {diag.heapUsedMb ?? "—"} MB · connection limit:{" "}
            {diag.webPrismaConnectionLimit}
          </li>
          {diag.steps.map((s) => (
            <li key={s.name}>
              {s.name}: {s.ok ? "ok" : "fail"} ({s.durationMs}ms){s.error ? ` — ${s.error}` : ""}
            </li>
          ))}
        </ul>
      )}
      {snapshotAges && (
        <ul style={{ fontSize: "0.85rem" }}>
          <li>
            Dashboard snapshot age:{" "}
            {snapshotAges.dashboard
              ? `${Math.round(snapshotAges.dashboard.ageMs / 1000)}s`
              : "none"}
          </li>
          <li>
            Copy snapshot age:{" "}
            {snapshotAges.copyTrading
              ? `${Math.round(snapshotAges.copyTrading.ageMs / 1000)}s`
              : "none"}
          </li>
          <li>
            Readiness snapshot age:{" "}
            {snapshotAges.readiness
              ? `${Math.round(snapshotAges.readiness.ageMs / 1000)}s`
              : "none"}
          </li>
        </ul>
      )}
      <p className={styles.hint} style={{ marginTop: "1rem" }}>
        Optional ops: schedule a daily web service restart off-peak on Render if heap drifts — not
        a substitute for snapshots. Set <code>AUGURIUM_SERVICE=web</code> and{" "}
        <code>WEB_PRISMA_CONNECTION_LIMIT=3</code> on the web service.
      </p>

      <p style={{ marginTop: "2rem", fontSize: "0.8rem" }}>
        <Link href="/readiness">Readiness</Link> · <Link href="/health">Health</Link> ·{" "}
        <Link href="/shadow/payout-audit">Payout audit</Link>
      </p>
    </main>
  );
}
