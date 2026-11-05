import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, cp, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
if (process.platform !== "win32") throw Error("Windows에서 실행하세요.");
const root = path.resolve("release/CSharp API 새 환경 검증");
const data = path.join(root, "사용자 데이터");
let child, origin, token, fixture;
let version = "16.21.5",
  budget = 200,
  omitCredits = false,
  failResource = null,
  failStatus = 500,
  changeAfter = null,
  malformed = false,
  slow = false;
const seen = [];
const checks = [];
const catalog = () => ({
  meta: { dataVersion: version },
  data: [
    { id: 8, name: "블라디미르" },
    { id: 36, name: "문도 박사" },
  ],
});
const augment = () => ({
  meta: { dataVersion: version },
  data: [
    {
      id: 1,
      name: "테스트 증강",
      description: "설명",
      tooltip: "상세",
      stats: { winRate: 0.5 },
      topChampions: [{ id: 8, name: "블라디미르", stats: { winRate: 0.6 } }],
    },
  ],
});
const raw = () => [
  [
    "8",
    JSON.stringify({
      source: "fixture",
      augments: {
        1: {
          rank: "1",
          tier: "2",
          win_rate: "0.5",
          pick_rate: "0.4",
          num_games: "10",
          num_win_games: "5",
        },
      },
      augment_trios: {
        "1:2:3": {
          win_rate: "0.6",
          num_games: "5",
          num_win_games: "3",
          source: "fixture",
          region: "CN",
          date: "2026-11-05",
          game_patch: "16.21",
        },
      },
    }),
    null,
    "2026-11-05",
  ],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await sleep(50);
  }
  throw Error(label + " 제한 시간 초과");
}
async function post(route, body = {}) {
  const r = await fetch(origin + route, {
    method: "POST",
    headers: {
      Origin: origin,
      "content-type": "application/json",
      "x-session-token": token,
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
const get = async (route) => await (await fetch(origin + route)).json();
async function start() {
  child = spawn(path.join(root, "Mayhem Pocket.exe"), [], {
    cwd: root,
    env: {
      ...process.env,
      MAYHEM_DATA_DIR: data,
      MAYHEM_POCKET_NO_BROWSER: "1",
      ARAMGG_API_KEY: "",
      PORT: "0",
      MAYHEM_TEST_API: `http://127.0.0.1:${fixture.address().port}/api/v1/ko/`,
    },
    stdio: "ignore",
  });
  await until(async () => {
    if (child.exitCode !== null) throw Error("C# 검증 서버 시작 실패");
    try {
      const i = JSON.parse(
        await readFile(path.join(data, "instance.json"), "utf8"),
      );
      origin = `http://127.0.0.1:${i.port}`;
      token = i.token;
      return (await get("/api/status")).token === token;
    } catch {
      return false;
    }
  }, "시작");
}
async function stop() {
  const running = child;
  if (!running || running.exitCode !== null) return;
  assert.equal((await post("/api/shutdown")).status, 200);
  await until(() => running.exitCode !== null, "종료");
  assert.equal(running.exitCode, 0);
  child = null;
}
const paid = () => seen.filter((r) => r.cost > 0).length;
async function job() {
  return await until(
    async () => {
      const s = await get("/api/status");
      return !s.job.running ? s.job : null;
    },
    "전체 수집",
    25000,
  );
}
async function read(file) {
  return JSON.parse(await readFile(path.join(data, file), "utf8"));
}
async function write(file, value) {
  await mkdir(path.dirname(path.join(data, file)), { recursive: true });
  await writeFile(path.join(data, file), JSON.stringify(value));
}
try {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  execFileSync(
    process.execPath,
    ["scripts/build-launcher.mjs", root, "--test-server"],
    { stdio: "inherit" },
  );
  await cp("dist/web", path.join(root, "dist/web"), { recursive: true });
  fixture = createServer(async (req, res) => {
    const resource = req.url.split("/ko/")[1];
    const cost =
      resource === "config.json" || resource === "test-image"
        ? 0
        : resource.startsWith("champions/")
          ? 2
          : 1;
    seen.push({ resource, cost, auth: req.headers.authorization });
    if (slow && cost) await sleep(400);
    if (cost) {
      assert.match(req.headers.authorization ?? "", /^Bearer test-/);
      budget = Math.max(0, budget - cost);
      if (!omitCredits) res.setHeader("x-credits-remaining", budget);
    }
    if (resource === failResource) {
      res.writeHead(failStatus, { "content-type": "application/json" });
      res.end('{"error":"fixture"}');
      return;
    }
    if (resource === "test-image") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uoAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      return;
    }
    let body;
    if (resource === "config.json") body = { dataVersion: version };
    else if (resource === "champions.json") body = catalog();
    else if (resource === "augments.json") body = augment();
    else if (/^champions\/\d+\.json$/.test(resource))
      body = {
        meta: { dataVersion: version },
        data: {
          champion: {
            id: Number(resource.match(/\d+/)[0]),
            name: "테스트 챔피언",
          },
          augments: [{ id: 1 }],
          builds: [{ type: "AP", coreItems: [] }],
        },
      };
    else if (resource.startsWith("data/champion-augments/")) body = raw();
    else {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    if (malformed && cost)
      body = { meta: { dataVersion: version }, data: null };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    if (resource === changeAfter) {
      version = "16.21.9";
      changeAfter = null;
    }
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  await start();
  assert.equal((await get("/api/status")).hasKey, false);
  assert.equal((await post("/api/catalog")).status, 400);
  assert.equal(paid(), 0);
  assert.equal(
    (await post("/api/credentials", { apiKey: "bad key" })).status,
    400,
  );
  assert.equal(
    (await post("/api/credentials", { apiKey: "test-key-one" })).status,
    200,
  );
  assert.equal((await get("/api/status")).hasKey, true);
  assert.ok(!JSON.stringify(await get("/api/status")).includes("test-key-one"));
  assert.equal((await post("/api/catalog")).status, 200);
  assert.equal(paid(), 1);
  assert.equal((await read("catalog.json")).meta.dataVersion, version);
  const before = paid();
  assert.equal((await post("/api/catalog")).body.downloaded, false);
  assert.equal(paid(), before);
  const metadata = await post("/api/augment-descriptions/download");
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.data[0].topChampions[0].id, 8);
  assert.equal(metadata.body.data[0].stats, undefined);
  const count = paid();
  assert.equal(
    (await post("/api/augment-descriptions/download")).body.reused,
    true,
  );
  assert.equal(paid(), count);
  assert.equal((await post("/api/champions/8/download")).status, 200);
  const detailCalls = paid();
  assert.equal((await post("/api/champions/8/download")).body.reused, true);
  assert.equal(paid(), detailCalls);
  assert.equal((await get("/api/status")).credits, budget);
  assert.ok((await read("versions/16.21.5/details/8.json")).cache.downloadedAt);
  await post("/api/settings", { theme: "light", champion: 8 });
  await stop();
  await start();
  assert.equal((await get("/api/status")).hasKey, true);
  assert.equal((await get("/api/settings")).theme, "light");
  checks.push(
    "캐시 없는 새 환경: 키 등록→목록·도감·상세 다운로드→조회→종료·재실행, 키·설정 유지, 같은 버전 유료 호출 생략",
  );
  const keyFile = path.join(data, "credentials.json").replaceAll("'", "''");
  assert.match(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `[IO.File]::GetAccessControl('${keyFile}').AreAccessRulesProtected`,
      ],
      { encoding: "utf8" },
    ),
    /True/,
  );
  checks.push(
    "키 상태 응답 비노출 및 현재 Windows 사용자만 접근하는 자격 증명 ACL",
  );
  const imageUrl = "https://cdn.dtodo.cn/hextech/champion-icons/8.png";
  const imageRoute = "/api/image?url=" + encodeURIComponent(imageUrl);
  assert.equal((await fetch(origin + imageRoute)).status, 200);
  const images = seen.filter((x) => x.resource === "test-image").length;
  assert.equal((await fetch(origin + imageRoute)).status, 200);
  assert.equal(seen.filter((x) => x.resource === "test-image").length, images);
  assert.equal((await post("/api/images/reset")).status, 200);
  assert.equal((await fetch(origin + imageRoute)).status, 200);
  assert.equal(
    seen.filter((x) => x.resource === "test-image").length,
    images + 1,
  );
  assert.equal(
    (
      await fetch(
        origin +
          "/api/image?url=" +
          encodeURIComponent("https://example.com/secret"),
      )
    ).status,
    403,
  );
  checks.push(
    "허용된 이미지 다운로드·캐시 재사용·초기화·재다운로드 및 외부 경로 차단",
  );
  const old = await read("details/8.json");
  version = "16.21.6";
  changeAfter = "champions/8.json";
  assert.equal((await post("/api/champions/8/download")).status, 400);
  assert.deepEqual(await read("details/8.json"), old);
  failResource = "champions/8.json";
  failStatus = 401;
  assert.match((await post("/api/champions/8/download")).body.error, /인증/);
  assert.deepEqual(await read("details/8.json"), old);
  failStatus = 429;
  budget = 2;
  assert.equal((await post("/api/champions/8/download")).status, 400);
  assert.equal((await get("/api/status")).credits, 0);
  assert.deepEqual(await read("details/8.json"), old);
  failResource = null;
  budget = 200;
  await post("/api/credentials", { apiKey: "test-key-two" });
  assert.equal((await get("/api/status")).credits, 200);
  malformed = true;
  assert.equal((await post("/api/champions/8/download")).status, 400);
  malformed = false;
  assert.deepEqual(await read("details/8.json"), old);
  omitCredits = true;
  const remaining = (await get("/api/status")).credits;
  assert.equal((await post("/api/champions/8/download")).status, 200);
  assert.equal((await get("/api/status")).credits, remaining - 2);
  assert.equal((await get("/api/status")).creditsEstimated, true);
  omitCredits = false;
  checks.push(
    "수집 중 버전 변경·401·429·잘못된 응답에서 기존 캐시 보존, 키 변경 시 할당량 분리, 헤더 누락 시 보수적 예상 차감",
  );
  version = "16.22.1";
  budget = 200;
  await post("/api/credentials", { apiKey: "test-key-three" });
  const plan = await post("/api/sync/plan");
  assert.equal(plan.body.needsCatalog, true);
  assert.equal((await post("/api/sync")).status, 200);
  assert.match((await job()).message, /완료/);
  const normalized = await read("raw-details/8.json");
  assert.equal(normalized.data.augments[0].stats.winRate, 0.5);
  assert.equal(normalized.data.augmentTrios[0].stats.games, 5);
  assert.equal(normalized.data.statsDate, "2026-11-05");
  const merged = await get("/api/champions/8");
  assert.equal(merged.meta.dataVersion, version);
  assert.equal(merged.buildStale, true);
  assert.equal(merged.data.builds[0].type, "AP");
  const already = paid();
  assert.equal((await post("/api/sync/plan")).body.needed, 0);
  await post("/api/sync");
  await job();
  assert.equal(paid(), already);
  checks.push(
    "목록·증강 자동 갱신과 전체 수집, 원시 통계·조합 정규화, 새 증강과 이전 빌드 결합, 완료 후 재수집 비용 없음",
  );
  version = "16.22.2";
  budget = 200;
  slow = true;
  await post("/api/sync");
  await until(
    () =>
      seen.some(
        (x) =>
          x.resource === "data/champion-augments/8.json" && x === seen.at(-1),
      ) || seen.at(-1)?.cost > 0,
    "유료 요청 진행",
  );
  assert.equal(
    (await post("/api/credentials", { apiKey: "test-denied" })).status,
    400,
  );
  await post("/api/cancel");
  const cancelled = await job();
  assert.match(cancelled.message, /중단/);
  slow = false;
  await post("/api/sync");
  assert.match((await job()).message, /완료/);
  version = "16.22.3";
  budget = 21;
  await post("/api/credentials", { apiKey: "test-reserve" });
  const keyId = createHash("sha256")
    .update("test-reserve")
    .digest("hex")
    .slice(0, 24);
  await stop();
  await write("credits.json", {
    remaining: 21,
    keyId,
    day: new Date().toISOString().slice(0, 10),
  });
  await start();
  await post("/api/sync");
  assert.match((await job()).message, /20 credits/);
  assert.ok((await get("/api/status")).credits >= 20);
  await stop();
  await write("credits.json", { remaining: 0, keyId, day: "2000-01-01" });
  await start();
  assert.equal((await get("/api/status")).credits, 200);
  checks.push(
    "진행 중 중복 다운로드·키 변경 차단, 수집 중단·이어받기, 상세용 20 credits 보존, UTC 날짜 변경 시 할당량 초기화",
  );
  const headers = {
    Origin: origin,
    "x-session-token": token,
    "content-type": "application/json",
  };
  assert.equal(
    (
      await fetch(origin + "/api/settings", {
        method: "POST",
        headers,
        body: "{bad",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(origin + "/api/shutdown", {
        method: "POST",
        headers: { Origin: "https://example.com", "x-session-token": token },
      })
    ).status,
    403,
  );
  version = "16.23.1";
  slow = true;
  await post("/api/sync");
  await stop();
  slow = false;
  await start();
  assert.equal((await get("/api/status")).job.running, false);
  await stop();
  checks.push(
    "잘못된 JSON·외부 출처 차단, 수집 중 종료·재실행 시 잔류 작업 없음",
  );
  await writeFile(
    "release/csharp-api-checks.json",
    JSON.stringify(checks, null, 2),
  );
  console.log(checks.map((x) => "통과: " + x).join("\n"));
} catch (e) {
  try {
    console.error(await readFile(path.join(root, "logs/launcher.log"), "utf8"));
  } catch {}
  throw e;
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await until(
      () => child.exitCode !== null || child.signalCode !== null,
      "실패 프로세스 정리",
    ).catch(() => {});
  }
  if (fixture) await new Promise((r) => fixture.close(r));
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 300,
  });
}
