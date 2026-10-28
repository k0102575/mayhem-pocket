import { spawn } from "node:child_process";
import { readFile, access, rm } from "node:fs/promises";
import path from "node:path";
const p = JSON.parse(await readFile("package.json", "utf8"));
const dir = path.resolve("release", `mayhem-pocket-v${p.version}-windows-x64`);
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
const child = spawn(
  path.join(dir, "runtime/node.exe"),
  [path.join(dir, "app/server/index.js")],
  {
    cwd: dir,
    env: { ...process.env, PORT: "14319", ARAMGG_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (x) => (output += x));
child.stderr.on("data", (x) => (output += x));
try {
  let base;
  for (let i = 0; i < 100; i++) {
    base = output.match(/http:\/\/127.0.0.1:\d+/)?.[0];
    if (base) break;
    if (child.exitCode !== null) throw Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!base) throw Error("Packaged startup timeout: " + output);
  const html = await (await fetch(base)).text();
  if (!html.includes("Mayhem Pocket")) throw Error("Packaged UI missing");
  const status = await (await fetch(base + "/api/status")).json();
  if (status.hasKey) throw Error("Unexpected credential");
  const result = await fetch(base + "/api/shutdown", {
    method: "POST",
    headers: { "x-session-token": status.token, Origin: base },
  });
  if (!result.ok) throw Error("Packaged shutdown failed");
  await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    setTimeout(() => reject(Error("Packaged shutdown timeout")), 5000).unref();
  });
  console.log("Packaged runtime, UI and shutdown verified.");
} finally {
  child.kill();
  await rm(path.join(dir, "cache"), { recursive: true, force: true });
}
