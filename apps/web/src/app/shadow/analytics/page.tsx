import Link from "next/link";
import { SnapshotNotice } from "../../../components/SnapshotNotice";
import { loadShadowAnalyticsPageData } from "../../../lib/page-snapshots";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function ShadowAnalyticsPage() {
  const { report, meta } = await loadShadowAnalyticsPageData();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/shadow">Shadow</Link> / Analytics
          </p>
          <h1>Shadow portfolio analytics</h1>
        </div>
        {report && (
          <span className={report.analyticsTrustworthy ? styles.ok : styles.warn}>
            {report.analyticsTrustworthy ? "Trustworthy" : "Corrupted"}
          </span>
        )}
      </header>

      <SnapshotNotice meta={meta} />

      {!report ? (
        <p className={styles.warn}>Unable to load analytics.</p>
      ) : (
        <section className={styles.grid}>
          <div className={styles.card}>
            <span className={styles.kicker}>Win rate</span>
            <strong>{pct(report.winRate)}</strong>
          </div>
          <div className={styles.card}>
            <span className={styles.kicker}>Cleaned avg ROI</span>
            <strong>{pct(report.averageRoi)}</strong>
          </div>
          <div className={styles.card}>
            <span className={styles.kicker}>Invalid excluded</span>
            <strong>{report.invalidExcludedCount}</strong>
          </div>
        </section>
      )}
    </main>
  );
}
