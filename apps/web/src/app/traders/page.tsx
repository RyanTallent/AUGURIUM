import Link from "next/link";
import { prisma } from "@augurium/database";
import styles from "../page.module.css";
import traderStyles from "./traders.module.css";

export const dynamic = "force-dynamic";

function fmtPct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
}

function shortWallet(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default async function TradersPage() {
  let traders: Awaited<ReturnType<typeof loadTraders>> = [];
  let dbOk = true;
  try {
    traders = await loadTraders();
  } catch {
    dbOk = false;
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <Link href="/">AUGURIUM</Link> / Traders
          </p>
          <h1>Trader rankings</h1>
          <p className={traderStyles.subtitle}>
            Ranked by copyability and estimated copied ROI — not raw ROI alone.
          </p>
        </div>
        <span className={dbOk ? styles.ok : styles.warn}>
          {dbOk ? `${traders.length} scored` : "DB offline"}
        </span>
      </header>

      <section className={traderStyles.tableWrap}>
        <table className={traderStyles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Wallet</th>
              <th>Tier</th>
              <th>Rank</th>
              <th>Copy</th>
              <th>Copied ROI</th>
              <th>Edge</th>
              <th>Conf.</th>
              <th>Trades</th>
              <th>Volume</th>
              <th>Category</th>
              <th>30d form</th>
            </tr>
          </thead>
          <tbody>
            {traders.length === 0 ? (
              <tr>
                <td colSpan={12} className={traderStyles.empty}>
                  No scored traders yet. Run the score-traders job after Phase A
                  ingestion.
                </td>
              </tr>
            ) : (
              traders.map((t, i) => (
                <tr key={t.id}>
                  <td>{i + 1}</td>
                  <td>
                    <Link href={`/traders/${t.address}`} className={traderStyles.wallet}>
                      {shortWallet(t.address)}
                    </Link>
                    {t.lowConfidence && (
                      <span className={traderStyles.lowConf} title="Low sample confidence">
                        low n
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`${traderStyles.tier} ${traderStyles[`tier_${t.tier}`] ?? ""}`}>
                      {t.tier}
                    </span>
                  </td>
                  <td>{t.rankingScore.toFixed(1)}</td>
                  <td>{(t.copyabilityScore * 100).toFixed(0)}</td>
                  <td>{fmtPct(t.estimatedCopiedRoi)}</td>
                  <td>{(t.informationEdgeScore * 100).toFixed(0)}</td>
                  <td title={t.confidenceReason ?? undefined}>
                    {(t.confidenceScore * 100).toFixed(0)}
                  </td>
                  <td>{t.trades}</td>
                  <td>${t.totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td title={t.rankingReason ?? undefined}>
                    {t.specialistLabel ?? t.bestCategory ?? "—"}
                  </td>
                  <td>{fmtPct(t.roi30d)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

async function loadTraders() {
  const rows = await prisma.trader.findMany({
    where: { lastScoredAt: { not: null }, rankingScore: { gt: 0 } },
    orderBy: { rankingScore: "desc" },
    take: 100,
        include: {
      metricsSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        select: {
          totalVolume: true,
          roi30d: true,
          confidenceReason: true,
          rankingReason: true,
          specialistCategory: true,
        },
      },
    },
  });

  return rows.map((t) => ({
    id: t.id,
    address: t.address,
    tier: t.tier,
    rankingScore: t.rankingScore,
    copyabilityScore: t.copyabilityScore,
    estimatedCopiedRoi: t.estimatedCopiedRoi,
    informationEdgeScore: t.informationEdgeScore,
    confidenceScore: t.confidenceScore,
    recentFormScore: t.recentFormScore,
    trades: t.trades,
    bestCategory: t.bestCategory,
    specialistLabel: t.metricsSnapshots[0]?.specialistCategory
      ? `${t.metricsSnapshots[0].specialistCategory} Specialist`
      : null,
    confidenceReason: t.metricsSnapshots[0]?.confidenceReason ?? null,
    rankingReason: t.metricsSnapshots[0]?.rankingReason ?? null,
    lowConfidence: t.lowConfidence,
    totalVolume: t.metricsSnapshots[0]?.totalVolume ?? 0,
    roi30d: t.metricsSnapshots[0]?.roi30d ?? 0,
  }));
}
