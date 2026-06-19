import { runScoreTradersJob } from "./score-traders.js";

/** Score traders using US-sourced trade history (wraps score-traders batch). */
export async function runUsWalletScoringJob(): Promise<{ scored: number }> {
  const result = await runScoreTradersJob();
  console.log(`[us-wallet-scoring] scored=${result.scored} remaining=${result.remaining}`);
  return { scored: result.scored };
}
