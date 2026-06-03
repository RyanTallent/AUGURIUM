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

  const zeroRoiPct = closed ? (zeroRoi / closed) * 100 : 0;
  const zeroMfePct = closed ? (zeroMfe / (await prisma.shadowTrade.count())) * 100 : 0;

  console.log("=== Shadow portfolio audit ===");
  console.log(`Closed/expired: ${closed}`);
  console.log(`Zero ROI (closed): ${zeroRoi} (${zeroRoiPct.toFixed(1)}%)`);
  console.log(`Zero MFE (all): ${zeroMfe} (${zeroMfePct.toFixed(1)}%)`);
  console.log(`Open with STALE price: ${staleOpen}`);

  const ok = zeroRoiPct < 60;
  if (!ok) {
    console.error("FAIL: >60% closed shadows show 0% ROI — pricing or entry timing likely broken");
    process.exit(1);
  }
  console.log("PASS: zero-ROI rate within audit threshold (post-fix expectation)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
