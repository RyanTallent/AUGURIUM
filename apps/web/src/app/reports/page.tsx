import Link from "next/link";
import { prisma } from "@augurium/database";
import { getDiscordOpsStatus } from "../../lib/ops-status";
import styles from "../page.module.css";
import tableStyles from "../traders/traders.module.css";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const discord = await getDiscordOpsStatus();

  let events: Awaited<ReturnType<typeof loadEvents>> = [];
  let weekly: Awaited<ReturnType<typeof loadWeekly>> = [];
  let dbOk = true;

  try {
    events = await loadEvents();
    weekly = await loadWeekly();
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
          <p className={styles.hint}>Advisory alerts — not live trade fills. Webhook value is never shown.</p>
        </div>
        <span className={discord.canSend ? styles.ok : styles.warn}>
          Discord {discord.canSend ? "ready" : "not configured on this host"}
        </span>
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>Discord enabled</h2>
          <p className={styles.metricSmall}>{discord.enabled ? "yes" : "no"}</p>
        </article>
        <article className={styles.card}>
          <h2>Webhook configured</h2>
          <p className={styles.metricSmall}>{discord.webhookConfigured ? "yes" : "no"}</p>
        </article>
        <article className={styles.card}>
          <h2>Last dispatch</h2>
          <p className={styles.metricSmall}>{discord.lastDispatchStatus ?? "—"}</p>
        </article>
        <article className={styles.card}>
          <h2>Last skipped reason</h2>
          <p className={styles.metricSmall}>
            {discord.lastSkippedReason
              ? truncate(discord.lastSkippedReason, 48)
              : "—"}
          </p>
        </article>
      </section>

      {!discord.canSend && (
        <section className={styles.modules} style={{ marginTop: "1.5rem" }}>
          <p className={styles.warn}>
            On Render, set in the <strong>augurium-shared</strong> Environment Group:{" "}
            <code>DISCORD_ENABLED=true</code>, <code>DISCORD_WEBHOOK_URL</code> (secret), and{" "}
            <code>AUGURIUM_DASHBOARD_URL=https://augurium-web.onrender.com</code>. Redeploy worker
            after saving.
          </p>
        </section>
      )}

      <section className={styles.grid} style={{ marginTop: "1.5rem" }}>
        <article className={styles.card}>
          <h2>Pending</h2>
          <p className={styles.metric}>{discord.pending}</p>
        </article>
        <article className={styles.card}>
          <h2>Sent</h2>
          <p className={styles.metric}>{discord.sent}</p>
        </article>
        <article className={styles.card}>
          <h2>Skipped</h2>
          <p className={styles.metric}>{discord.skipped}</p>
        </article>
        <article className={styles.card}>
          <h2>Failed</h2>
          <p className={styles.metric}>{discord.failed}</p>
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
                    {dbOk ? "No weekly reports yet" : "DB offline"}
                  </td>
                </tr>
              ) : (
                weekly.map((w) => (
                  <tr key={w.id}>
                    <td>{w.title}</td>
                    <td>{w.status}</td>
                    <td>{new Date(w.createdAt).toLocaleString()}</td>
                    <td>{w.sentAt ? new Date(w.sentAt).toLocaleString() : "—"}</td>
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
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className={tableStyles.empty}>
                    {dbOk ? "No events" : "DB offline"}
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.eventType}</td>
                    <td>{truncate(e.title, 40)}</td>
                    <td>{e.status}</td>
                    <td title={e.errorMessage ?? undefined}>
                      {e.errorMessage ? truncate(e.errorMessage, 36) : "—"}
                    </td>
                    <td>{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function loadEvents() {
  return prisma.discordEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}

async function loadWeekly() {
  return prisma.discordEvent.findMany({
    where: { eventType: "WEEKLY_REPORT" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}
