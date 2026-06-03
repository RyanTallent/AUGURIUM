import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  let markets: Awaited<ReturnType<typeof loadMarkets>> = [];
  let dbOk = true;
  try {
    markets = await loadMarkets();
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Markets
          </p>
          <h1>Markets</h1>
          <p className={styles.hint}>Signal category and scores from Phase C consensus</p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          {dbOk ? `${markets.length} with signals` : "DB offline"}
        </span>
      </header>

      <section className={tableStyles.tableWrap}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>Market</th>
              <th>Signal</th>
              <th>Consensus</th>
              <th>Alpha</th>
              <th>Quality</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td colSpan={7} className={tableStyles.empty}>
                  No markets with active signals. Run signal generation after trader scoring.
                </td>
              </tr>
            ) : (
              markets.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span title={m.title}>{truncate(m.title, 48)}</span>
                  </td>
                  <td>
                    <span className={`${tableStyles.tier} ${signalClass(m.lastSignalType)}`}>
                      {m.lastSignalType ?? "—"}
                    </span>
                  </td>
                  <td>{m.lastConsensusScore?.toFixed(0) ?? "—"}</td>
                  <td>{m.lastAlphaScore?.toFixed(0) ?? "—"}</td>
                  <td>{m.marketQualityScore?.toFixed(0) ?? "—"}</td>
                  <td>{m.category ?? "—"}</td>
                  <td>{m.active ? (m.closed ? "closed" : "active") : "inactive"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function signalClass(type: string | null | undefined) {
  if (type === "TRADE_NOW") return tableStyles.tier_SUPER_ELITE;
  if (type === "WATCHLIST") return tableStyles.tier_RISING;
  return "";
}

async function loadMarkets() {
  return prisma.market.findMany({
    where: { lastSignalType: { not: null } },
    orderBy: [{ lastAlphaScore: "desc" }, { updatedAt: "desc" }],
    take: 150,
    select: {
      id: true,
      title: true,
      category: true,
      active: true,
      closed: true,
      lastSignalType: true,
      lastAlphaScore: true,
      lastConsensusScore: true,
      marketQualityScore: true,
    },
  });
}
