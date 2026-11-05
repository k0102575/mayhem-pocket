import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
if (process.platform !== "win32") throw Error("Windows에서 실행하세요.");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const packageName = `mayhem-pocket-v${version}-windows-x64`;
const smoke = path.resolve("release/C# 시제품 한글 실행 테스트");
const dir = path.join(smoke, packageName);
const data = path.join(smoke, "시제품 설정");
const source = data;
const children = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const env = {
  ...process.env,
  MAYHEM_DATA_DIR: data,
  MAYHEM_PREVIEW_CACHE: source,
  MAYHEM_POCKET_NO_BROWSER: "1",
  PORT: "14331",
};
let occupied;
async function until(fn, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw Error(label + " 제한 시간 초과");
}
function run(args = []) {
  const child = spawn(path.join(dir, "Mayhem Pocket.exe"), args, {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}
async function exited(child) {
  await until(
    () => child.exitCode !== null || child.signalCode !== null,
    "프로세스 종료",
  );
  assert.equal(child.exitCode, 0);
}
async function status() {
  try {
    const instance = JSON.parse(
      await readFile(path.join(data, "instance.json"), "utf8"),
    );
    const response = await fetch(
      `http://127.0.0.1:${instance.port}/api/status`,
      { signal: AbortSignal.timeout(1500) },
    );
    const s = await response.json();
    return s.token === instance.token
      ? { ...instance, status: s, origin: `http://127.0.0.1:${instance.port}` }
      : null;
  } catch {
    return null;
  }
}
async function start() {
  const child = run();
  const info = await until(status, "서버 시작");
  assert.equal(info.pid, child.pid, "서버와 트레이는 같은 프로세스");
  return { child, ...info };
}
async function stop(running, web = true) {
  if (web) {
    const r = await fetch(running.origin + "/api/shutdown", {
      method: "POST",
      headers: { Origin: running.origin, "x-session-token": running.token },
    });
    assert.equal(r.status, 200);
  } else await exited(run(["--stop"]));
  await exited(running.child);
  assert.equal(await status(), null);
  await assert.rejects(readFile(path.join(data, "instance.json")), {
    code: "ENOENT",
  });
}
try {
  await rm(smoke, { recursive: true, force: true });
  await mkdir(smoke, { recursive: true });
  const quote = (s) => s.replaceAll("'", "''");
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${quote(path.resolve("release", packageName + ".zip"))}' -DestinationPath '${quote(smoke)}' -Force`,
  ]);
  assert.deepEqual(
    (await readdir(dir)).sort(),
    [
      "Mayhem Pocket.exe",
      "README.md",
      "THIRD_PARTY_LICENSES.txt",
      "THIRD_PARTY_NOTICES.md",
      "dist",
      ".env.example",
      "실행.cmd",
      "종료.cmd",
    ].sort(),
  );
  await mkdir(path.join(source, "details"), { recursive: true });
  await mkdir(path.join(source, "raw-details"));
  await mkdir(path.join(source, "images"));
  await writeFile(
    path.join(source, "catalog.json"),
    JSON.stringify({
      meta: { dataVersion: "16.21.5" },
      data: [{ id: 8, name: "블라디미르" }],
    }),
  );
  const full = {
    meta: { dataVersion: "16.21.5" },
    data: {
      champion: { id: 8, name: "블라디미르" },
      augments: [],
      builds: [{ type: "AP", coreItems: [] }],
    },
  };
  await writeFile(path.join(source, "details/8.json"), JSON.stringify(full));
  await writeFile(
    path.join(source, "raw-details/8.json"),
    JSON.stringify({
      meta: { dataVersion: "16.21.6" },
      data: {
        champion: { id: 8, name: "블라디미르" },
        augments: [{ id: 1, name: "시제품 증강" }],
        builds: [],
        rawOnly: true,
      },
    }),
  );
  await writeFile(
    path.join(source, "augments.json"),
    JSON.stringify({
      meta: { dataVersion: "16.21.5" },
      data: [
        {
          id: 1,
          name: "시제품 증강",
          description: "설명",
          topChampions: [{ id: 8, name: "블라디미르" }],
        },
      ],
    }),
  );
  await writeFile(
    path.join(source, "credentials.json"),
    "DO NOT READ OR MODIFY",
  );

  const imageUrl = "https://cdn.dtodo.cn/hextech/champion-icons/8.png";
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uoAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(
    path.join(
      source,
      "images",
      createHash("sha256").update(imageUrl).digest("hex"),
    ),
    image,
  );
  const checks = [];
  const first = await start();
  assert.equal(first.status.prototype, undefined);
  assert.equal(first.status.hasKey, false);
  checks.push("Node 없이 서버와 트레이 단일 프로세스 시작, 한글·공백 경로");
  assert.match(await (await fetch(first.origin)).text(), /Mayhem Pocket/);
  const html = await (await fetch(first.origin)).text();
  const asset = html.match(/src="([^\"]+\.js)"/)[1];
  assert.equal((await fetch(first.origin + asset)).status, 200);
  assert.equal(
    (await (await fetch(first.origin + "/api/champions")).json())[0].id,
    8,
  );
  const detail = await (await fetch(first.origin + "/api/champions/8")).json();
  assert.equal(detail.data.augments[0].id, 1);
  assert.equal(detail.data.builds[0].type, "AP");
  assert.equal(detail.buildStale, true);
  assert.equal(
    (await (await fetch(first.origin + "/api/augment-descriptions")).json())
      .data[0].topChampions[0].id,
    8,
  );
  assert.deepEqual(
    Buffer.from(
      await (
        await fetch(
          first.origin + "/api/image?url=" + encodeURIComponent(imageUrl),
        )
      ).arrayBuffer(),
    ),
    image,
  );
  checks.push(
    "기존 화면과 정적 파일, 캐시 목록·상세·도감·이미지 조회, 최신 증강과 이전 빌드 결합",
  );
  assert.equal(
    (await fetch(first.origin + "/api/shutdown", { method: "POST" })).status,
    403,
  );
  assert.equal(
    (
      await fetch(first.origin + "/api/shutdown", {
        method: "POST",
        headers: {
          Origin: "https://example.com",
          "x-session-token": first.token,
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(
        first.origin +
          "/api/image?url=" +
          encodeURIComponent("file:///C:/Windows/win.ini"),
      )
    ).status,
    403,
  );
  const headers = {
    Origin: first.origin,
    "x-session-token": first.token,
    "content-type": "application/json",
  };
  assert.equal(
    (
      await fetch(first.origin + "/api/settings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          theme: "light",
          champion: 8,
          favorites: [8, 8, -1],
          recent: [8],
          tab: "builds",
        }),
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await (await fetch(first.origin + "/api/settings")).json()).favorites,
    [8],
  );
  const parallel = await Promise.all(
    Array.from({ length: 16 }, () =>
      fetch(first.origin + "/api/status").then((r) => r.json()),
    ),
  );
  assert.ok(parallel.every((s) => !s.prototype && s.token === first.token));
  const duplicate = run();
  await exited(duplicate);
  assert.equal((await status()).pid, first.pid);
  await stop(first);
  checks.push("동시 조회, 중복 실행 방지, 웹 종료와 실행 기록 정리");
  const second = await start();
  assert.equal(
    (await (await fetch(second.origin + "/api/settings")).json()).theme,
    "light",
  );
  await stop(second, false);
  checks.push("재실행 후 설정 유지, 트레이와 동일한 --stop 종료");
  occupied = createServer((q, r) => r.end("occupied"));
  await new Promise((resolve) => occupied.listen(14331, "127.0.0.1", resolve));
  await mkdir(data, { recursive: true });
  await writeFile(path.join(data, "instance.json"), "{}");
  const third = await start();
  assert.equal(third.port, 14332);
  await stop(third);
  await new Promise((resolve) => occupied.close(resolve));
  occupied = null;
  checks.push("포트 충돌 우회, 오래된 실행 기록 복구");
  const fourth = await start();
  fourth.child.kill();
  await until(
    () => fourth.child.exitCode !== null || fourth.child.signalCode !== null,
    "강제 종료",
  );
  await assert.rejects(
    fetch(fourth.origin + "/api/status", { signal: AbortSignal.timeout(1000) }),
  );
  const fifth = await start();
  await stop(fifth);
  checks.push("강제 종료 시 서버 잔류 없음, 재시작");
  assert.equal(
    await readFile(path.join(source, "credentials.json"), "utf8"),
    "DO NOT READ OR MODIFY",
  );

  checks.push("기존 API 키·설정 파일 무변경");
  await writeFile(
    "release/csharp-lifecycle-checks.json",
    JSON.stringify(checks, null, 2),
  );
  console.log(checks.map((c) => "통과: " + c).join("\n"));
} catch (error) {
  try {
    console.error(await readFile(path.join(dir, "logs/launcher.log"), "utf8"));
  } catch {}
  throw error;
} finally {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill();
  if (occupied) await new Promise((resolve) => occupied.close(resolve));
  await delay(500);
  await rm(smoke, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 300,
  });
}
