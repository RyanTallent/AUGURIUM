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
  const { board, readiness, meta } = await loadCopyBoardPageData();

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
          <span className={readiness.paperTradingReady ? styles.ok : styles.warn}>
            Paper ready: {readiness.paperTradingReady ? "YES" : "NO"}
          </span>
        )}
      </header>

      <SnapshotNotice meta={meta} />

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
