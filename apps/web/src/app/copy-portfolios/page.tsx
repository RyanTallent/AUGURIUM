import Link from "next/link";
import { SnapshotNotice } from "../../components/SnapshotNotice";
import { loadCopyPortfoliosData } from "../../lib/page-snapshots";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function CopyPortfoliosPage() {
  const { board, acceptance, meta } = await loadCopyPortfoliosData();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/copy">Copy</Link> / Portfolios
          </p>
          <h1>Copy portfolio simulator</h1>
        </div>
      </header>

      <SnapshotNotice meta={meta} />

      {!board ? (
        <p className={styles.warn}>Unable to load strategies.</p>
      ) : (
        <section className={styles.grid}>
          {board.strategies.map((s) => (
            <article key={s.id} className={styles.card}>
              <h2>{s.label}</h2>
              <p className={styles.metric}>{s.traderCount} traders</p>
              <p className={styles.hint}>
                30d ROI {fmtPct(s.roi30d)} · DD {fmtPct(s.maxDrawdown)} · Sharpe~ {s.sharpeLike}
              </p>
            </article>
          ))}
        </section>
      )}

      {acceptance && (
        <p className={styles.hint} style={{ marginTop: "2rem" }}>
          ACCEPT {acceptance.accepted} · REJECT {acceptance.rejected} · rate{" "}
          {(acceptance.acceptanceRate * 100).toFixed(1)}%
        </p>
      )}
    </main>
  );
}
