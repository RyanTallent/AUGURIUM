import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  let state = null;
  let events: Awaited<ReturnType<typeof loadEvents>> = [];
  let rejected: Awaited<ReturnType<typeof loadRejected>> = [];
  let exposure: { category: string; usd: number }[] = [];
  let dbOk = true;

  try {
    state = await prisma.portfolioState.findUnique({ where: { id: "current" } });
    events = await loadEvents();
    rejected = await loadRejected();
    const open = await prisma.portfolioPosition.findMany({
      where: { status: "OPEN" },
      select: { category: true, allocatedUsd: true, marketId: true },
    });
    const byCat = new Map<string, number>();
    for (const p of open) {
      const c = p.category ?? "uncategorized";
      byCat.set(c, (byCat.get(c) ?? 0) + p.allocatedUsd);
    }
    exposure = [...byCat.entries()].map(([category, usd]) => ({ category, usd }));
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Risk
          </p>
          <h1>Risk & exposure</h1>
          <p className={styles.hint}>Simulated risk events — no live capital at risk</p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>Advisory only</span>
      </header>

      {state && (
        <section className={styles.grid}>
          <article className={styles.card}>
            <h2>Drawdown</h2>
            <p className={styles.metric}>{(state.currentDrawdown * 100).toFixed(1)}%</p>
          </article>
          <article className={styles.card}>
            <h2>Drawdown mode</h2>
            <p className={styles.metric}>
              {state.drawdownMode ? "Active (50% sizing)" : "Off"}
            </p>
          </article>
          <article className={styles.card}>
            <h2>Deployed / bankroll</h2>
            <p className={styles.metric}>
              {((state.deployedCapital / Math.max(state.tradingBankroll, 1)) * 100).toFixed(0)}%
            </p>
          </article>
        </section>
      )}

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Category exposure</h2>
        <ul>
          {exposure.map((e) => (
            <li key={e.category}>
              {e.category}: ${e.usd.toFixed(2)}
            </li>
          ))}
          {exposure.length === 0 && <li>No open exposure</li>}
        </ul>
      </div>

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Risk events</h2>
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Severity</th>
                <th>Message</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.eventType}</td>
                  <td>{e.severity}</td>
                  <td>{e.message.slice(0, 120)}</td>
                  <td>{e.createdAt.toISOString().slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Recent rejected signals</h2>
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Market</th>
                <th>Score</th>
                <th>Risk</th>
                <th>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((d) => (
                <tr key={d.id}>
                  <td>{d.market.title.slice(0, 50)}</td>
                  <td>{d.compositeScore.toFixed(0)}</td>
                  <td>{d.riskScore.toFixed(0)}</td>
                  <td>{d.reasons.slice(0, 2).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

async function loadEvents() {
  return prisma.riskEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

async function loadRejected() {
  return prisma.portfolioDecision.findMany({
    where: { decision: "REJECT" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { market: { select: { title: true } } },
  });
}
