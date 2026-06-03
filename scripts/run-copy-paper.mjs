async function main() {
  const { runCopyPaperJob } = await import("../apps/worker/src/jobs/run-copy-paper.ts");
  const summary = await runCopyPaperJob();
  console.log("[copy:paper-sync]", summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
