import Link from "next/link";
import { computeCopyBoard } from "@augurium/copy-trading";
import { computeCopyTradingReadiness } from "@augurium/copy-trading";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function shortWallet(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default async function CopyDashboardPage() {
  let board: Awaited<ReturnType<typeof computeCopyBoard>> | null = null;
  let readiness: Awaited<ReturnType<typeof computeCopyTradingReadiness>> | null = null;
  try {
    [board, readiness] = await Promise.all([computeCopyBoard(60), computeCopyTradingReadiness()]);
  } catch {
    board = null;
    readiness = null;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Copy trading
          </p>
          <h1>Who should AUGURIUM copy today?</h1>
          <p className={styles.hint}>
            Ranked by expected copyability — not raw ROI. Live trading remains OFF.
          </p>
        </div>
        {readiness && (
          <span className={readiness.paperTradingReady ? styles.ok : styles.warn}>
            Paper ready: {readiness.paperTradingReady ? "YES" : "NO"}
          </span>
        )}
      </header>

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
            <article className={styles.card}>
              <h2>Mirror positions</h2>
              <p className={styles.metric}>{board.copyPositionsToday.length}</p>
            </article>
          </section>

          <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Top traders to copy today</h2>
          <CopyTable rows={board.topTradersToday} />

          {board.improving.length > 0 && (
            <>
              <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Improving</h2>
              <CopyTable rows={board.improving} />
            </>
          )}

          {board.deteriorating.length > 0 && (
            <>
              <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Deteriorating (avoid)</h2>
              <CopyTable rows={board.deteriorating} />
            </>
          )}

          {board.copyPositionsToday.length > 0 && (
            <>
              <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>
                Positions AUGURIUM would copy today
              </h2>
              <ul>
                {board.copyPositionsToday.map((p) => (
                  <li key={`${p.traderAddress}-${p.marketTitle}`}>
                    <Link href={`/traders/${p.traderAddress}`}>{shortWallet(p.traderAddress)}</Link>
                    {" — "}
                    {p.marketTitle} ({p.side}) size {p.size.toFixed(2)} @ {p.avgPrice.toFixed(3)}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className={styles.hint} style={{ marginTop: "2rem" }}>
            <Link href="/copy-portfolios">Copy portfolio strategies</Link> ·{" "}
            <Link href="/readiness">Readiness</Link> ·{" "}
            <Link href="/maintenance">Maintenance</Link>
          </p>
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
    strengths: string[];
    weaknesses: string[];
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
            <th>Conf</th>
            <th>Spec</th>
            <th>$100</th>
            <th>$1k</th>
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
              <td>{fmtPct(r.confidence)}</td>
              <td>{r.specialization ?? "—"}</td>
              <td>${r.suggestedUsdAt100}</td>
              <td>${r.suggestedUsdAt1k}</td>
              <td>${r.suggestedUsdAt10k}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows[0] && (
        <p className={styles.hint} style={{ marginTop: "0.5rem" }}>
          {rows[0].strengths.join(" · ")}
          {rows[0].weaknesses.length ? ` — watch: ${rows[0].weaknesses.join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}
