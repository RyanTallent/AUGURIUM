import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const config = {
    enabled:
      process.env.DISCORD_ENABLED === "true" ||
      process.env.DISCORD_ENABLED === "1",
    webhook: Boolean(process.env.DISCORD_WEBHOOK_URL?.trim()),
  };

  let events: Awaited<ReturnType<typeof loadEvents>> = [];
  let weekly: Awaited<ReturnType<typeof loadWeekly>> = [];
  let counts = { PENDING: 0, SENT: 0, SKIPPED: 0, FAILED: 0 };
  let dbOk = true;

  try {
    events = await loadEvents();
    weekly = await loadWeekly();
    const grouped = await prisma.discordEvent.groupBy({
      by: ["status"],
      _count: true,
    });
    for (const g of grouped) {
      const k = g.status as keyof typeof counts;
      if (k in counts) counts[k] = g._count;
    }
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Reports
          </p>
          <h1>Discord & reports</h1>
          <p className={styles.hint}>Advisory and shadow alerts — not live trade fills</p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          Discord {config.enabled && config.webhook ? "configured" : "off / incomplete"}
        </span>
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Pending</h2>
          <p className={styles.metric}>{counts.PENDING}</p>
        </article>
        <article className={styles.card}>
          <h2>Sent</h2>
          <p className={styles.metric}>{counts.SENT}</p>
        </article>
        <article className={styles.card}>
          <h2>Skipped</h2>
          <p className={styles.metric}>{counts.SKIPPED}</p>
        </article>
        <article className={styles.card}>
          <h2>Failed</h2>
          <p className={styles.metric}>{counts.FAILED}</p>
        </article>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Latest weekly reports</h2>
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Created</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {weekly.length === 0 ? (
                <tr>
                  <td colSpan={4} className={tableStyles.empty}>
                    No weekly reports queued yet
                  </td>
                </tr>
              ) : (
                weekly.map((e) => (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td>{e.status}</td>
                    <td>{new Date(e.createdAt).toLocaleString()}</td>
                    <td>{e.sentAt ? new Date(e.sentAt).toLocaleString() : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Recent Discord events</h2>
        <div className={tableStyles.tableWrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Status</th>
                <th>Error</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.eventType}</td>
                  <td>{short(e.title, 48)}</td>
                  <td>{e.status}</td>
                  <td>{short(e.errorMessage ?? "—", 40)}</td>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.modules} style={{ marginTop: "2rem" }}>
        <h2>Setup</h2>
        <ul>
          <li>Set DISCORD_ENABLED=true in .env</li>
          <li>Set DISCORD_WEBHOOK_URL to your channel webhook URL</li>
          <li>Run npm run discord:enqueue and npm run discord:dispatch</li>
        </ul>
      </section>
    </main>
  );
}

function short(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function loadEvents() {
  return prisma.discordEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 40,
  });
}

async function loadWeekly() {
  return prisma.discordEvent.findMany({
    where: { eventType: "WEEKLY_REPORT" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}
