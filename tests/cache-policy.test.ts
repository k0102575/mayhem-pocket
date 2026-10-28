import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseDetail,
  creditState,
  keyId,
  sanitizeSettings,
  stamp,
  assertVersion,
} from "../server/cache-policy";
const envelope = (version: string, extra: any = {}) => ({
  meta: { dataVersion: version },
  data: { builds: [], ...extra },
});
test("new full is not displaced by old raw; old builds remain labeled with newer augments", () => {
  const full = envelope("16.21.4", { builds: [{ label: "new build" }] });
  assert.equal(chooseDetail(full, envelope("16.21.3")), full);
  const result = chooseDetail(
    envelope("16.21.3", { builds: [{ label: "old build" }] }),
    envelope("16.21.4", { augments: [{ id: 1 }], rawOnly: true }),
  );
  assert.equal(result.meta.dataVersion, "16.21.4");
  assert.equal(result.buildMeta.dataVersion, "16.21.3");
  assert.equal(result.buildStale, true);
  assert.equal(result.data.builds.length, 1);
  assert.equal(
    chooseDetail(envelope("16.21.9"), envelope("16.21.10")).meta.dataVersion,
    "16.21.10",
  );
});
test("quota from another key or UTC day cannot block current credentials", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const rec = {
    keyId: keyId("old"),
    day: "2026-10-28",
    remaining: 0,
    checkedAt: now.toISOString(),
  };
  assert.equal(creditState(rec, "new", now).remaining, 200);
  assert.equal(creditState(rec, "old", now).remaining, 0);
  assert.equal(
    creditState(rec, "old", new Date("2026-10-29T00:00:00Z")).estimated,
    true,
  );
});
test("download time is distinct from upstream generated time; versions must match", () => {
  const x = stamp(
    { meta: { generatedAt: "2026-10-27T00:00:00Z" } },
    new Date("2026-10-28T00:00:00Z"),
  );
  assert.equal(x.cache.downloadedAt, "2026-10-28T00:00:00.000Z");
  assert.equal(x.meta.generatedAt, "2026-10-27T00:00:00Z");
  assert.throws(() => assertVersion(envelope("new"), "old"));
});
test("server-side preferences validate identifiers and enum values", () => {
  const x = sanitizeSettings({
    favorites: [8, 8, -1, "bad"],
    recent: [8],
    champion: 8,
    tab: "evil",
  });
  assert.deepEqual(x.favorites, [8]);
  assert.equal(x.tab, "augments");
  assert.equal(x.champion, 8);
});
