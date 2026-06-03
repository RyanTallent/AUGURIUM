import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const { runExecutionEngineJob } = await import(
    "../apps/worker/src/jobs/run-execution-engine.ts"
  );
  const summary = await runExecutionEngineJob();
  console.log("[execution:run]", summary);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
