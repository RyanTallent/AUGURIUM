import Link from "next/link";
import { computeSignalValidation } from "@augurium/database";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";

export default async function SignalValidationPage() {
  let report: Awaited<ReturnType<typeof computeSignalValidation>> | null = null;
  try {
    report = await computeSignalValidation();
  } catch {
    report = null;
  }

  const reasons = report
    ? Object.entries(report.tradeNowRejectedReasons).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/signals">Signals</Link> / Validation
          </p>
          <h1>TRADE_NOW rejection visibility</h1>
          <p className={styles.hint}>Why promotion to TRADE_NOW was blocked (last 7 days)</p>
        </div>
      </header>

      {!report ? (
        <p className={styles.warn}>Unable to load signal validation.</p>
      ) : (
        <>
          <section className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.kicker}>Active TRADE_NOW</span>
              <strong>{report.activeByType.TRADE_NOW ?? 0}</strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Base TRADE_NOW (7d)</span>
              <strong>{report.recentBaseTradeNowCount}</strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Near-misses downgraded</span>
              <strong className={styles.warn}>{report.tradeNowNearMisses}</strong>
            </div>
          </section>

          <h2 style={{ marginTop: "2rem", fontSize: "1rem" }}>Rejection reason counts</h2>
          {reasons.length === 0 ? (
            <p className={styles.hint}>No TRADE_NOW near-misses recorded yet — run generate-signals after deploy.</p>
          ) : (
            <ul>
              {reasons.map(([reason, count]) => (
                <li key={reason}>
                  <code>{reason}</code>: {count}
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ marginTop: "1.5rem", fontSize: "1rem" }}>Active by type</h2>
          <ul>
            {Object.entries(report.activeByType).map(([type, count]) => (
              <li key={type}>
                {type}: {count}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
