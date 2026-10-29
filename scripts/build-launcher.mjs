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
try {
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
    { encoding: "utf8" },
  );
} catch (error) {
  const output = String(error.stdout ?? "") + String(error.stderr ?? "");
  const codes =
    [...new Set(output.match(/CS[0-9]{4}/g) ?? [])].join(",") ||
    "COMPILER_FAILURE";
  const positions = [...output.matchAll(/Program\.cs\(([0-9]+),([0-9]+)\)/g)]
    .map((match) => `${match[1]}:${match[2]}`)
    .join(",");
  console.error(
    `::error title=Windows launcher compile::code=${codes}; source=Program.cs; locations=${positions}`,
  );
  process.stdout.write(output);
  throw error;
}
console.log(path.join(out, "Mayhem Pocket.exe"));
