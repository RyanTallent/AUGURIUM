import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function SimulationsPage() {
  let byStrategy: { strategyName: string; avgRoi: number; count: number }[] = [];
  let topSims: Awaited<ReturnType<typeof loadTop>> = [];
  let dbOk = true;

  try {
    const grouped = await prisma.simulationResult.groupBy({
      by: ["strategyName"],
      _avg: { roi: true },
      _count: { id: true },
    });
    byStrategy = grouped
      .map((g) => ({
        strategyName: g.strategyName,
        avgRoi: g._avg.roi ?? 0,
        count: g._count.id,
      }))
      .sort((a, b) => b.avgRoi - a.avgRoi);

    topSims = await loadTop();
  } catch {
    dbOk = false;
  }

  const best = byStrategy[0];
  const bestDelay = byStrategy.filter((s) => s.strategyName.startsWith("entry_delay"));

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Simulations
          </p>
          <h1>Strategy comparison</h1>
          <p className={styles.hint}>Alternative exit and entry-delay simulations per shadow trade</p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          {best ? `Best: ${best.strategyName}` : "No data"}
        </span>
      </header>

      <section className={tableStyles.tableWrap}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Avg ROI</th>
              <th>Runs</th>
            </tr>
          </thead>
          <tbody>
            {byStrategy.length === 0 ? (
              <tr>
                <td colSpan={3} className={tableStyles.empty}>
                  No simulation results yet
                </td>
              </tr>
            ) : (
              byStrategy.map((s) => (
                <tr key={s.strategyName}>
                  <td>{s.strategyName}</td>
                  <td>{(s.avgRoi * 100).toFixed(2)}%</td>
                  <td>{s.count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {bestDelay.length > 0 && (
        <section className={styles.modules} style={{ marginTop: "1.5rem" }}>
          <h2>Entry delay comparison</h2>
          <ul>
            {bestDelay.map((d) => (
              <li key={d.strategyName}>
                {d.strategyName}: avg ROI {(d.avgRoi * 100).toFixed(2)}%
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Top simulated outcomes</h2>
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Market</th>
                <th>Strategy</th>
                <th>ROI</th>
                <th>Outcome</th>
                <th>Hold time</th>
              </tr>
            </thead>
            <tbody>
              {topSims.map((s) => (
                <tr key={s.id}>
                  <td>{short(s.shadowTrade.market.title, 40)}</td>
                  <td>{s.strategyName}</td>
                  <td>{(s.roi * 100).toFixed(1)}%</td>
                  <td>{s.outcome}</td>
                  <td>{Math.round(s.holdingTimeMs / 60000)}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function short(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function loadTop() {
  return prisma.simulationResult.findMany({
    orderBy: { roi: "desc" },
    take: 15,
    include: {
      shadowTrade: { include: { market: { select: { title: true } } } },
    },
  });
}
