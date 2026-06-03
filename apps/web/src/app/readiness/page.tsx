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
          <p className={styles.hint}>
            Proof-oriented gates — live trading stays OFF until blockers clear
          </p>
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
          <p className={styles.hint}>
            Live trading allowed:{" "}
            <strong className={report.liveTradingAllowed ? styles.ok : styles.warn}>
              {report.liveTradingAllowed ? "YES (gates only — still disabled in env)" : "NO"}
            </strong>
          </p>

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
                <strong className={s.grade === "PASS" ? styles.ok : styles.warn}>{s.grade}</strong>
                <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{s.summary}</p>
              </div>
            ))}
          </div>

          <p style={{ marginTop: "2rem", fontSize: "0.8rem", opacity: 0.7 }}>
            See also:{" "}
            <Link href="/shadow/analytics">shadow analytics</Link>,{" "}
            <Link href="/signals/validation">signal validation</Link>,{" "}
            <Link href="/health">production health</Link>
          </p>
        </>
      )}
    </main>
  );
}
