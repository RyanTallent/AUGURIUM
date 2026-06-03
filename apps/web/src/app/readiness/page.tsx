import Link from "next/link";
import { computeLiveTradingReadiness } from "@augurium/database";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
  let report: Awaited<ReturnType<typeof computeLiveTradingReadiness>> | null = null;
  try {
    report = await computeLiveTradingReadiness();
  } catch {
    report = null;
  }

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
              <span className={styles.kicker}>Payout audit</span>
              <strong className={report.shadowPayoutAuditPass ? styles.ok : styles.warn}>
                {report.shadowPayoutAuditPass ? "PASS" : "FAIL"}
              </strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Impossible PnL</span>
              <strong className={report.impossiblePnlCount === 0 ? styles.ok : styles.warn}>
                {report.impossiblePnlCount}
              </strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Invalid rows</span>
              <strong>{report.invalidForAnalyticsCount}</strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Paper</span>
              <strong>{report.paperProgressLabel}</strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Cleaned avg ROI</span>
              <strong>{(report.cleanedAverageRoi * 100).toFixed(1)}%</strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Median ROI</span>
              <strong>{(report.medianRoi * 100).toFixed(1)}%</strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Duplicate groups</span>
              <strong
                className={report.duplicateActiveGroups === 0 ? styles.ok : styles.warn}
              >
                {report.duplicateActiveGroups}
              </strong>
            </div>
          </section>

          <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Zero ROI breakdown</h2>
          <ul>
            {Object.entries(report.zeroRoiBreakdown)
              .filter(([, n]) => n > 0)
              .map(([cat, n]) => (
                <li key={cat}>
                  {cat}: {n}
                </li>
              ))}
          </ul>

          {report.blockers.length > 0 && (
            <>
              <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Blockers</h2>
              <ul>
                {report.blockers.map((b) => (
                  <li key={b} className={styles.warn}>
                    {b}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Sections</h2>
          <div className={styles.grid}>
            {report.sections.map((s) => (
              <div key={s.name} className={styles.card}>
                <span className={styles.kicker}>{s.name}</span>
                <strong className={s.grade === "PASS" ? styles.ok : styles.warn}>
                  {s.grade}
                </strong>
                <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{s.summary}</p>
              </div>
            ))}
          </div>

          <p style={{ marginTop: "2rem", fontSize: "0.8rem" }}>
            <Link href="/shadow/payout-audit">Payout audit</Link> ·{" "}
            <Link href="/shadow/analytics">Analytics</Link>
          </p>
        </>
      )}
    </main>
  );
}
