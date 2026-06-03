#!/usr/bin/env node
/**
 * Shadow portfolio audit: ROI/MFE health and pricing diagnostics.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [closed, zeroRoi, zeroMfe, staleOpen] = await Promise.all([
    prisma.shadowTrade.count({ where: { status: { in: ["CLOSED", "EXPIRED"] } } }),
    prisma.shadowTrade.count({
      where: {
        status: { in: ["CLOSED", "EXPIRED"] },
        roi: { gte: -0.0001, lte: 0.0001 },
      },
    }),
    prisma.shadowTrade.count({
      where: {
        maxFavorableExcursion: { gte: -0.0001, lte: 0.0001 },
      },
    }),
    prisma.shadowTrade.count({
      where: { status: "OPEN", priceStatus: "STALE" },
    }),
  ]);

  const zeroAuth = await prisma.shadowTrade.count({
    where: {
      status: { in: ["CLOSED", "EXPIRED"] },
      AND: [
        { realizedPnl: { gte: -0.01, lte: 0.01 } },
      ],
    },
  });

  const all = await prisma.shadowTrade.findMany({
    where: { status: { in: ["CLOSED", "EXPIRED"] } },
    select: { realizedPnl: true, simulatedSizeUsd: true },
  });
  const anomalyCount = all.filter(
    (t) => Math.abs(t.realizedPnl / Math.max(1, t.simulatedSizeUsd)) > 1,
  ).length;

  const zeroRoiPct = closed ? (zeroAuth / closed) * 100 : 0;
  const zeroMfePct = closed ? (zeroMfe / (await prisma.shadowTrade.count())) * 100 : 0;

  console.log("=== Shadow portfolio audit ===");
  console.log(`Closed/expired: ${closed}`);
  console.log(`Zero ROI (closed, |PnL|<$0.01): ${zeroAuth} (${zeroRoiPct.toFixed(1)}%)`);
  console.log(`ROI anomalies (|ROI|>100%): ${anomalyCount}`);
  console.log(`Zero MFE (all): ${zeroMfe} (${zeroMfePct.toFixed(1)}%)`);
  console.log(`Open with STALE price: ${staleOpen}`);

  const anomalyMax = Number(process.env.READINESS_ROI_ANOMALY_MAX ?? "3");
  if (anomalyCount > anomalyMax) {
    console.error(`FAIL: ${anomalyCount} ROI anomalies > ${anomalyMax}`);
    process.exit(1);
  }
  if (zeroRoiPct >= 60) {
    console.warn(`WARN: ${zeroRoiPct.toFixed(0)}% zero ROI — pricing backlog, not necessarily corrupt avg`);
  }
  console.log("PASS: ROI anomaly count within threshold");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
