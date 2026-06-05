async function main() {
  const { runCopyAutoPipelineJob } = await import(
    "../apps/worker/src/jobs/run-copy-auto-pipeline.ts"
  );
  const summary = await runCopyAutoPipelineJob();
  console.log("[copy:auto-pipeline]", summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
