import Link from "next/link";
import { SnapshotNotice } from "../../components/SnapshotNotice";
import { loadCopyBoardPageData } from "../../lib/page-snapshots";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function shortWallet(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default async function CopyDashboardPage() {
  const { board, readiness, mirrorAnalytics, weeklyRisk, meta } =
    await loadCopyBoardPageData();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Copy trading
          </p>
          <h1>Who should AUGURIUM copy today?</h1>
        </div>
        {readiness && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className={readiness.paperTradingReady ? styles.ok : styles.warn}>
              Paper: {readiness.paperTradingReady ? "READY" : "NOT READY"}
            </span>
            <span
              className={
                (readiness as { liveCopyReady?: boolean }).liveCopyReady
                  ? styles.ok
                  : styles.warn
              }
            >
              Live copy:{" "}
              {(readiness as { liveCopyReady?: boolean }).liveCopyReady ? "READY" : "NOT READY"}
            </span>
          </div>
        )}
      </header>

      <SnapshotNotice meta={meta} />

      {weeklyRisk && (
        <section className={styles.grid} style={{ marginTop: "1rem" }}>
          <article className={styles.card}>
            <h2>Week {weeklyRisk.weekKey}</h2>
            <p className={styles.metricSmall}>
              PnL ${weeklyRisk.totalPnlUsd.toFixed(0)} / bankroll $
              {weeklyRisk.bankrollUsd.toFixed(0)}
            </p>
          </article>
          <article className={styles.card}>
            <h2>Weekly stop</h2>
            <p className={weeklyRisk.halted ? styles.warn : styles.ok}>
              {weeklyRisk.halted
                ? `HALTED (${(weeklyRisk.lossPct * 100).toFixed(1)}%)`
                : `OK (max ${(weeklyRisk.maxLossPct * 100).toFixed(0)}% loss)`}
            </p>
          </article>
          {mirrorAnalytics && (
            <article className={styles.card}>
              <h2>Paper vs leaders</h2>
              <p className={styles.metricSmall}>
                Paper ${mirrorAnalytics.paperPnlUsd.toFixed(0)} · leaders $
                {mirrorAnalytics.sourcePnlUsd.toFixed(0)}
              </p>
            </article>
          )}
        </section>
      )}

      {readiness && !readiness.liveCopyReady && readiness.liveCopyBlockers.length > 0 && (
        <section className={styles.modules} style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1rem" }}>Live copy — not ready yet</h2>
          <ul style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
            {readiness.liveCopyBlockers.slice(0, 6).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className={styles.hint} style={{ marginTop: "0.5rem" }}>
            See DEPLOY.md → Live copy trading for the full enable checklist.
          </p>
        </section>
      )}

      {!board ? (
        <p className={styles.warn}>Unable to load copy board.</p>
      ) : (
        <>
          <section className={styles.grid}>
            <article className={styles.card}>
              <h2>COPY today</h2>
              <p className={styles.metric}>{board.topTradersToday.length}</p>
            </article>
            <article className={styles.card}>
              <h2>Improving</h2>
              <p className={styles.metric}>{board.improving.length}</p>
            </article>
            <article className={styles.card}>
              <h2>Deteriorating</h2>
              <p className={styles.metric}>{board.deteriorating.length}</p>
            </article>
          </section>

          <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Top traders to copy today</h2>
          <CopyTable rows={board.topTradersToday} />
        </>
      )}
    </main>
  );
}

function CopyTable({
  rows,
}: {
  rows: Array<{
    address: string;
    recommendation: string;
    copyScore: number;
    riskScore: number;
    expectedValue: number;
    maxDrawdown: number;
    confidence: number;
    specialization: string | null;
    suggestedUsdAt100: number;
    suggestedUsdAt1k: number;
    suggestedUsdAt10k: number;
  }>;
}) {
  if (rows.length === 0) {
    return <p className={styles.hint}>No traders in this bucket.</p>;
  }
  return (
    <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
      <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Trader</th>
            <th>Rec</th>
            <th>Copy</th>
            <th>Risk</th>
            <th>EV</th>
            <th>DD</th>
            <th>$10k</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.address}>
              <td>
                <Link href={`/traders/${r.address}`}>{shortWallet(r.address)}</Link>
              </td>
              <td>{r.recommendation}</td>
              <td>{r.copyScore.toFixed(1)}</td>
              <td>{r.riskScore}</td>
              <td>{r.expectedValue.toFixed(3)}</td>
              <td>{fmtPct(r.maxDrawdown)}</td>
              <td>${r.suggestedUsdAt10k}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
