import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "true" || v === "1" || v === "yes";
}

export default async function ExecutionPage() {
  const executionEnabled = envFlag("EXECUTION_ENABLED");
  const liveTradingEnabled = envFlag("LIVE_TRADING_ENABLED");
  const allowRealMoney = envFlag("ALLOW_REAL_MONEY");
  const provider = process.env.EXECUTION_PROVIDER ?? "paper";
  const credentialsConfigured = Boolean(
    process.env.POLYMARKET_API_KEY?.trim() &&
      process.env.POLYMARKET_FUNDER_ADDRESS?.trim(),
  );

  let orders: Awaited<ReturnType<typeof loadOrders>> = [];
  let positions: Awaited<ReturnType<typeof loadPositions>> = [];
  let blocked: typeof orders = [];
  let recon = null;
  let dbOk = true;

  try {
    [orders, positions, blocked, recon] = await Promise.all([
      loadOrders(),
      loadPositions(),
      loadBlocked(),
      prisma.executionReconciliation.findUnique({ where: { id: "current" } }),
    ]);
  } catch {
    dbOk = false;
  }

  const liveActive =
    executionEnabled && provider === "polymarket" && liveTradingEnabled && allowRealMoney;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Execution
          </p>
          <h1>Execution control</h1>
          <p className={styles.hint}>
            Provider architecture — live trading off unless all env gates enabled
          </p>
        </div>
        <span className={liveActive ? styles.warn : styles.ok}>
          {liveActive ? "LIVE MODE ON" : "Live trading disabled"}
        </span>
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Provider</h2>
          <p className={styles.metric}>{provider}</p>
        </article>
        <article className={styles.card}>
          <h2>Execution enabled</h2>
          <p className={styles.metric}>{executionEnabled ? "Yes" : "No"}</p>
        </article>
        <article className={styles.card}>
          <h2>Live trading</h2>
          <p className={styles.metric}>{liveTradingEnabled ? "Flag on" : "Off"}</p>
        </article>
        <article className={styles.card}>
          <h2>Credentials</h2>
          <p className={styles.metric}>
            {credentialsConfigured ? "Configured" : "Not configured"}
          </p>
          <p className={styles.hint}>Secrets never shown on dashboard</p>
        </article>
        <article className={styles.card}>
          <h2>Reconciliation</h2>
          <p className={styles.metric}>{recon?.status ?? "—"}</p>
        </article>
        <article className={styles.card}>
          <h2>Polymarket provider</h2>
          <p className={styles.metric} style={{ fontSize: "0.85rem" }}>
            NOT_READY until CLOB wired
          </p>
        </article>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1rem" }}>Safety gates (all required for live)</h2>
        <ul>
          <li>EXECUTION_ENABLED=true</li>
          <li>EXECUTION_PROVIDER=paper or polymarket</li>
          <li>LIVE_TRADING_ENABLED + ALLOW_REAL_MONEY (Polymarket only)</li>
          <li>Credentials validated</li>
          <li>Signal TRADE_NOW + portfolio ACCEPT</li>
          <li>Reconciliation OK, no duplicate/conflicting positions</li>
        </ul>
      </section>

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Open execution positions</h2>
        <OrdersTable
          rows={positions.map((p) => ({
            id: p.id,
            status: p.status,
            market: p.market.title.slice(0, 40),
            side: p.side,
            size: `$${p.sizeUsd.toFixed(2)}`,
            detail: `uPnL $${p.unrealizedPnl.toFixed(2)}`,
          }))}
          emptyLabel="No open execution positions"
        />
      </div>

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Recent orders</h2>
        <OrdersTable
          rows={orders.map((o) => ({
            id: o.id,
            status: o.status,
            market: o.market.title.slice(0, 40),
            side: o.side,
            size: `$${o.requestedSizeUsd.toFixed(2)}`,
            detail: o.mode,
          }))}
          emptyLabel={dbOk ? "No execution orders yet" : "Database unavailable"}
        />
      </div>

      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Blocked orders</h2>
        <OrdersTable
          rows={blocked.map((o) => ({
            id: o.id,
            status: o.status,
            market: o.market.title.slice(0, 40),
            side: o.side,
            size: o.blockReason?.slice(0, 60) ?? "—",
            detail: o.mode,
          }))}
          emptyLabel="No blocked orders"
        />
      </div>
    </main>
  );
}

function OrdersTable({
  rows,
  emptyLabel,
}: {
  rows: { id: string; status: string; market: string; side: string; size: string; detail: string }[];
  emptyLabel: string;
}) {
  return (
    <div className={tableStyles.tableWrap}>
      <table className={tableStyles.table}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Market</th>
            <th>Side</th>
            <th>Size / reason</th>
            <th>Mode</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.status}</td>
              <td>{r.market}</td>
              <td>{r.side}</td>
              <td>{r.size}</td>
              <td>{r.detail}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5}>{emptyLabel}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

async function loadOrders() {
  return prisma.executionOrder.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { market: { select: { title: true } } },
  });
}

async function loadPositions() {
  return prisma.executionPosition.findMany({
    where: { status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: { market: { select: { title: true } } },
  });
}

async function loadBlocked() {
  return prisma.executionOrder.findMany({
    where: { status: "BLOCKED" },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { market: { select: { title: true } } },
  });
}
