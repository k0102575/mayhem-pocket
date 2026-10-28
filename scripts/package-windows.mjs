import { mkdir, rm, cp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
if (process.platform !== "win32") throw Error("Windows runner에서 실행하세요.");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const name = `mayhem-pocket-v${pkg.version}-windows-x64`;
const dir = path.resolve("release", name);
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
// Runtime is official Node 22 Windows x64; verify its archive against official SHASUMS.
const base = "https://nodejs.org/dist/latest-v22.x/";
const sums = await (await fetch(base + "SHASUMS256.txt")).text();
const line = sums
  .split("\n")
  .find((l) => / node-v[\d.]+-win-x64\.zip$/.test(l));
if (!line) throw Error("공식 런타임 체크섬을 찾을 수 없습니다.");
const [hash, file] = line.trim().split(/\s+/);
const bytes = Buffer.from(await (await fetch(base + file)).arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== hash)
  throw Error("Node 체크섬 불일치");
const zip = path.resolve("release", "node.zip");
await writeFile(zip, bytes);
const unpack = path.resolve("release", "node-unpack");
await rm(unpack, { recursive: true, force: true });
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${unpack}' -Force`,
]);
await cp(
  path.join(unpack, file.replace(".zip", "")),
  path.join(dir, "runtime"),
  { recursive: true },
);
await cp("dist/web", path.join(dir, "dist/web"), { recursive: true });
await cp("dist/server", path.join(dir, "app/server"), { recursive: true });
await cp("package.json", path.join(dir, "app/package.json"));
await cp("package-lock.json", path.join(dir, "app/package-lock.json"));
execFileSync(
  "npm.cmd",
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: path.join(dir, "app"), stdio: "inherit", shell: true },
);
await cp(".env.example", path.join(dir, ".env.example"));
await mkdir(path.join(dir, "scripts"), { recursive: true });
await cp("scripts/stop.mjs", path.join(dir, "scripts/stop.mjs"));
await cp("scripts/start.cmd", path.join(dir, "실행.cmd"));
await cp("scripts/stop.cmd", path.join(dir, "종료.cmd"));
await cp("README.md", path.join(dir, "README.md"));
await cp("THIRD_PARTY_NOTICES.md", path.join(dir, "THIRD_PARTY_NOTICES.md"));
// Explicit file allowlist above intentionally excludes all local secrets and caches.
const archive = path.resolve("release", name + ".zip");
await rm(archive, { force: true });
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${dir}' -DestinationPath '${archive}' -Force`,
]);
const digest = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(archive + ".sha256", digest + "  " + name + ".zip\n");
await rm(zip, { force: true });
await rm(unpack, { recursive: true, force: true });
console.log(archive);
