import { polymarketScanFetch } from "../lib/polymarket-scan.js";

const wallets = [
  "0x89dd49bf87c41be422927372a0b75c6ab577f662",
  "0x3b21433b0407e45d683cad1fcb6ba0a6b33ba230",
  "0x7923d4ff806b231b3276592391de5d0953356c0b",
];

for (const w of wallets) {
  console.log("\n===", w, "===");
  const pnl = await polymarketScanFetch("wallet_pnl", { wallet: w });
  console.log("pnl", JSON.stringify(pnl.data, null, 2));
  const trades = await polymarketScanFetch("wallet_trades", { wallet: w, limit: 60 });
  const titles = [...new Set((trades.data ?? []).map((t) => t.market_question))];
  console.log("unique markets", titles.length, titles.slice(0, 6));
}
