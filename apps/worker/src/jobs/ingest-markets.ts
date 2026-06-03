import { prisma } from "@augurium/database";

const POLYMARKET_API =
  process.env.POLYMARKET_API_BASE ?? "https://gamma-api.polymarket.com";

interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  endDate?: string;
  active?: boolean;
}

export async function ingestPolymarketMarkets(): Promise<number> {
  const run = await prisma.ingestionRun.create({
    data: { source: "polymarket", status: "running" },
  });

  try {
    const res = await fetch(`${POLYMARKET_API}/events?limit=20&active=true`);
    if (!res.ok) throw new Error(`Polymarket API ${res.status}`);

    const events = (await res.json()) as PolymarketEvent[];
    let count = 0;

    for (const event of events) {
      await prisma.market.upsert({
        where: { externalId: event.id },
        create: {
          externalId: event.id,
          source: "polymarket",
          title: event.title,
          slug: event.slug,
          endDate: event.endDate ? new Date(event.endDate) : null,
          active: event.active ?? true,
        },
        update: {
          title: event.title,
          slug: event.slug,
          endDate: event.endDate ? new Date(event.endDate) : null,
          active: event.active ?? true,
        },
      });
      count++;
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "success", itemCount: count, finishedAt: new Date() },
    });

    console.log(`[ingest] synced ${count} markets`);
    return count;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    throw err;
  }
}
