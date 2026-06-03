#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeLiveTradingReadiness } = require("../packages/database/dist/readiness-report.js");

async function main() {
  const report = await computeLiveTradingReadiness();
  console.log("=== Live trading readiness ===");
  console.log(`Overall: ${report.overallGrade} (${report.overallScore}/100)`);
  console.log(`Live allowed (gates): ${report.liveTradingAllowed}`);
  for (const s of report.sections) {
    console.log(`  ${s.name}: ${s.grade} — ${s.summary}`);
  }
  if (report.blockers.length) {
    console.log("Blockers:");
    for (const b of report.blockers) console.log(`  - ${b}`);
  }
  if (report.overallGrade === "FAIL") process.exit(1);
  console.log("OK: readiness report generated");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
