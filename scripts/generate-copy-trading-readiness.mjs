import { writeCopyTradingReadinessReport } from "@augurium/copy-trading";

const report = await writeCopyTradingReadinessReport();
console.log("FINAL_COPY_TRADING_READINESS_REPORT.md written");
console.log(`PAPER TRADING READY = ${report.paperTradingReady ? "YES" : "NO"}`);
console.log(`LIVE TRADING READY = ${report.liveTradingReady ? "YES" : "NO"}`);
