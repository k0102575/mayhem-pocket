import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commonBuildBoots,
  separateBuildBoots,
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

test("champion and augment initials accept IME-combined consonants", () => {
  for (const query of ["ㅂㄹㅅ", "ㅂㄽ", " ㅂ ㄽ "]) {
    assert.equal(matches("바루스", query), true, query);
  }
  // Cover every compound consonant with syllables whose initials match it.
  for (const [text, combined] of [
    ["가사", "ㄳ"],
    ["나자", "ㄵ"],
    ["나하", "ㄶ"],
    ["라가", "ㄺ"],
    ["라마", "ㄻ"],
    ["라바", "ㄼ"],
    ["라사", "ㄽ"],
    ["라타", "ㄾ"],
    ["라파", "ㄿ"],
    ["라하", "ㅀ"],
    ["바사", "ㅄ"],
  ]) {
    assert.equal(matches(text, combined), true, combined);
  }
  assert.equal(matches("신비한 주먹", "ㅅㅂㅎㅈㅁ"), true);
  assert.equal(matches("마법사", "ㅁㅄ"), true);
  assert.equal(matches("바루스", "ㅂㄻ"), false);
  assert.equal(matches("탐 켄치", "ㅌㅋㅊ"), true);
  assert.equal(matches("바루스", "바루"), true);
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

test("boots are separated from routes and follow-up items without changing source statistics", () => {
  const core = { id: 4633, name: "균열 생성기" };
  const next = { id: 4629, name: "우주의 추진력" };
  const shoes = { id: 3020, name: "마법사의 신발" };
  const boots = { id: 3158, name: "명석함의 아이오니아 장화" };
  const build = {
    coreItems: [
      { items: [core, shoes, next], games: 100, winRate: 0.5 },
      { items: [core, boots, next], games: 30, winRate: 0.6 },
      { items: [shoes], games: 1 },
      { items: [next, core], games: 20 },
    ],
    situationalItems: [shoes, { id: 3111, name: "헤르메스의 발걸음" }, next],
  };
  const original = structuredClone(build);
  const result = separateBuildBoots(build);
  assert.deepEqual(
    result.boots.map((item: any) => item.id),
    [3020, 3158, 3111],
  );
  assert.deepEqual(
    result.coreItems.map((row: any) => row.itemIds),
    [
      [4633, 4629],
      [4629, 4633],
    ],
  );
  assert.equal(result.coreItems[0].games, null);
  assert.equal(result.coreItems[0].winRate, null);
  assert.deepEqual(result.situationalItems, []);
  assert.deepEqual(build, original);
  assert.deepEqual(separateBuildBoots({}).boots, []);
  assert.deepEqual(
    separateBuildBoots({
      coreItems: [{ items: [{ id: 99999, name: "새로운 장화" }, core] }],
    }).boots.map((item: any) => item.id),
    [99999],
  );
});

test("core routes use only matching extensions and common boots are unique", () => {
  const item = (id: number) => ({ id, name: String(id) });
  const build = {
    coreItems: [
      {
        itemIds: [4633, 3020, 4629],
        items: [item(4633), item(3020), item(4629)],
        games: 100,
      },
    ],
    itemExtensions: [
      {
        coreItemIds: [3020, 4633, 4629],
        step: 1,
        items: [item(3065)],
        games: 50,
        wins: 25,
        winRate: 0.5,
      },
      {
        coreItemIds: [3020, 4633, 4629],
        step: 1,
        items: [item(3089)],
        games: 20,
      },
      {
        coreItemIds: [3020, 3152, 4629],
        step: 1,
        items: [item(999)],
        games: 999,
      },
    ],
    situationalItems: [{ ...item(3157), pickRate: 0.9 }],
  };
  const copy = structuredClone(build);
  const result = separateBuildBoots(build);
  assert.deepEqual(
    result.coreItems.map((row: any) => row.itemIds),
    [
      [4633, 4629, 3065],
      [4633, 4629, 3089],
    ],
  );
  assert.equal(result.coreItems[0].games, 50);
  assert.equal(result.coreItems[0].winRate, 0.5);
  assert.deepEqual(build, copy);
  const fallback = separateBuildBoots({ ...build, itemExtensions: [] });
  assert.deepEqual(fallback.coreItems[0].itemIds, [4633, 4629, 3157]);
  assert.equal(fallback.coreItems[0].winRate, null);
  assert.deepEqual(
    commonBuildBoots([result, fallback]).map((boot: any) => boot.id),
    [3020],
  );
});

test("follow-up items exclude all three displayed routes but keep items from hidden routes", () => {
  const item = (id: number | string) => ({ id, name: String(id) });
  const build = {
    coreItems: [
      { items: [item(1), item(2), item(3)] },
      { items: [item(4), item(5), item(6)] },
      { items: [item(7), item(8), item(9)] },
      { items: [item(10), item(11), item(12)] },
    ],
    situationalItems: [item("1"), item(5), item(9), item(10), item(13)],
  };
  const original = structuredClone(build);
  assert.deepEqual(
    separateBuildBoots(build).situationalItems.map((x: any) => x.id),
    [10, 13],
  );
  assert.deepEqual(build, original);
  const other = separateBuildBoots({
    coreItems: [{ items: [item(20), item(21), item(22)] }],
    situationalItems: [item(1)],
  });
  assert.deepEqual(
    other.situationalItems.map((x: any) => x.id),
    [1],
  );
  assert.deepEqual(
    separateBuildBoots({ situationalItems: [item(13)] }).situationalItems,
    [item(13)],
  );
});
