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
const normalizeSearch = (value: string) =>
  value.normalize("NFC").replace(/\s+/gu, "").toLowerCase();
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
