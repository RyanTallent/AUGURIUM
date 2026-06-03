import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const { runPortfolioEngineJob } = await import(
    "../apps/worker/src/jobs/run-portfolio-engine.ts"
  );
  const summary = await runPortfolioEngineJob();
  console.log("[portfolio:run]", summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
