import { createHash } from "node:crypto";
export function keyId(key: string) {
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}
export function creditState(record: any, key: string, now = new Date()) {
  const known =
    record?.keyId === keyId(key) &&
    record?.day === now.toISOString().slice(0, 10);
  return {
    remaining: known ? record.remaining : 200,
    estimated: !known,
    checkedAt: known ? (record.checkedAt ?? null) : null,
  };
}
export function versionCompare(a: string = "", b: string = "") {
  return a.localeCompare(b, undefined, { numeric: true });
}
export function chooseDetail(full: any, raw: any) {
  if (!full && !raw) return { missing: true };
  const chosen = !full
    ? raw
    : !raw
      ? full
      : versionCompare(full.meta?.dataVersion, raw.meta?.dataVersion) >= 0
        ? full
        : raw;
  if (chosen === raw && full?.data?.builds?.length)
    return {
      ...raw,
      data: { ...raw.data, builds: full.data.builds },
      buildMeta: full.meta,
      buildCache: full.cache,
      buildStale: full.meta?.dataVersion !== raw.meta?.dataVersion,
    };
  return chosen;
}
export function stamp(envelope: any, now = new Date()) {
  return { ...envelope, cache: { downloadedAt: now.toISOString() } };
}
export function assertVersion(value: any, target: string) {
  if (value?.meta?.dataVersion !== target)
    throw Error(
      "수집 중 데이터 버전이 변경되었습니다. 기존 캐시는 유지되며 다시 갱신할 수 있습니다.",
    );
}
export function sanitizeSettings(v: any) {
  const ids = (x: any) =>
    Array.isArray(x)
      ? [...new Set(x.filter((n: any) => Number.isInteger(n) && n > 0))].slice(
          0,
          200,
        )
      : [];
  return {
    champion:
      Number.isInteger(v?.champion) && v.champion > 0 ? v.champion : null,
    tab: v?.tab === "builds" ? "builds" : "augments",
    favorites: ids(v?.favorites),
    recent: ids(v?.recent).slice(0, 8),
    rarity: ["all", "silver", "gold", "prismatic"].includes(v?.rarity)
      ? v.rarity
      : "all",
    sort: v?.sort === "winRate" ? "winRate" : "rank",
    buildSort: v?.buildSort === "winRate" ? "winRate" : "pickRate",
  };
}
