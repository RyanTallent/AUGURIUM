/**
 * Run on Render worker one-off (or locally with .env):
 *   npx tsx scripts/verify-polymarket-live.mjs
 */
async function main() {
  const { validateClobConnection } = await import(
    "../packages/execution/src/polymarket-clob.ts"
  );
  const { computeLiveCopyReadiness } = await import(
    "../packages/copy-trading/src/live-copy-readiness.ts"
  );
  const ping = await validateClobConnection();
  const readiness = await computeLiveCopyReadiness();
  console.log("[polymarket-live] CLOB:", ping);
  console.log("[polymarket-live] readiness:", {
    ready: readiness.ready,
    blockers: readiness.blockers,
    executionMode: readiness.executionMode,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
