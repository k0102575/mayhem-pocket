import { execFileSync } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
if (process.platform !== "win32") throw Error("Windows에서 실행하세요.");
const out = path.resolve(process.argv[2] ?? "dist/launcher");
await mkdir(out, { recursive: true });
const compiler = path.join(
  process.env.WINDIR ?? "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);
await access(compiler);
execFileSync(
  compiler,
  [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/utf8output",
  "/codepage:65001",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Net.Http.dll",
    "/reference:System.Web.Extensions.dll",
    `/out:${path.join(out, "Mayhem Pocket.exe")}`,
    path.resolve("launcher/Program.cs"),
  ],
  { stdio: "inherit" },
);
console.log(path.join(out, "Mayhem Pocket.exe"));
