import Link from "next/link";
import {
  computeShadowRoiForensics,
  listShadowForensicRows,
} from "@augurium/database";
import styles from "../../page.module.css";
import tableStyles from "../../traders/traders.module.css";

export const dynamic = "force-dynamic";

function pct(roi: number) {
  return `${(roi * 100).toFixed(1)}%`;
}

export default async function ShadowAnomaliesPage() {
  let forensics: Awaited<ReturnType<typeof computeShadowRoiForensics>> | null = null;
  let top: Awaited<ReturnType<typeof listShadowForensicRows>> = [];
  let bottom: typeof top = [];
  let zero: typeof top = [];
  let suspicious: typeof top = [];

  try {
    [forensics, top, bottom, zero, suspicious] = await Promise.all([
      computeShadowRoiForensics(),
      listShadowForensicRows({ filter: "top", limit: 15 }),
      listShadowForensicRows({ filter: "bottom", limit: 15 }),
      listShadowForensicRows({ filter: "zero", limit: 15 }),
      listShadowForensicRows({ filter: "anomaly", limit: 15 }),
    ]);
  } catch {
    forensics = null;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/shadow/analytics">Analytics</Link> / Anomalies
          </p>
          <h1>Shadow ROI forensics</h1>
          <p className={styles.hint}>Per-trade authoritative ROI = realizedPnl ÷ cost basis</p>
        </div>
      </header>

      {forensics && (
        <p className={styles.hint}>
          Diagnosis: <strong>{forensics.diagnosis}</strong> · {forensics.corruptTradeCount} anomalies ·{" "}
          {forensics.engineMismatchCount} stored-vs-PnL mismatches
        </p>
      )}

      <ForensicTable title="Top ROI (suspicious if extreme)" rows={top} />
      <ForensicTable title="Suspicious (anomaly tiers)" rows={suspicious} />
      <ForensicTable title="Bottom ROI" rows={bottom} />
      <ForensicTable title="Zero ROI sample" rows={zero} />
    </main>
  );
}

function ForensicTable({
  title,
  rows,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listShadowForensicRows>>;
}) {
  if (rows.length === 0) return null;
  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>{title}</h2>
      <div className={tableStyles.tableWrap}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th>Type</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Basis</th>
              <th>PnL</th>
              <th>ROI</th>
              <th>Close</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td title={r.marketId}>{r.marketTitle.slice(0, 40)}</td>
                <td>{r.side}</td>
                <td>{r.signalType}</td>
                <td>{r.entryPrice.toFixed(3)}</td>
                <td>{r.exitPrice.toFixed(3)}</td>
                <td>${r.costBasis.toFixed(0)}</td>
                <td>${r.realizedPnl.toFixed(2)}</td>
                <td style={r.anomalyTier ? { color: "var(--negative)" } : undefined}>
                  {pct(r.authoritativeRoi)}
                  {r.roiMismatch ? " †" : ""}
                </td>
                <td>{r.closeReason.slice(0, 30)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
