import { mkdir, rm, cp, writeFile, readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
if (process.platform !== "win32") throw Error("Windows runner에서 실행하세요.");
const dir = path.resolve("release/mayhem-pocket-csharp-preview");
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
execFileSync(
  process.execPath,
  ["scripts/build-launcher.mjs", dir, "--prototype"],
  { stdio: "inherit" },
);
await cp("dist/web", path.join(dir, "dist/web"), { recursive: true });
await cp(
  "dist/server/THIRD_PARTY_LICENSES.txt",
  path.join(dir, "THIRD_PARTY_LICENSES.txt"),
);
await cp("THIRD_PARTY_NOTICES.md", path.join(dir, "THIRD_PARTY_NOTICES.md"));
await cp("prototype/README.md", path.join(dir, "README.md"));
await writeFile(
  path.join(dir, "실행.cmd"),
  '@echo off\r\nstart "" "%~dp0Mayhem Pocket.exe"\r\n',
);
await writeFile(
  path.join(dir, "종료.cmd"),
  '@echo off\r\n"%~dp0Mayhem Pocket.exe" --stop\r\n',
);
const zip = dir + ".zip";
await rm(zip, { force: true });
const quote = (s) => s.replaceAll("'", "''");
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -LiteralPath '${quote(dir)}' -DestinationPath '${quote(zip)}' -Force`,
]);
await writeFile(
  zip + ".sha256",
  createHash("sha256")
    .update(await readFile(zip))
    .digest("hex") +
    "  " +
    path.basename(zip) +
    "\n",
);
console.log("C# 시제품 ZIP bytes:", (await stat(zip)).size);
