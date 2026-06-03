import Link from "next/link";
import { computeShadowAnalytics } from "@augurium/database";
import styles from "../../page.module.css";

export const dynamic = "force-dynamic";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function ShadowAnalyticsPage() {
  let report: Awaited<ReturnType<typeof computeShadowAnalytics>> | null = null;
  try {
    report = await computeShadowAnalytics();
  } catch {
    report = null;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/shadow">Shadow</Link> / Analytics
          </p>
          <h1>Shadow portfolio analytics</h1>
          <p className={styles.hint}>Objective performance metrics from closed/expired simulations</p>
        </div>
      </header>

      {!report ? (
        <p className={styles.warn}>Unable to load analytics (database unavailable).</p>
      ) : (
        <>
          <section className={styles.grid}>
            <Metric label="Sample (closed/expired)" value={String(report.sampleSize)} />
            <Metric label="Win rate" value={pct(report.winRate)} />
            <Metric label="Loss rate" value={pct(report.lossRate)} />
            <Metric label="Avg ROI" value={pct(report.averageRoi)} />
            <Metric label="Median ROI" value={pct(report.medianRoi)} />
            <Metric label="Profit factor" value={report.profitFactor.toFixed(2)} />
            <Metric label="Avg hold (h)" value={report.averageHoldHours.toFixed(1)} />
            <Metric label="Max drawdown ($)" value={report.maxDrawdown.toFixed(2)} />
            <Metric label="Sharpe-like" value={report.sharpeLike.toFixed(2)} />
            <Metric label="Zero ROI (closed)" value={pct(report.zeroRoiClosedPct)} warn />
            <Metric label="Zero MFE" value={pct(report.zeroMfePct)} warn />
          </section>

          {report.bestCategory && (
            <p className={styles.hint}>
              Best category: {report.bestCategory.category} ({pct(report.bestCategory.avgRoi)} avg, n=
              {report.bestCategory.count}) · Worst: {report.worstCategory?.category ?? "—"}
            </p>
          )}

          <h2 style={{ marginTop: "2rem", fontSize: "1rem" }}>By signal type</h2>
          <ul>
            {Object.entries(report.bySignalType).map(([type, row]) => (
              <li key={type}>
                {type}: n={row.count}, avg ROI {pct(row.avgRoi)}, win {pct(row.winRate)}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className={styles.card}>
      <span className={styles.kicker}>{label}</span>
      <strong className={warn ? styles.warn : styles.ok}>{value}</strong>
    </div>
  );
}
