import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
async function launch(
  files: Record<string, any>,
  responses: Record<string, any[]>,
  existingRoot?: string,
) {
  const root =
    existingRoot ?? (await mkdtemp(path.join(tmpdir(), "pocket-sync-")));
  for (const [p, d] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, "cache", p)), { recursive: true });
    await writeFile(path.join(root, "cache", p), JSON.stringify(d));
  }
  const mock = path.join(root, "mock.mjs");
  await writeFile(
    mock,
    `const responses=${JSON.stringify(responses)};const seen={};globalThis.fetch=async(url)=>{const name=String(url).split('/ko/')[1];const list=responses[name];if(!list)throw Error('Unexpected upstream '+name);const i=seen[name]??0;seen[name]=i+1;const item=list[Math.min(i,list.length-1)];return new Response(JSON.stringify(item.body??item),{status:item.status??200,headers:item.headers??{}})};`,
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
      "--import",
      pathToFileURL(mock).href,
      path.resolve("server/index.ts"),
    ],
    {
      cwd: root,
      env: { ...process.env, ARAMGG_API_KEY: "test-only-key", PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (x) => (log += x));
  child.stderr.on("data", (x) => (log += x));
  let base = "";
  for (let i = 0; i < 100; i++) {
    base = log.match(/http:\/\/127.0.0.1:\d+/)?.[0] ?? "";
    if (base) break;
    if (child.exitCode !== null) throw Error(log);
    await new Promise((r) => setTimeout(r, 40));
  }
  if (!base) {
    child.kill();
    throw Error(log || "startup timeout");
  }
  const status = await (await fetch(base + "/api/status")).json();
  const request = async (p: string, body: any = {}) => {
    const r = await fetch(base + p, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-token": status.token,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  return {
    root,
    base,
    request,
    close: async () => {
      try {
        await request("/api/shutdown");
      } catch {}
      await new Promise<void>((r) => {
        child.once("exit", () => r());
        setTimeout(() => {
          child.kill();
          r();
        }, 2000).unref();
      });
      await rm(root, { recursive: true, force: true });
    },
  };
}
const catalog = (v: string) => ({
  meta: { dataVersion: v },
  data: [{ id: 8, name: "블라디미르" }],
});
const raw = (v: string) => ({
  meta: { dataVersion: v },
  data: { augments: [], builds: [], rawOnly: true },
});
const payload = [
  [
    "8",
    JSON.stringify({
      augments: {
        "1": {
          rank: "1",
          win_rate: "0.5",
          num_games: "10",
          num_win_games: "5",
        },
      },
    }),
    null,
    "2026-10-28",
  ],
];
async function job(app: any) {
  for (let i = 0; i < 160; i++) {
    const s = await (await fetch(app.base + "/api/status")).json();
    if (!s.job.running) return s.job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("job timeout");
}
test("same-version catalog avoids paid request; preferences survive a different server port", async () => {
  const a = await launch(
    { "catalog.json": catalog("v2") },
    { "config.json": [{ dataVersion: "v2" }] },
  );
  try {
    assert.equal((await a.request("/api/catalog")).body.downloaded, false);
    await a.request("/api/settings", { champion: 8, favorites: [8] });
    const settings = JSON.parse(
      await readFile(path.join(a.root, "cache/settings.json"), "utf8"),
    );
    assert.deepEqual(settings.favorites, [8]);
    const second = await launch(
      {},
      { "config.json": [{ dataVersion: "v2" }] },
      a.root,
    );
    try {
      assert.notEqual(second.base, a.base);
      const loaded = await (await fetch(second.base + "/api/settings")).json();
      assert.deepEqual(loaded.favorites, [8]);
    } finally {
      await second.close();
    }
  } finally {
    await a.close();
  }
});
test("sync refreshes stale catalog and stores only verified new version", async () => {
  const a = await launch(
    { "catalog.json": catalog("v1"), "raw-details/8.json": raw("v1") },
    {
      "config.json": [{ dataVersion: "v2" }],
      "champions.json": [catalog("v2")],
      "augments.json": [
        { meta: { dataVersion: "v2" }, data: [{ id: 1, name: "증강" }] },
      ],
      "data/champion-augments/8.json": [payload],
    },
  );
  try {
    await a.request("/api/sync");
    assert.equal((await job(a)).message, "전체 증강 캐시 완료");
    const d = JSON.parse(
      await readFile(path.join(a.root, "cache/raw-details/8.json"), "utf8"),
    );
    assert.equal(d.meta.dataVersion, "v2");
    assert.ok(d.cache.downloadedAt);
    assert.equal(d.data.augments[0].name, "증강");
  } finally {
    await a.close();
  }
});
test("mid-sync version change and 429 preserve previous usable cache", async () => {
  for (const mode of ["change", "quota"]) {
    const a = await launch(
      {
        "catalog.json": catalog("v2"),
        "augments.json": { meta: { dataVersion: "v2" }, data: [{ id: 1 }] },
        "raw-details/8.json": raw("v1"),
      },
      {
        "config.json": [{ dataVersion: "v2" }, { dataVersion: "v3" }],
        "data/champion-augments/8.json":
          mode === "change"
            ? [payload]
            : [{ status: 429, body: { error: "quota" } }],
      },
    );
    try {
      await a.request("/api/sync");
      const j = await job(a);
      assert.match(j.message, mode === "change" ? /버전이 변경/ : /제한/);
      const d = JSON.parse(
        await readFile(path.join(a.root, "cache/raw-details/8.json"), "utf8"),
      );
      assert.equal(d.meta.dataVersion, "v1");
    } finally {
      await a.close();
    }
  }
});
test("full same-version detail skips raw cost and interruption can resume", async () => {
  const full = {
    meta: { dataVersion: "v2" },
    data: { champion: { id: 8 }, augments: [], builds: [{ patch: "v2" }] },
  };
  const a = await launch(
    { "catalog.json": catalog("v2"), "details/8.json": full },
    { "config.json": [{ dataVersion: "v2" }] },
  );
  try {
    assert.equal((await a.request("/api/sync/plan")).body.cost, 0);
    await a.request("/api/sync");
    assert.equal((await job(a)).message, "전체 증강 캐시 완료");
    assert.equal(
      (await a.request("/api/champions/8/download")).body.reused,
      true,
    );
  } finally {
    await a.close();
  }
  const b = await launch(
    {
      "catalog.json": catalog("v2"),
      "augments.json": { meta: { dataVersion: "v2" }, data: [{ id: 1 }] },
    },
    {
      "config.json": [{ dataVersion: "v2" }],
      "data/champion-augments/8.json": [payload],
    },
  );
  try {
    await b.request("/api/sync");
    await b.request("/api/cancel");
    assert.match((await job(b)).message, /중단/);
    await b.request("/api/sync");
    assert.equal((await job(b)).message, "전체 증강 캐시 완료");
  } finally {
    await b.close();
  }
});
