import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function ShadowPage() {
  let open: Awaited<ReturnType<typeof loadShadow>> = [];
  let closed: typeof open = [];
  let expired: typeof open = [];
  let dbOk = true;
  try {
    [open, closed, expired] = await Promise.all([
      loadShadow("OPEN"),
      loadShadow("CLOSED"),
      loadShadow("EXPIRED"),
    ]);
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Shadow portfolio
          </p>
          <h1>Shadow trades</h1>
          <p className={styles.hint}>Simulated entries — no live capital at risk</p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          {open.length} open · {closed.length} closed
        </span>
      </header>

      <ShadowTable title="Open shadow trades" rows={open} />
      <div style={{ marginTop: "2rem" }}>
        <ShadowTable title="Closed shadow trades" rows={closed} />
      </div>
      {expired.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <ShadowTable title="Expired" rows={expired} />
        </div>
      )}
    </main>
  );
}

function includeRel() {
  return {
    signal: { select: { signalType: true, reasoning: true } },
    market: { select: { title: true } },
  } as const;
}

async function loadShadow(status: string) {
  return prisma.shadowTrade.findMany({
    where: { status },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: includeRel(),
  });
}

function ShadowTable({
  title,
  rows,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof loadShadow>>;
}) {
  return (
    <section>
      <h2 style={{ marginBottom: "0.75rem", fontSize: "1rem" }}>{title}</h2>
      <div className={tableStyles.tableWrap}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th>Signal</th>
              <th>Status</th>
              <th>ROI</th>
              <th>PnL</th>
              <th>MFE</th>
              <th>MAE</th>
              <th>Hold better?</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className={tableStyles.empty}>
                  None — run shadow sync after signals exist
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/replay?signal=${r.signalId}`}>{short(r.market.title, 36)}</Link>
                  </td>
                  <td>{r.side}</td>
                  <td>{r.signal.signalType}</td>
                  <td>{r.status}</td>
                  <td>{(r.roi * 100).toFixed(1)}%</td>
                  <td>${(r.realizedPnl + r.unrealizedPnl).toFixed(2)}</td>
                  <td>{(r.maxFavorableExcursion * 100).toFixed(1)}%</td>
                  <td>{(r.maxAdverseExcursion * 100).toFixed(1)}%</td>
                  <td>{r.wouldHaveBeenBetterToHold ? "yes" : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function short(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
