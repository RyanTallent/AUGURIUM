import Link from "next/link";
import { computeShadowPayoutAudit } from "@augurium/database";
import styles from "../../page.module.css";
import tableStyles from "../../traders/traders.module.css";

export const dynamic = "force-dynamic";

function pct(roi: number) {
  return `${(roi * 100).toFixed(1)}%`;
}

export default async function ShadowPayoutAuditPage() {
  let audit: Awaited<ReturnType<typeof computeShadowPayoutAudit>> | null = null;
  try {
    audit = await computeShadowPayoutAudit(80);
  } catch {
    audit = null;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/shadow/analytics">Analytics</Link> / Payout audit
          </p>
          <h1>Shadow payout audit</h1>
          <p className={styles.hint}>Share-based formulas; invalid rows excluded from analytics</p>
        </div>
        {audit && (
          <span
            className={
              audit.impossiblePnlCount === 0 ? styles.ok : styles.warn
            }
          >
            {audit.impossiblePnlCount === 0 ? "PASS" : "FAIL"}
          </span>
        )}
      </header>

      {audit && (
        <>
          <section className={styles.grid}>
            <Metric label="Closed sample" value={String(audit.totalClosed)} />
            <Metric label="Invalid" value={String(audit.invalidCount)} warn />
            <Metric label="Impossible PnL" value={String(audit.impossiblePnlCount)} warn />
            <Metric label="ROI &gt; 100%" value={String(audit.roiGt100)} />
            <Metric label="ROI &gt; 500%" value={String(audit.roiGt500)} />
            <Metric label="ROI &gt; 1000%" value={String(audit.roiGt1000)} />
          </section>

          <div className={tableStyles.tableWrap}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>PnL</th>
                  <th>ROI</th>
                  <th>Formula</th>
                  <th>Close</th>
                  <th>Diagnostic</th>
                </tr>
              </thead>
              <tbody>
                {audit.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.marketTitle.slice(0, 36)}</td>
                    <td>{r.side}</td>
                    <td>{r.entryPrice.toFixed(4)}</td>
                    <td>{r.exitPrice.toFixed(4)}</td>
                    <td>${r.realizedPnl.toFixed(2)}</td>
                    <td>{pct(r.roi)}</td>
                    <td>{r.formulaUsed}</td>
                    <td>{r.closeReason.slice(0, 24)}</td>
                    <td>{r.diagnostic ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
