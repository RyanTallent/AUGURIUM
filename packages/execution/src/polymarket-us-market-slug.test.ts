import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { usMarketTitlesMatch } from "./polymarket-us-market-slug.js";

describe("usMarketTitlesMatch", () => {
  it("accepts exact CS titles", () => {
    const title = "Counter-Strike: M80 vs B8 (BO3) - IEM Cologne Major Stage 1";
    assert.equal(usMarketTitlesMatch(title, title), true);
  });

  it("rejects CS expected vs MLB actual", () => {
    assert.equal(
      usMarketTitlesMatch(
        "Counter-Strike: M80 vs B8 (BO3) - IEM Cologne Major Stage 1",
        "MLB: Athletics vs Rockies -1.5",
      ),
      false,
    );
  });

  it("rejects partial substring matches across sports", () => {
    assert.equal(
      usMarketTitlesMatch(
        "Dota 2: Team Falcons vs Team Liquid (BO3) - BLAST Slam Playoffs",
        "MLB: Colorado Rockies -1.5",
      ),
      false,
    );
  });
});
