import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  let state = null;
  let positions: Awaited<ReturnType<typeof loadOpen>> = [];
  let dbOk = true;
  try {
    state = await prisma.portfolioState.findUnique({ where: { id: "current" } });
    positions = await loadOpen();
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Portfolio
          </p>
          <h1>Simulated portfolio</h1>
          <p className={styles.hint}>
            Advisory capital allocation — no live execution or real trades
          </p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          {positions.length} open simulated positions
        </span>
      </header>

      {state ? (
        <section className={styles.grid}>
          <Metric label="Account value" value={`$${state.accountValue.toFixed(2)}`} />
          <Metric label="Trading bankroll" value={`$${state.tradingBankroll.toFixed(2)}`} />
          <Metric label="Reserve capital" value={`$${state.reserveCapital.toFixed(2)}`} />
          <Metric label="Deployed" value={`$${state.deployedCapital.toFixed(2)}`} />
          <Metric label="Available" value={`$${state.availableCapital.toFixed(2)}`} />
          <Metric label="Realized PnL" value={`$${state.realizedPnl.toFixed(2)}`} />
          <Metric label="Unrealized PnL" value={`$${state.unrealizedPnl.toFixed(2)}`} />
          <Metric label="High water mark" value={`$${state.highWaterMark.toFixed(2)}`} />
          <Metric
            label="Drawdown"
            value={`${(state.currentDrawdown * 100).toFixed(1)}%${state.drawdownMode ? " (mode)" : ""}`}
          />
        </section>
      ) : (
        <p className={styles.hint}>Run `npm run portfolio:run` to initialize portfolio state.</p>
      )}

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Open simulated positions</h2>
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th>Allocated</th>
                <th>ROI</th>
                <th>Risk</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td>{p.market.title.slice(0, 60)}</td>
                  <td>{p.side}</td>
                  <td>${p.allocatedUsd.toFixed(2)}</td>
                  <td>{(p.roi * 100).toFixed(1)}%</td>
                  <td>{p.riskScore.toFixed(0)}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={6}>No open positions</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.card}>
      <h2>{label}</h2>
      <p className={styles.metric}>{value}</p>
    </article>
  );
}

async function loadOpen() {
  return prisma.portfolioPosition.findMany({
    where: { status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { market: { select: { title: true } } },
  });
}
