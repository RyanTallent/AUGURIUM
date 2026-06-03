import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function AllocationsPage() {
  let snapshot = null;
  let decisions: Awaited<ReturnType<typeof loadDecisions>> = [];
  let dbOk = true;

  try {
    snapshot = await prisma.portfolioAllocationSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
    });
    decisions = await loadDecisions();
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Allocations
          </p>
          <h1>Allocation decisions</h1>
          <p className={styles.hint}>Recommended simulated sizes — not live orders</p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          {snapshot
            ? `${(snapshot.deployedPct * 100).toFixed(0)}% deployed`
            : "No snapshot"}
        </span>
      </header>

      {snapshot && (
        <section className={styles.grid}>
          <article className={styles.card}>
            <h2>Accepted</h2>
            <p className={styles.metric}>{snapshot.acceptedCount}</p>
          </article>
          <article className={styles.card}>
            <h2>Watch</h2>
            <p className={styles.metric}>{snapshot.watchCount}</p>
          </article>
          <article className={styles.card}>
            <h2>Reject</h2>
            <p className={styles.metric}>{snapshot.rejectCount}</p>
          </article>
          <article className={styles.card}>
            <h2>Reallocate</h2>
            <p className={styles.metric}>{snapshot.reallocateCount}</p>
          </article>
          <article className={styles.card}>
            <h2>Largest position %</h2>
            <p className={styles.metric}>
              {(snapshot.largestPositionPct * 100).toFixed(1)}%
            </p>
          </article>
        </section>
      )}

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Latest portfolio decisions</h2>
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Decision</th>
                <th>Market</th>
                <th>Size</th>
                <th>%</th>
                <th>Score</th>
                <th>Risk</th>
                <th>Reallocate target</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td>{d.decision}</td>
                  <td>{d.market.title.slice(0, 45)}</td>
                  <td>${d.recommendedSizeUsd.toFixed(2)}</td>
                  <td>{(d.recommendedPct * 100).toFixed(1)}%</td>
                  <td>{d.compositeScore.toFixed(0)}</td>
                  <td>{d.riskScore.toFixed(0)}</td>
                  <td>{d.reallocationTargetId ? "yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

async function loadDecisions() {
  return prisma.portfolioDecision.findMany({
    orderBy: { createdAt: "desc" },
    take: 80,
    include: { market: { select: { title: true } } },
  });
}
