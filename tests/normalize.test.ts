import { test } from "node:test";
import assert from "node:assert/strict";
import { validRate } from "../server/normalize";
test("invalid and mismatched upstream rates are hidden", () => {
  assert.equal(validRate({ winRate: -0.05 }), null);
  assert.equal(validRate({ winRate: 0.8, wins: 50, games: 100 }), null);
  assert.equal(validRate({ winRate: 0.4766 }), 0.4766);
  assert.equal(validRate({ winRate: 0.3333, wins: 1, games: 3 }), 0.3333);
  assert.equal(validRate({ winRate: null }), null);
});
test("raw tuple joins augment metadata and preserves missing values", async () => {
  const { rawDetail } = await import("../server/normalize");
  const d = rawDetail(
    [
      [
        "8",
        JSON.stringify({
          augments: {
            "1001": {
              rank: "1",
              win_rate: "0.5",
              num_games: "10",
              num_win_games: "5",
            },
          },
        }),
        null,
        "date",
      ],
    ],
    { id: 8 },
    [{ id: 1001, name: "테스트" }],
  );
  assert.equal(d.augments[0].name, "테스트");
  assert.equal(d.augments[0].stats.games, 10);
  assert.equal(validRate(d.augments[0].stats), 0.5);
  assert.equal(d.rawOnly, true);
});
