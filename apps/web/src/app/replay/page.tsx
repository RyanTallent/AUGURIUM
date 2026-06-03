import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function ReplayPage({
  searchParams,
}: {
  searchParams: Promise<{ signal?: string }>;
}) {
  const { signal: signalId } = await searchParams;

  const snapshots = await prisma.replaySnapshot.findMany({
    orderBy: { capturedAt: "desc" },
    take: signalId ? 5 : 20,
    where: signalId ? { signalId } : undefined,
    include: {
      signal: {
        select: {
          id: true,
          signalType: true,
          side: true,
          reasoning: true,
          consensusScore: true,
          alphaScore: true,
          triggerTraderWallets: true,
          market: { select: { title: true, category: true } },
        },
      },
    },
  });

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Replay
          </p>
          <h1>Signal replay</h1>
          <p className={styles.hint}>Why a signal existed — scores, traders, market context</p>
        </div>
        <span className={styles.ok}>{snapshots.length} snapshots</span>
      </header>

      {snapshots.length === 0 ? (
        <p className={styles.hint}>No replay snapshots. Run shadow portfolio sync after signals.</p>
      ) : (
        snapshots.map((snap) => {
          const payload = snap.payload as Record<string, unknown>;
          const scores = (payload.scores ?? {}) as Record<string, number>;
          const traders = (payload.triggerTraders ?? []) as { address?: string }[];
          const trades = (payload.recentTrades ?? []) as { side?: string; price?: number }[];

          return (
            <article
              key={snap.id}
              className={styles.card}
              style={{ marginBottom: "1.25rem" }}
            >
              <h2>{snap.signal.market.title}</h2>
              <p className={styles.hint}>
                {snap.signal.signalType} · {snap.signal.side} ·{" "}
                {new Date(snap.capturedAt).toLocaleString()}
              </p>
              <p style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>{snap.signal.reasoning}</p>

              <div className={styles.grid} style={{ marginTop: "1rem" }}>
                <div>
                  <h2>Consensus</h2>
                  <p className={styles.metric}>{scores.consensusScore?.toFixed(0) ?? "—"}</p>
                </div>
                <div>
                  <h2>Alpha</h2>
                  <p className={styles.metric}>{scores.alphaScore?.toFixed(0) ?? "—"}</p>
                </div>
                <div>
                  <h2>Quality</h2>
                  <p className={styles.metric}>{scores.marketQualityScore?.toFixed(0) ?? "—"}</p>
                </div>
                <div>
                  <h2>Confidence</h2>
                  <p className={styles.metric}>{scores.systemConfidenceScore?.toFixed(0) ?? "—"}</p>
                </div>
              </div>

              <section className={styles.modules} style={{ marginTop: "1rem" }}>
                <h2>Trigger traders</h2>
                <ul>
                  {(traders.length ? traders : snap.signal.triggerTraderWallets.map((a) => ({ address: a }))).map(
                    (t, i) => (
                      <li key={i}>
                        {t.address && (
                          <Link href={`/traders/${t.address}`}>{t.address}</Link>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </section>

              {trades.length > 0 && (
                <section className={styles.modules}>
                  <h2>Recent market trades (snapshot)</h2>
                  <ul>
                    {trades.slice(0, 8).map((t, i) => (
                      <li key={i}>
                        {t.side} @ {t.price?.toFixed(3)}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </article>
          );
        })
      )}
    </main>
  );
}
