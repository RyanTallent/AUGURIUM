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
            <Link href="/">AUGURIUM</Link> / Live trading readiness
          </p>
          <h1>Readiness report</h1>
          <p className={styles.hint}>Proof-oriented gates — live trading stays OFF until blockers clear</p>
        </div>
        {report && (
          <span className={report.overallGrade === "PASS" ? styles.ok : styles.warn}>
            {report.overallGrade} · {report.overallScore}/100
          </span>
        )}
      </header>

      {!report ? (
        <p className={styles.warn}>Unable to load readiness report.</p>
      ) : (
        <>
          <section className={styles.grid}>
            <div className={styles.card}>
              <span className={styles.kicker}>LIVE TRADING READY</span>
              <strong className={report.liveTradingReady ? styles.ok : styles.warn}>
                {report.liveTradingReady ? "YES" : "NO"}
              </strong>
              <p className={styles.hint} style={{ marginTop: "0.5rem" }}>
                Gates {report.liveTradingReady ? "cleared" : "blocked"} — EXECUTION_ENABLED stays off
              </p>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Paper validation</span>
              <strong>{report.paperProgressLabel}</strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>ROI anomalies</span>
              <strong className={report.roiAnomalyCount > 0 ? styles.warn : styles.ok}>
                {report.roiAnomalyCount}
              </strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Duplicate shadow groups</span>
              <strong
                className={report.duplicateActiveGroups > 0 ? styles.warn : styles.ok}
              >
                {report.duplicateActiveGroups}
              </strong>
            </div>
            <div className={styles.card}>
              <span className={styles.kicker}>Shadow analytics</span>
              <strong className={report.shadowAnalyticsTrustworthy ? styles.ok : styles.warn}>
                {report.shadowAnalyticsTrustworthy ? "Trustworthy" : "Corrupted"}
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

          {report.warnings.length > 0 && (
            <>
              <h2 style={{ fontSize: "1rem", marginTop: "1.5rem" }}>Warnings</h2>
              <ul>
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}

          <h2 style={{ fontSize: "1rem", marginTop: "2rem" }}>Sections</h2>
          <div className={styles.grid}>
            {report.sections.map((s) => (
              <div key={s.name} className={styles.card}>
                <span className={styles.kicker}>{s.name}</span>
                <strong className={s.grade === "PASS" ? styles.ok : styles.warn}>{s.grade}</strong>
                <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{s.summary}</p>
              </div>
            ))}
          </div>

          <p style={{ marginTop: "2rem", fontSize: "0.8rem", opacity: 0.7 }}>
            <Link href="/shadow/analytics">Shadow analytics</Link> ·{" "}
            <Link href="/shadow/anomalies">Anomalies</Link> ·{" "}
            <Link href="/signals/validation">Signal validation</Link>
          </p>
        </>
      )}
    </main>
  );
}
