import { spawn, execFileSync } from "node:child_process";
import { readFile, access, rm, mkdir } from "node:fs/promises";
import path from "node:path";
const p = JSON.parse(await readFile("package.json", "utf8"));
const name = `mayhem-pocket-v${p.version}-windows-x64`;
const smoke = path.resolve("release", "실행 테스트 경로");
await rm(smoke, { recursive: true, force: true });
await mkdir(smoke, { recursive: true });
const quote = (s) => s.replaceAll("'", "''");
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Expand-Archive -LiteralPath '${quote(path.resolve("release", name + ".zip"))}' -DestinationPath '${quote(smoke)}' -Force`,
]);
const dir = path.join(smoke, name);
for (const f of [
  "runtime/node.exe",
  "app/server/index.js",
  "dist/web/index.html",
  "실행.cmd",
  "종료.cmd",
  ".env.example",
])
  await access(path.join(dir, f));
for (const f of [".env", "data", "backups", "cache"]) {
  try {
    await access(path.join(dir, f));
    throw Error("Unexpected private path: " + f);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const env = { ...process.env, PORT: "14319", ARAMGG_API_KEY: "" };
const run = (file) =>
  spawn(`"${path.join(dir, file)}"`, [], {
    cwd: dir,
    env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
const exited = (c) =>
  new Promise((resolve, reject) => {
    if (c.exitCode !== null)
      return c.exitCode === 0
        ? resolve()
        : reject(Error("Script failed: " + c.exitCode));
    const timer = setTimeout(() => reject(Error("Script exit timeout")), 10000);
    c.once("error", reject);
    c.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error("Script failed: " + code));
    });
  });
const child = run("실행.cmd");
let output = "";
child.stdout.on("data", (x) => (output += x));
child.stderr.on("data", (x) => (output += x));
try {
  let base;
  for (let i = 0; i < 150; i++) {
    base = output.match(/http:\/\/127.0.0.1:\d+/)?.[0];
    if (base) break;
    if (child.exitCode !== null) throw Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!base) throw Error("Packaged script startup timeout: " + output);
  if (!(await (await fetch(base)).text()).includes("Mayhem Pocket"))
    throw Error("Packaged UI missing");
  const first = await (await fetch(base + "/api/status")).json();
  if (first.hasKey) throw Error("Unexpected credential");
  const duplicate = run("실행.cmd");
  await exited(duplicate);
  const after = await (await fetch(base + "/api/status")).json();
  if (after.token !== first.token)
    throw Error("Duplicate start replaced the active instance");
  const stop = run("종료.cmd");
  await exited(stop);
  await exited(child);
  try {
    await fetch(base + "/api/status", { signal: AbortSignal.timeout(1000) });
    throw Error("Server is still running");
  } catch (e) {
    if (e.message === "Server is still running") throw e;
  }
  console.log(
    "ZIP extraction, Korean/spaced paths, 실행.cmd, duplicate launch, UI and 종료.cmd verified. Browser visual opening remains a manual Windows check.",
  );
} finally {
  try {
    const i = JSON.parse(
      await readFile(path.join(dir, "cache/instance.json"), "utf8"),
    );
    await fetch(`http://127.0.0.1:${i.port}/api/shutdown`, {
      method: "POST",
      headers: { "x-session-token": i.token },
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(smoke, { recursive: true, force: true });
}
