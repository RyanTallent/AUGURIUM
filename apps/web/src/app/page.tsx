import Link from "next/link";
import { APP_NAME } from "@augurium/shared";
import { SnapshotNotice } from "../components/SnapshotNotice";
import { loadHomePageData } from "../lib/page-snapshots";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function shortWallet(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default async function HomePage() {
  const { data, meta } = await loadHomePageData();
  const board = data.board;
  const readiness = data.readiness;
  const bestStrategy = board?.strategies.find((s) => s.traderCount > 0);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Trader copy & risk platform</p>
          <h1>{APP_NAME}</h1>
          <p className={styles.hint}>
            Scan Polymarket → rank best traders → auto-mirror COPY targets on Polymarket US.
          </p>
        </div>
        {readiness && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <span
              className={
                (readiness as { liveCopyReady?: boolean }).liveCopyReady
                  ? styles.ok
                  : styles.warn
              }
            >
              Live copy:{" "}
              {(readiness as { liveCopyReady?: boolean }).liveCopyReady ? "READY" : "NOT READY"}
            </span>
          </div>
        )}
      </header>

      <SnapshotNotice meta={meta} />

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>
            <Link href="/copy">COPY today</Link>
          </h2>
          <p className={styles.metric}>{board?.topTradersToday.length ?? "—"}</p>
        </article>
        <article className={styles.card}>
          <h2>Improving</h2>
          <p className={styles.metric}>{board?.improving.length ?? "—"}</p>
        </article>
        <article className={styles.card}>
          <h2>Deteriorating</h2>
          <p className={styles.metric}>{board?.deteriorating.length ?? "—"}</p>
        </article>
        <article className={styles.card}>
          <h2>Mirror positions</h2>
          <p className={styles.metric}>{board?.copyPositionsToday.length ?? "—"}</p>
        </article>
        <article className={styles.card}>
          <h2>
            <Link href="/copy-portfolios">Copy portfolio</Link>
          </h2>
          <p className={styles.metricSmall}>{bestStrategy ? bestStrategy.label : "—"}</p>
        </article>
        <article className={styles.card}>
          <h2>Portfolio ACCEPT</h2>
          <p className={styles.metric}>{data.acceptance?.accepted ?? "—"}</p>
        </article>
      </section>

      {board && board.topTradersToday.length > 0 && (
        <section className={styles.modules}>
          <h2>Best traders to copy</h2>
          <ol>
            {board.topTradersToday.slice(0, 5).map((t) => (
              <li key={t.address}>
                <Link href={`/traders/${t.address}`}>{shortWallet(t.address)}</Link> — score{" "}
                {t.copyScore.toFixed(1)}
              </li>
            ))}
          </ol>
        </section>
      )}

      {readiness && readiness.remainingBlockers.length > 0 && (
        <section className={styles.modules}>
          <h2>Biggest risks</h2>
          <ul>
            {readiness.remainingBlockers.map((b) => (
              <li key={b} className={styles.warn}>
                {b}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.modules}>
        <h2>Supporting systems</h2>
        <ul>
          <li>
            <a href="/traders">Trader truth</a> · <a href="/shadow">Shadow</a> ·{" "}
            <a href="/maintenance">Maintenance</a>
          </li>
        </ul>
      </section>
    </main>
  );
}
