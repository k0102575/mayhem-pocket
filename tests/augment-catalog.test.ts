import { test } from "node:test";
import assert from "node:assert/strict";
import { augmentCatalogView } from "../server/augment-catalog";
import { encyclopediaAugments } from "../src/ui-model";

test("encyclopedia exposes descriptions and provider recommendations without unrelated statistics", () => {
  const result = augmentCatalogView({
    meta: { dataVersion: "16.21" },
    data: [
      null,
      {
        id: 1,
        name: "탱크 엔진",
        rarityName: "gold",
        description: "능력",
        stats: { winRate: 90 },
        topChampions: [
          { id: 8, name: "블라디미르", stats: { winRate: 95 } },
          { id: 8, name: "블라디미르" },
          { id: -1 },
        ],
      },
    ],
  });
  assert.equal(result.version, "16.21");
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].description, "능력");
  assert.deepEqual(result.data[0].topChampions, [
    { id: 8, name: "블라디미르", iconUrl: null },
  ]);
  assert.equal("stats" in result.data[0], false);
  assert.deepEqual(augmentCatalogView(null).data, []);
});

test("encyclopedia combines initial search and rarity without mutating cached metadata", () => {
  const all = [
    { id: 1, name: "탱크 엔진", rarityName: "gold" },
    { id: 2, name: "탱크", rarityName: "silver" },
    { id: 3, name: "가속", rarityName: "gold" },
  ];
  const copy = structuredClone(all);
  assert.deepEqual(
    encyclopediaAugments(all, "ㅌㅋㅇㅈ", "gold").map((a) => a.id),
    [1],
  );
  assert.deepEqual(
    encyclopediaAugments(all, "탱크", "silver").map((a) => a.id),
    [2],
  );
  assert.deepEqual(encyclopediaAugments(all, "없는 증강"), []);
  assert.deepEqual(
    encyclopediaAugments(all).map((a) => a.id),
    [3, 2, 1],
  );
  assert.deepEqual(all, copy);
});
