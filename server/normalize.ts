export function validRate(s: any): number | null {
  const r = s?.winRate;
  if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r > 1)
    return null;
  if (
    typeof s.games === "number" &&
    s.games > 0 &&
    typeof s.wins === "number" &&
    Math.abs(s.wins / s.games - r) > 0.00015
  )
    return null;
  return r;
}
export function rawDetail(raw: any, champion: any, augments: any[]) {
  const row = raw?.[0];
  if (!Array.isArray(row) || typeof row[1] !== "string")
    throw Error("원시 통계 형식이 변경되었습니다.");
  const stats = JSON.parse(row[1]);
  const base = new Map(augments.map((a) => [String(a.id), a]));
  const list = stats.augments;
  if (!list || typeof list !== "object") throw Error("증강 통계 형식 오류");
  const num = (x: any) => (x == null || x === "" ? null : Number(x));
  return {
    champion,
    augments: Object.entries(list).map(([id, v]: any) => ({
      ...base.get(id),
      id: Number(id),
      stats: {
        rank: num(v.rank),
        tier: num(v.tier),
        winRate: num(v.win_rate),
        pickRate: num(v.pick_rate),
        wins: num(v.num_win_games),
        games: num(v.num_games),
        winRateRegion: v.win_rate_region,
        source: stats.source,
      },
    })),
    augmentTrios: [],
    builds: [],
    rawOnly: true,
  };
}
