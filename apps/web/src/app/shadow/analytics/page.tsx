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
          <p className={styles.hint}>
            Trustworthy metrics use realizedPnl ÷ notional; outliers (&gt;100% ROI) excluded from headline averages
          </p>
        </div>
        {report && (
          <span className={report.analyticsTrustworthy ? styles.ok : styles.warn}>
            {report.analyticsTrustworthy ? "Trustworthy" : "Corrupted"}
          </span>
        )}
      </header>

      {!report ? (
        <p className={styles.warn}>Unable to load analytics.</p>
      ) : (
        <>
          <section className={styles.grid}>
            <Metric label="Sample" value={String(report.sampleSize)} />
            <Metric label="Win rate" value={pct(report.winRate)} />
            <Metric label="Loss rate" value={pct(report.lossRate)} />
            <Metric label="Breakeven" value={pct(report.breakevenRate)} />
            <Metric label="Avg ROI (trustworthy)" value={pct(report.averageRoi)} />
            <Metric label="Avg ROI (raw diagnostic)" value={pct(report.averageRoiRaw)} warn />
            <Metric label="Median ROI" value={pct(report.medianRoi)} />
            <Metric label="Profit factor" value={report.profitFactor.toFixed(2)} />
            <Metric label="ROI anomalies" value={String(report.corruptRoiCount)} warn />
            <Metric label="Zero ROI" value={pct(report.zeroRoiClosedPct)} warn />
            <Metric label="Forensics" value={report.forensicsDiagnosis} />
          </section>

          <h2 style={{ marginTop: "2rem", fontSize: "1rem" }}>Zero ROI breakdown</h2>
          <ul>
            {Object.entries(report.zeroRoiBreakdown.byCategory)
              .filter(([, n]) => n > 0)
              .map(([cat, n]) => (
                <li key={cat}>
                  {cat}: {n}
                </li>
              ))}
          </ul>

          <p style={{ marginTop: "1.5rem" }}>
            <Link href="/shadow/anomalies">View anomalies & forensic rows →</Link>
          </p>
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
