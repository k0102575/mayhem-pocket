import { spawn, execFileSync } from "node:child_process";
import {
  readFile,
  access,
  rm,
  mkdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import path from "node:path";
const p = JSON.parse(await readFile("package.json", "utf8"));
const name = `mayhem-pocket-v${p.version}-windows-x64`;
const smoke = path.resolve("release", "실행 테스트 경로");
const quote = (s) => s.replaceAll("'", "''");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
let occupied;
const env = {
  ...process.env,
  PORT: "14319",
  ARAMGG_API_KEY: "",
  MAYHEM_POCKET_NO_BROWSER: "1",
};
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(100);
  }
  throw Error(label + " 제한 시간 초과");
}
function run(file, args = []) {
  const child = spawn(file, args, {
    cwd: dir,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  child.on("error", (error) => (output += error.message));
  child.output = () => output;
  children.push(child);
  return child;
}
async function exited(child, expected = 0) {
  await until(
    () => child.exitCode !== null || child.signalCode !== null,
    "실행기 종료",
    15000,
  );
  assert.equal(child.exitCode, expected, child.output());
}
async function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
const dir = path.join(smoke, name);
async function status() {
  try {
    const i = JSON.parse(
      await readFile(path.join(dir, "cache/instance.json"), "utf8"),
    );
    const result = await (
      await fetch(`http://127.0.0.1:${i.port}/api/status`, {
        signal: AbortSignal.timeout(1200),
      })
    ).json();
    return result.token === i.token ? { ...i, status: result } : null;
  } catch {
    return null;
  }
}
async function start() {
  const child = run(path.join(dir, "Mayhem Pocket.exe"));
  const info = await until(async () => {
    if (child.exitCode !== null) {
      let log = "";
      try {
        log = await readFile(path.join(dir, "logs/launcher.log"), "utf8");
      } catch {}
      throw Error("실행기 시작 실패: " + log);
    }
    return status();
  }, "서버 시작");
  await until(async () => {
    try {
      return (
        await readFile(path.join(dir, "logs/launcher.log"), "utf8")
      ).includes("트레이 실행기 준비 완료");
    } catch {
      return false;
    }
  }, "트레이 준비");
  return { child, info };
}
async function closed(info, child) {
  await exited(child);
  await until(async () => !(await alive(info.pid)), "Node 종료");
  assert.equal(await status(), null);
}
try {
  await rm(smoke, { recursive: true, force: true });
  await mkdir(smoke, { recursive: true });
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath '${quote(path.resolve("release", name + ".zip"))}' -DestinationPath '${quote(smoke)}' -Force`,
  ]);
  for (const file of [
    "Mayhem Pocket.exe",
    "runtime/node.exe",
    "app/server/index.js",
    "dist/web/index.html",
    "실행.cmd",
    "종료.cmd",
    ".env.example",
  ])
    await access(path.join(dir, file));
  for (const file of [".env", "data", "backups", "cache", "logs"]) {
    try {
      await access(path.join(dir, file));
      throw Error("개인 파일 포함: " + file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const executable = await readFile(path.join(dir, "Mayhem Pocket.exe"));
  const pe = executable.readUInt32LE(0x3c);
  assert.equal(
    executable.readUInt16LE(pe + 24 + 68),
    2,
    "콘솔 없는 Windows GUI 실행 파일이어야 합니다.",
  );
  const first = await start();
  assert.equal(first.info.status.hasKey, false);
  assert.ok(
    (
      await (await fetch(`http://127.0.0.1:${first.info.port}`)).text()
    ).includes("Mayhem Pocket"),
  );
  const duplicate = run(path.join(dir, "Mayhem Pocket.exe"));
  await exited(duplicate);
  const legacy = run(process.env.ComSpec || "cmd.exe", [
    "/d",
    "/s",
    "/c",
    "실행.cmd",
  ]);
  await exited(legacy);
  await delay(800);
  assert.equal(
    (await status()).pid,
    first.info.pid,
    "중복 실행이 서버를 늘리면 안 됩니다.",
  );
  await exited(run(path.join(dir, "Mayhem Pocket.exe"), ["--stop"]));
  await closed(first.info, first.child);
  console.log(
    "GUI 실행 파일, 한글·공백 경로, UI, 중복 실행, 실행.cmd, 트레이와 동일한 종료 경로 검증 완료",
  );

  const second = await start();
  const origin = `http://127.0.0.1:${second.info.port}`;
  const stop = await fetch(origin + "/api/shutdown", {
    method: "POST",
    headers: { "x-session-token": second.info.token, Origin: origin },
  });
  assert.equal(stop.status, 200);
  await closed(second.info, second.child);
  console.log("웹 화면 종료 시 트레이 프로세스 종료 검증 완료");

  occupied = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(14319, "127.0.0.1", resolve);
  });
  await writeFile(
    path.join(dir, "cache/instance.json"),
    JSON.stringify({ port: 14319, pid: 999999, token: "stale-test" }),
  );
  const third = await start();
  assert.equal(third.info.port, 14320);
  const stopScript = run(process.env.ComSpec || "cmd.exe", [
    "/d",
    "/s",
    "/c",
    "종료.cmd",
  ]);
  await exited(stopScript);
  await closed(third.info, third.child);
  await new Promise((resolve) => occupied.close(resolve));
  occupied = null;
  console.log("사용 중인 포트·이전 실행 기록 복구, 종료.cmd 검증 완료");

  const fourth = await start();
  fourth.child.kill();
  await until(
    async () => !(await alive(fourth.info.pid)),
    "실행기 강제 종료 후 Node 정리",
  );
  console.log("실행기 강제 종료 시 서버 잔류 방지 검증 완료");
  const raw = run(path.join(dir, "runtime/node.exe"), [
    path.join(dir, "app/server/index.js"),
  ]);
  const rawInfo = await until(async () => {
    const info = await status();
    return info?.pid === raw.pid ? info : null;
  }, "기존 서버 준비");
  const attached = await start();
  assert.equal(
    attached.info.pid,
    rawInfo.pid,
    "기존 서버를 재사용해야 합니다.",
  );
  attached.child.kill();
  await until(
    () =>
      attached.child.signalCode !== null || attached.child.exitCode !== null,
    "연결 실행기 종료",
  );
  assert.equal(
    await alive(rawInfo.pid),
    true,
    "실행기 소유가 아닌 기존 서버를 강제로 죽이면 안 됩니다.",
  );
  const rawOrigin = `http://127.0.0.1:${rawInfo.port}`;
  await fetch(rawOrigin + "/api/shutdown", {
    method: "POST",
    headers: { "x-session-token": rawInfo.token, Origin: rawOrigin },
  });
  await exited(raw);
  console.log("기존 서버 재사용·소유하지 않은 프로세스 보호 검증 완료");

  const entry = path.join(dir, "app/server/index.js");
  await rename(entry, entry + ".test-hold");
  try {
    await exited(run(path.join(dir, "Mayhem Pocket.exe")), 1);
  } finally {
    await rename(entry + ".test-hold", entry);
  }
  console.log(
    "필수 파일 누락 시 오류 로그·실패 종료 검증 완료. 실제 Windows 10 트레이 외관과 브라우저 표시는 수동 확인이 필요합니다.",
  );
} catch (error) {
  let log = "";
  try {
    log = await readFile(path.join(dir, "logs/launcher.log"), "utf8");
  } catch {}
  console.error(error, log);
  throw error;
} finally {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill();
  if (occupied) await new Promise((resolve) => occupied.close(resolve));
  await delay(1000);
  await rm(smoke, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 300,
  });
}
