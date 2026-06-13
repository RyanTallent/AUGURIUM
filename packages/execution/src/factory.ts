import { getExecutionConfig } from "./config.js";
import { PaperExecutionProvider } from "./paper-provider.js";
import { PolymarketExecutionProvider } from "./polymarket-provider.js";
import { PolymarketUsExecutionProvider } from "./polymarket-us-provider.js";
import { ReplayExecutionProvider } from "./replay-provider.js";
import type { PaperStore } from "./paper-store.js";
import type { ExecutionProvider } from "./types.js";

export function createExecutionProvider(paperStore?: PaperStore): ExecutionProvider {
  const cfg = getExecutionConfig();
  switch (cfg.provider) {
    case "polymarket":
      return new PolymarketExecutionProvider();
    case "polymarket-us":
      return new PolymarketUsExecutionProvider();
    case "replay":
      return new ReplayExecutionProvider();
    case "paper":
    default:
      if (!paperStore) {
        throw new Error("PaperExecutionProvider requires a PaperStore implementation");
      }
      return new PaperExecutionProvider(paperStore);
  }
}
