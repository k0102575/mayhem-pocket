import { test } from "node:test";
import assert from "node:assert/strict";
import {
  championTiers,
  matches,
  summaryAugments,
  summaryCoreBuilds,
  secondarySummaryBuilds,
} from "../src/ui-model";

test("champion search ignores whitespace while retaining initials and aliases", () => {
  for (const query of [
    "탐켄",
    "탐 켄",
    "탐켄치",
    "탐 켄치",
    "ㅌㅋ",
    " ㅌ ㅋ ",
    "",
  ]) {
    assert.equal(matches("탐 켄치", query), true, query);
  }
  assert.equal(matches("TahmKench", "tahm ken"), true);
  assert.equal(matches("블라디미르", "탐켄"), false);
});

test("overview ranks ten augments independently and preserves input data", () => {
  const augments = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    stats: { rank: 12 - i },
  }));
  const copy = structuredClone(augments);
  const summary = summaryAugments(augments);
  assert.deepEqual(
    summary.map((a) => a.stats.rank),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(augments, copy);
  assert.deepEqual(summaryAugments(), []);
  assert.equal(summaryAugments(augments.slice(0, 2)).length, 2);
});

test("overview shows three core build routes without truncating their items", () => {
  const items = [1, 2, 3, 4].map((id) => ({ id, name: String(id) }));
  const routes = [1, 2, 3, 4].map((id) => ({
    items: items.map((item) => ({ ...item, id: id * 10 + item.id })),
  }));
  const builds = [
    { stats: { pickRate: 0.2 }, coreItems: [{ items: [{ id: 99 }] }] },
    {
      stats: { pickRate: 0.8 },
      coreItems: routes,
      situationalItems: [{ id: 88 }],
    },
  ];
  const copy = structuredClone(builds);
  assert.deepEqual(summaryCoreBuilds(builds), routes.slice(0, 3));
  assert.equal(summaryCoreBuilds(builds)[0].items.length, 4);
  assert.deepEqual(builds, copy);
  assert.deepEqual(summaryCoreBuilds(), []);
  assert.deepEqual(summaryCoreBuilds([{ coreItems: [] }]), []);
  assert.deepEqual(
    summaryCoreBuilds([{ coreItems: [{ items: [] }, routes[0]] }]),
    [routes[0]],
  );
  assert.equal(
    summaryCoreBuilds([{ coreItems: routes.slice(0, 2) }]).length,
    2,
  );
});

test("champion tiers follow full-catalog percentile boundaries and exclude invalid rates", () => {
  const champions = Array.from({ length: 100 }, (_, id) => ({
    id,
    stats: { winRate: (100 - id) / 100 },
  }));
  const before = structuredClone(champions);
  const tiers = championTiers([
    ...champions,
    { id: 101, stats: { winRate: -1 } },
    { id: 102, stats: { winRate: NaN } },
    { id: 103, stats: { winRate: 0.9, games: 10, wins: 1 } },
  ]);
  for (const [id, expected] of [
    [0, "S"],
    [9, "S"],
    [10, "A"],
    [29, "A"],
    [30, "B"],
    [69, "B"],
    [70, "C"],
    [89, "C"],
    [90, "D"],
    [99, "D"],
  ] as const)
    assert.equal(tiers.get(id)?.tier, expected);
  assert.equal(tiers.size, 100);
  assert.equal(tiers.get(99)?.total, 100);
  assert.deepEqual(champions, before);
  // Searching uses the same full-catalog map rather than recalculating the rank.
  assert.equal(
    tiers.get(champions.filter((c) => c.id === 99)[0].id)?.tier,
    "D",
  );
  assert.equal(championTiers([]).size, 0);
});
test("equal win rates share the higher rank even at tier boundaries", () => {
  const champions = Array.from({ length: 10 }, (_, id) => ({
    id,
    stats: { winRate: id < 2 ? 0.9 : 0.8 - id * 0.01 },
  }));
  const tiers = championTiers(champions);
  assert.deepEqual(tiers.get(0), tiers.get(1));
  assert.equal(tiers.get(1)?.tier, "S");
  assert.equal(tiers.get(1)?.rank, 1);
  assert.equal(
    championTiers([{ id: 1, stats: { winRate: 0.5 } }]).get(1)?.tier,
    "S",
  );
});

test("secondary overview shows only first routes of second and third most-used builds", () => {
  const build = (pickRate: number, id: number) => ({
    stats: { pickRate },
    coreItems: [{ items: [{ id }] }, { items: [{ id: id + 100 }] }],
  });
  const builds = [
    build(0.1, 30),
    build(0.6, 10),
    build(0.2, 20),
    build(0.01, 40),
  ];
  const copy = structuredClone(builds);
  const result = secondarySummaryBuilds(builds);
  assert.deepEqual(
    result.map((row) => ({
      rank: row.rank,
      ids: row.items.map((item: any) => item.id),
    })),
    [
      { rank: 2, ids: [20] },
      { rank: 3, ids: [30] },
    ],
  );
  assert.deepEqual(builds, copy);
  assert.deepEqual(secondarySummaryBuilds([]), []);
  assert.deepEqual(secondarySummaryBuilds([builds[0]]), []);
  assert.equal(
    secondarySummaryBuilds([builds[1], { stats: { pickRate: 0.3 } }])[0].items
      .length,
    0,
  );
});
