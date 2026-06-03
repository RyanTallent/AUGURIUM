import Link from "next/link";
import { APP_NAME } from "@augurium/shared";
import { computeCopyBoard, computeAcceptanceForensics } from "@augurium/copy-trading";
import { computeCopyTradingReadiness } from "@augurium/copy-trading";
import { getProductionWarnings } from "../lib/ops-status";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

function shortWallet(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default async function HomePage() {
  let board: Awaited<ReturnType<typeof computeCopyBoard>> | null = null;
  let readiness: Awaited<ReturnType<typeof computeCopyTradingReadiness>> | null = null;
  let acceptance: Awaited<ReturnType<typeof computeAcceptanceForensics>> | null = null;
  let warnings = { messages: [] as string[] };

  try {
    [board, readiness, acceptance, warnings] = await Promise.all([
      computeCopyBoard(40),
      computeCopyTradingReadiness(),
      computeAcceptanceForensics(),
      getProductionWarnings(),
    ]);
  } catch {
    board = null;
  }

  const bestStrategy = board?.strategies.find((s) => s.traderCount > 0);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Trader copy & risk platform</p>
          <h1>{APP_NAME}</h1>
          <p className={styles.hint}>Primary question: who should we copy today?</p>
        </div>
        {readiness && (
          <span className={readiness.paperTradingReady ? styles.ok : styles.warn}>
            Paper: {readiness.paperTradingReady ? "READY" : "NOT READY"}
          </span>
        )}
      </header>

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>
            <Link href="/copy">COPY today</Link>
          </h2>
          <p className={styles.metric}>{board?.topTradersToday.length ?? "—"}</p>
          <p className={styles.hint}>Traders meeting copy gates</p>
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
          <p className={styles.hint}>Open positions from COPY traders</p>
        </article>
        <article className={styles.card}>
          <h2>
            <Link href="/copy-portfolios">Copy portfolio</Link>
          </h2>
          <p className={styles.metricSmall}>
            {bestStrategy ? bestStrategy.label : "—"}
          </p>
          <p className={styles.hint}>
            {bestStrategy
              ? `Est. 30d ${(bestStrategy.roi30d * 100).toFixed(1)}% · ${bestStrategy.traderCount} traders`
              : "Run scoring + copy board"}
          </p>
        </article>
        <article className={styles.card}>
          <h2>Portfolio ACCEPT</h2>
          <p className={styles.metric}>{acceptance?.accepted ?? "—"}</p>
          <p className={styles.hint}>
            <Link href="/copy-portfolios">forensics</Link> — thresholds unchanged
          </p>
        </article>
      </section>

      {board && board.topTradersToday.length > 0 && (
        <section className={styles.modules}>
          <h2>Best traders to copy</h2>
          <ol>
            {board.topTradersToday.slice(0, 5).map((t) => (
              <li key={t.address}>
                <Link href={`/traders/${t.address}`}>{shortWallet(t.address)}</Link> — score{" "}
                {t.copyScore.toFixed(1)} · risk {t.riskScore} · ${t.suggestedUsdAt10k} @ $10k
              </li>
            ))}
          </ol>
          <p className={styles.hint}>
            <Link href="/copy">Full copy dashboard →</Link>
          </p>
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
          <p className={styles.hint}>
            <Link href="/maintenance">maintenance</Link> · <Link href="/readiness">readiness</Link>
          </p>
        </section>
      )}

      {warnings.messages.length > 0 && (
        <section className={styles.modules}>
          <h2>Ops warnings</h2>
          <ul>
            {warnings.messages.map((m) => (
              <li key={m} className={styles.warn}>
                {m}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.modules}>
        <h2>Supporting systems</h2>
        <ul>
          <li>
            <a href="/traders">Trader truth</a> · <a href="/shadow">Shadow trust</a> ·{" "}
            <a href="/portfolio">Portfolio</a> · <a href="/execution">Execution (paper gated)</a>
          </li>
        </ul>
      </section>
    </main>
  );
}
