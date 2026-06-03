import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  let signals: Awaited<ReturnType<typeof loadSignals>> = [];
  let dbOk = true;
  try {
    signals = await loadSignals();
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Signals
          </p>
          <h1>Market signals</h1>
          <p className={styles.hint}>Explainable, non-random — TRADE_NOW / WATCHLIST / RESEARCH / IGNORE</p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          {dbOk ? `${signals.length} active` : "DB offline"}
        </span>
      </header>

      <section className={tableStyles.tableWrap}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th>Type</th>
              <th>Consensus</th>
              <th>Alpha</th>
              <th>Quality</th>
              <th>Conf.</th>
              <th>Traders</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {signals.length === 0 ? (
              <tr>
                <td colSpan={9} className={tableStyles.empty}>
                  No active signals. Run{" "}
                  <code>npm run signals:generate</code> after Phase B scoring.
                </td>
              </tr>
            ) : (
              signals.map((s) => (
                <tr key={s.id}>
                  <td title={s.reasoning}>{truncate(s.market.title, 40)}</td>
                  <td>{s.side}</td>
                  <td>
                    <span className={tableStyles.tier}>{s.signalType}</span>
                  </td>
                  <td>{s.consensusScore.toFixed(0)}</td>
                  <td>{s.alphaScore.toFixed(0)}</td>
                  <td>{s.marketQualityScore.toFixed(0)}</td>
                  <td>{s.systemConfidenceScore.toFixed(0)}</td>
                  <td>{s.triggerTraderWallets.length}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {signals.length > 0 && (
        <section className={styles.modules} style={{ marginTop: "2rem" }}>
          <h2>Top reasoning (latest)</h2>
          <ul>
            {signals.slice(0, 8).map((s) => (
              <li key={s.id} style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                <strong>
                  {s.signalType} · {truncate(s.market.title, 36)} · {s.side}
                </strong>
                <br />
                {s.reasoning}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function loadSignals() {
  return prisma.signal.findMany({
    where: { status: "active" },
    orderBy: [{ alphaScore: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      market: { select: { title: true, slug: true } },
    },
  });
}
