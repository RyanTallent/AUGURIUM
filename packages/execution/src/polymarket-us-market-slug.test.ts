import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { usMarketTitlesMatch } from "./polymarket-us-market-slug.js";

describe("usMarketTitlesMatch", () => {
  it("accepts exact CS titles", () => {
    const title = "Counter-Strike: M80 vs B8 (BO3) - IEM Cologne Major Stage 1";
    assert.equal(usMarketTitlesMatch(title, title), true);
  });

  it("accepts global esports title vs US boilerplate moneyline title", () => {
    assert.equal(
      usMarketTitlesMatch(
        "Valorant: G2 Esports vs XLG Gaming (BO3) - VCT Masters London Playoffs",
        "Who will win in the upcoming esports event G2 Esports vs XLG Gaming scheduled for June 13, 2026 at 5:00 PM UTC?",
      ),
      true,
    );
    assert.equal(
      usMarketTitlesMatch(
        "Valorant: Global Esports vs FULL SENSE (BO3) - VCT Masters London Group Stage",
        "Who will win in the upcoming esports event Global Esports vs FULL SENSE scheduled for June 9, 2026 at 5:00 PM UTC?",
      ),
      true,
    );
    assert.equal(
      usMarketTitlesMatch(
        "Dota 2: Team Falcons vs Team Liquid (BO3) - BLAST Slam Playoffs",
        "Who will win in the upcoming esports event Team Falcons vs Team Liquid scheduled for June 4, 2026 at 12:30 PM UTC?",
      ),
      true,
    );
  });

  it("accepts reversed team order between global and US titles", () => {
    assert.equal(
      usMarketTitlesMatch(
        "Dota 2: Team Liquid vs Team Falcons (BO3) - PGL Wallachia Playoffs",
        "Who will win in the upcoming esports event Team Falcons vs Team Liquid scheduled for June 4, 2026 at 12:30 PM UTC?",
      ),
      true,
    );
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
