import Link from "next/link";
import {
  computeCopyBoard,
  detectOutlierOpportunities,
  computeAcceptanceForensics,
} from "@augurium/copy-trading";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function CopyPortfoliosPage() {
  let board: Awaited<ReturnType<typeof computeCopyBoard>> | null = null;
  let outliers: Awaited<ReturnType<typeof detectOutlierOpportunities>> = [];
  let acceptance: Awaited<ReturnType<typeof computeAcceptanceForensics>> | null = null;

  try {
    [board, outliers, acceptance] = await Promise.all([
      computeCopyBoard(60),
      detectOutlierOpportunities(),
      computeAcceptanceForensics(),
    ]);
  } catch {
    board = null;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/copy">Copy</Link> / Portfolios
          </p>
          <h1>Copy portfolio simulator</h1>
          <p className={styles.hint}>
            Strategy metrics from trader snapshots — simulated baskets, not fabricated fills.
          </p>
        </div>
      </header>

      {!board ? (
        <p className={styles.warn}>Unable to load strategies.</p>
      ) : (
        <section className={styles.grid}>
          {board.strategies.map((s) => (
            <article key={s.id} className={styles.card}>
              <h2>{s.label}</h2>
              <p className={styles.metric}>{s.traderCount} traders</p>
              <p className={styles.hint}>
                30d ROI {fmtPct(s.roi30d)} · DD {fmtPct(s.maxDrawdown)} · Sharpe~ {s.sharpeLike}{" "}
                · hit {fmtPct(s.hitRate)}
              </p>
              <p className={styles.hint}>
                Deploy cap {fmtPct(s.capitalAllocationPct)} · EV {s.expectedValue.toFixed(3)}
              </p>
              {s.traders.length > 0 && (
                <p className={styles.hint}>
                  {s.traders.map((t) => `${t.address.slice(0, 6)}…`).join(", ")}
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {acceptance && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Acceptance bottleneck forensics</h2>
          <p className={styles.hint}>
            ACCEPT {acceptance.accepted} · REJECT {acceptance.rejected} · rate{" "}
            {(acceptance.acceptanceRate * 100).toFixed(1)}% — thresholds not lowered
          </p>
          <ul>
            {[
              ...acceptance.thresholdBottlenecks,
              ...acceptance.signalBottlenecks,
              ...acceptance.allocationBottlenecks,
            ].map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      )}

      {outliers.length > 0 && (
        <>
          <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Outlier opportunities (no auto-trade)</h2>
          <ul>
            {outliers.slice(0, 10).map((o) => (
              <li key={o.id}>
                <strong>{o.label}</strong> — {o.marketTitle}: {o.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={styles.hint} style={{ marginTop: "2rem" }}>
        <Link href="/copy">← Copy dashboard</Link>
      </p>
    </main>
  );
}
