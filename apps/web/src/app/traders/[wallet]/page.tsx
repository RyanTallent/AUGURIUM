import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@augurium/database";
import styles from "../../page.module.css";
import traderStyles from "../traders.module.css";

export const dynamic = "force-dynamic";

function fmtPct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

export default async function TraderDetailPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = await params;
  const address = decodeURIComponent(wallet).toLowerCase();

  const trader = await prisma.trader.findUnique({
    where: { address },
    include: {
      metricsSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        include: { categoryMetrics: { orderBy: { specialistScore: "desc" } } },
      },
      scoreHistory: { orderBy: { capturedAt: "desc" }, take: 12 },
      tierHistory: { orderBy: { capturedAt: "desc" }, take: 8 },
      tradeRows: {
        orderBy: { tradedAt: "desc" },
        take: 15,
        include: { market: { select: { title: true, category: true } } },
      },
      positions: {
        where: { status: "open" },
        take: 10,
        include: { market: { select: { title: true } } },
      },
    },
  });

  if (!trader) notFound();

  const snap = trader.metricsSnapshots[0];

  return (
    <main className={styles.main}>
      <Link href="/traders" className={traderStyles.back}>
        ← All traders
      </Link>

      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Trader detail</p>
          <h1 className={traderStyles.wallet}>{trader.address}</h1>
          <p className={traderStyles.subtitle}>
            <span className={`${traderStyles.tier} ${traderStyles[`tier_${trader.tier}`] ?? ""}`}>
              {trader.tier}
            </span>
            {trader.lowConfidence && " · low confidence (small sample)"}
          </p>
        </div>
        <span className={styles.ok}>Rank {trader.rankingScore.toFixed(1)}</span>
      </header>

      <section className={traderStyles.detailGrid}>
        <article className={styles.card}>
          <h2>Copyability</h2>
          <p className={styles.metric}>{(trader.copyabilityScore * 100).toFixed(0)}</p>
        </article>
        <article className={styles.card}>
          <h2>Copied ROI (est.)</h2>
          <p className={styles.metric}>{fmtPct(trader.estimatedCopiedRoi)}</p>
        </article>
        <article className={styles.card}>
          <h2>Information edge</h2>
          <p className={styles.metric}>{(trader.informationEdgeScore * 100).toFixed(0)}</p>
        </article>
        <article className={styles.card}>
          <h2>Confidence</h2>
          <p className={styles.metric}>{(trader.confidenceScore * 100).toFixed(0)}</p>
        </article>
        <article className={styles.card}>
          <h2>Raw ROI</h2>
          <p className={styles.metric}>{fmtPct(trader.roi)}</p>
          <p className={styles.hint}>Shown for reference — not ranking driver</p>
        </article>
        <article className={styles.card}>
          <h2>Trades</h2>
          <p className={styles.metric}>{trader.trades}</p>
        </article>
      </section>

      {snap && (
        <section className={traderStyles.section}>
          <h2>Latest snapshot</h2>
          <div className={traderStyles.detailGrid}>
            <article className={styles.card}>
              <h2>Win rate</h2>
              <p className={styles.metric}>{fmtPct(snap.winRate)}</p>
            </article>
            <article className={styles.card}>
              <h2>Profit factor</h2>
              <p className={styles.metric}>{snap.profitFactor.toFixed(2)}</p>
            </article>
            <article className={styles.card}>
              <h2>Max drawdown</h2>
              <p className={styles.metric}>${snap.maxDrawdown.toFixed(0)}</p>
            </article>
            <article className={styles.card}>
              <h2>Volume (30d)</h2>
              <p className={styles.metric}>${snap.volume30d.toLocaleString()}</p>
            </article>
            <article className={styles.card}>
              <h2>ROI 7d / 30d / 90d</h2>
              <p className={styles.metricSmall}>
                {fmtPct(snap.roi7d)} / {fmtPct(snap.roi30d)} / {fmtPct(snap.roi90d)}
              </p>
            </article>
            <article className={styles.card}>
              <h2>Best category</h2>
              <p className={styles.metricSmall}>{snap.bestCategory ?? "—"}</p>
            </article>
          </div>
        </section>
      )}

      {snap && snap.categoryMetrics.length > 0 && (
        <section className={traderStyles.section}>
          <h2>Category breakdown</h2>
          <ul className={traderStyles.catList}>
            {snap.categoryMetrics.map((c) => (
              <li key={c.id}>
                <span>
                  {c.category} ({c.tradeCount} trades)
                </span>
                <span>
                  ROI {fmtPct(c.roi)} · WR {fmtPct(c.winRate)} · spec{" "}
                  {(c.specialistScore * 100).toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trader.scoreHistory.length > 0 && (
        <section className={traderStyles.section}>
          <h2>Score history</h2>
          <ul className={traderStyles.catList}>
            {trader.scoreHistory.map((h) => (
              <li key={h.id}>
                <span>{new Date(h.capturedAt).toLocaleString()}</span>
                <span>
                  rank {h.rankingScore.toFixed(1)} · copy {fmtPct(h.estimatedCopiedRoi)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={traderStyles.section}>
        <h2>Recent trades</h2>
        <ul className={traderStyles.catList}>
          {trader.tradeRows.map((t) => (
            <li key={t.id}>
              <span>
                {t.side} {t.size} @ {t.price.toFixed(3)} — {t.market?.title ?? t.conditionId}
              </span>
              <span>{new Date(t.tradedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>

      {trader.positions.length > 0 && (
        <section className={traderStyles.section}>
          <h2>Open positions</h2>
          <ul className={traderStyles.catList}>
            {trader.positions.map((p) => (
              <li key={p.id}>
                <span>
                  {p.side} {p.size} @ {p.avgPrice.toFixed(3)} — {p.market.title}
                </span>
                <span>PnL ${p.pnl.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
