import { validRate } from "../server/normalize";
const initials = (value: string) =>
  [...value]
    .map((character) => {
      const offset = character.charCodeAt(0) - 44032;
      return offset >= 0 && offset <= 11171
        ? "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor(offset / 588)]
        : character;
    })
    .join("");
const compoundConsonants: Record<string, string> = {
  ㄳ: "ㄱㅅ",
  ㄵ: "ㄴㅈ",
  ㄶ: "ㄴㅎ",
  ㄺ: "ㄹㄱ",
  ㄻ: "ㄹㅁ",
  ㄼ: "ㄹㅂ",
  ㄽ: "ㄹㅅ",
  ㄾ: "ㄹㅌ",
  ㄿ: "ㄹㅍ",
  ㅀ: "ㄹㅎ",
  ㅄ: "ㅂㅅ",
};
const normalizeSearch = (value: string) =>
  value
    .normalize("NFC")
    .replace(/\s+/gu, "")
    .replace(
      /[ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ]/gu,
      (character) => compoundConsonants[character],
    )
    .toLowerCase();
export function matches(value: string, query: string) {
  const source = normalizeSearch(value);
  const search = normalizeSearch(query);
  return source.includes(search) || initials(source).includes(search);
}
export function summaryAugments(augments: any[] = []) {
  return [...augments]
    .sort((a, b) => (a.stats?.rank ?? Infinity) - (b.stats?.rank ?? Infinity))
    .slice(0, 10);
}
function rankedBuilds(builds: any[] = []) {
  return [...builds].sort(
    (a, b) => (b.stats?.pickRate ?? -1) - (a.stats?.pickRate ?? -1),
  );
}
export function summaryBuild(builds: any[] = []) {
  return rankedBuilds(builds)[0];
}
export function secondarySummaryBuilds(builds: any[] = []) {
  return rankedBuilds(builds)
    .slice(1, 3)
    .map((build, index) => ({
      build,
      rank: index + 2,
      items: build.coreItems?.[0]?.items ?? [],
    }));
}
export function summaryCoreBuilds(builds: any[] = []) {
  return (summaryBuild(builds)?.coreItems ?? [])
    .filter((row: any) => Array.isArray(row.items) && row.items.length > 0)
    .slice(0, 3);
}

export type ChampionTier = "S" | "A" | "B" | "C" | "D";
export function championTiers(champions: any[]) {
  const ranked = champions
    .map((champion) => ({ id: champion.id, rate: validRate(champion.stats) }))
    .filter(
      (champion): champion is { id: number; rate: number } =>
        champion.rate !== null,
    )
    .sort((a, b) => b.rate - a.rate);
  const result = new Map<
    number,
    { tier: ChampionTier; rank: number; total: number }
  >();
  let rank = 0;
  ranked.forEach((champion, index) => {
    if (index === 0 || champion.rate !== ranked[index - 1].rate) rank = index;
    const fraction = rank / ranked.length;
    const tier =
      fraction < 0.1
        ? "S"
        : fraction < 0.3
          ? "A"
          : fraction < 0.7
            ? "B"
            : fraction < 0.9
              ? "C"
              : "D";
    result.set(champion.id, { tier, rank: rank + 1, total: ranked.length });
  });
  return result;
}

// IDs cover the boots present in cached API builds; names also handle provider variants.
const bootIds = new Set([
  1001, 3005, 3006, 3008, 3009, 3010, 3020, 3047, 3111, 3117, 3158,
]);
export function isBoot(item: any) {
  return (
    bootIds.has(Number(item?.id)) ||
    /신발|장화|군화|발걸음|boots|greaves|treads|sorcerer.s shoes/i.test(
      item?.name ?? "",
    )
  );
}
export function separateBuildBoots(build: any) {
  const boots = new Map<string, any>();
  const keepItems = (items: any[] = []) =>
    items.filter((item) => {
      if (!isBoot(item)) return true;
      const key = String(item.id ?? item.name);
      if (!boots.has(key)) boots.set(key, item);
      return false;
    });
  for (const row of build.coreItems ?? []) keepItems(row.items);
  const situationalItems = keepItems(build.situationalItems);
  const seen = new Map<string, any>();
  const coreItems = (build.coreItems ?? []).flatMap((row: any) => {
    const items = keepItems(row.items);
    if (!items.length) return [];
    const missing = Math.max(0, 3 - items.length);
    const originalIds = (row.itemIds ?? row.items.map((item: any) => item.id))
      .map(String)
      .sort();
    const extensions = missing
      ? (build.itemExtensions ?? [])
          .filter((extension: any) => {
            const ids = (extension.coreItemIds ?? []).map(String).sort();
            return (
              JSON.stringify(ids) === JSON.stringify(originalIds) &&
              extension.step === 1
            );
          })
          .sort((a: any, b: any) => (b.games ?? 0) - (a.games ?? 0))
      : [];
    const candidates = extensions.length
      ? extensions.map((extension: any) => ({
          ...row,
          ...extension,
          items: [
            ...items,
            ...keepItems(extension.items)
              .filter(
                (item: any) =>
                  !items.some(
                    (core: any) => String(core.id) === String(item.id),
                  ),
              )
              .slice(0, missing),
          ],
          routeSource: "연결된 후속 조합",
        }))
      : [
          {
            ...row,
            items: [
              ...items,
              ...situationalItems
                .filter(
                  (item: any) =>
                    !items.some(
                      (core: any) => String(core.id) === String(item.id),
                    ),
                )
                .sort(
                  (a: any, b: any) => (b.pickRate ?? -1) - (a.pickRate ?? -1),
                )
                .slice(0, missing),
            ],
            ...(missing
              ? {
                  games: null,
                  wins: null,
                  winRate: null,
                  routeSource: "빌드 유형 후속 추천",
                }
              : { routeSource: "원본 조합" }),
          },
        ];
    return candidates.flatMap((candidate: any) => {
      const key = JSON.stringify(
        candidate.items.map((item: any) => item.id ?? item.name),
      );
      const source = {
        coreItemIds: [...originalIds],
        addedItemIds: candidate.items
          .filter((item: any) => !originalIds.includes(String(item.id)))
          .map((item: any) => String(item.id)),
      };
      const existing = seen.get(key);
      if (existing) {
        existing.routeSources.push(source);
        return [];
      }
      const route = {
        ...candidate,
        itemIds: candidate.items.map((item: any) => item.id),
        routeSources: [source],
      };
      seen.set(key, route);
      return [route];
    });
  });
  const displayedItemIds = new Set(
    coreItems
      .slice(0, 3)
      .flatMap((row: any) =>
        row.items.map((item: any) => String(item.id ?? item.name)),
      ),
  );
  return {
    ...build,
    coreItems,
    situationalItems: situationalItems.filter(
      (item: any) => !displayedItemIds.has(String(item.id ?? item.name)),
    ),
    boots: [...boots.values()],
  };
}
export function commonBuildBoots(builds: any[] = []) {
  const boots = new Map<string, any>();
  for (const build of rankedBuilds(builds)) {
    for (const item of build.boots ?? []) {
      const key = String(item.id ?? item.name);
      if (!boots.has(key)) boots.set(key, item);
    }
  }
  return [...boots.values()];
}

// Match the original core (including boots), then the already displayed extension prefix.
// Do not mix unrelated routes or treat later extension items as the next purchase.
export function routeFollowUpItems(build: any, route: any) {
  const selectedIds = new Set(
    (route?.items ?? []).map((item: any) => String(item.id)),
  );
  const candidates: { item: any; step: number; games: number }[] = [];
  for (const source of route?.routeSources ?? []) {
    for (const extension of build.itemExtensions ?? []) {
      const coreIds = (extension.coreItemIds ?? []).map(String).sort();
      if (JSON.stringify(coreIds) !== JSON.stringify(source.coreItemIds))
        continue;
      const items = (extension.items ?? []).filter(
        (item: any) => !isBoot(item),
      );
      const prefix = source.addedItemIds;
      if (
        items.length <= prefix.length ||
        !prefix.every((id: string, i: number) => String(items[i]?.id) === id)
      )
        continue;
      const next = items[prefix.length];
      if (!next || selectedIds.has(String(next.id))) continue;
      candidates.push({
        item: next,
        step: items.length,
        games: typeof extension.games === "number" ? extension.games : -1,
      });
    }
  }
  candidates.sort((a, b) => a.step - b.step || b.games - a.games);
  const unique = new Map<string, any>();
  for (const candidate of candidates) {
    if (!unique.has(String(candidate.item.id)))
      unique.set(String(candidate.item.id), candidate.item);
  }
  return [...unique.values()];
}

export function encyclopediaAugments(
  augments: any[] = [],
  query = "",
  rarity = "all",
) {
  return augments
    .filter(
      (augment) =>
        (rarity === "all" || augment.rarityName === rarity) &&
        matches(augment.name ?? String(augment.id), query),
    )
    .sort((a, b) =>
      (a.name ?? String(a.id)).localeCompare(b.name ?? String(b.id), "ko"),
    );
}
