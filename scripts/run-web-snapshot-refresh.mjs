async function main() {
  const { runWebSnapshotRefreshJob } = await import(
    "../apps/worker/src/jobs/run-web-snapshot-refresh.ts"
  );
  const summary = await runWebSnapshotRefreshJob();
  console.log("[web:snapshot-refresh]", summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
