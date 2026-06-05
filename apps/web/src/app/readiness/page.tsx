import Link from "next/link";
import { SnapshotNotice } from "../../components/SnapshotNotice";
import { loadReadinessPageData } from "../../lib/page-snapshots";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
  const { report, meta } = await loadReadinessPageData();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Readiness
          </p>
          <h1>Live trading readiness</h1>
        </div>
        {report && (
          <span className={report.overallGrade === "PASS" ? styles.ok : styles.warn}>
            {report.overallGrade} · {report.overallScore}/100
          </span>
        )}
      </header>

      <SnapshotNotice meta={meta} />

      {!report ? (
        <p className={styles.warn}>Unable to load readiness.</p>
      ) : (
        <>
          <section className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.kicker}>LIVE TRADING READY</span>
              <strong className={report.liveTradingReady ? styles.ok : styles.warn}>
                {report.liveTradingReady ? "YES" : "NO"}
              </strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Impossible PnL</span>
              <strong className={report.impossiblePnlCount === 0 ? styles.ok : styles.warn}>
                {report.impossiblePnlCount}
              </strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Paper</span>
              <strong>{report.paperProgressLabel}</strong>
            </div>
          </section>

          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Blockers</h2>
          <ul>
            {report.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
