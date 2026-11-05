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
execFileSync(process.execPath, ["scripts/build-launcher.mjs", dir], {
  stdio: "inherit",
});
await cp("dist/web", path.join(dir, "dist/web"), { recursive: true });
await cp(
  "dist/server/THIRD_PARTY_LICENSES.txt",
  path.join(dir, "THIRD_PARTY_LICENSES.txt"),
);
for (const file of ["README.md", "THIRD_PARTY_NOTICES.md", ".env.example"])
  await cp(file, path.join(dir, file));
await cp("scripts/start.cmd", path.join(dir, "실행.cmd"));
await writeFile(
  path.join(dir, "종료.cmd"),
  '@echo off\r\n"%~dp0Mayhem Pocket.exe" --stop\r\n',
);
const archive = path.resolve("release", name + ".zip");
await rm(archive, { force: true });
const quote = (s) => s.replaceAll("'", "''");
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${quote(dir)}' -DestinationPath '${quote(archive)}' -Force`,
]);
await writeFile(
  archive + ".sha256",
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex") +
    "  " +
    name +
    ".zip\n",
);
console.log(archive);
