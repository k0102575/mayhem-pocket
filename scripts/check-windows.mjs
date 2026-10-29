import { spawnSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
if (process.platform !== "win32") throw Error("Windows에서 실행하세요.");
for (const script of [
  "scripts/package-windows.mjs",
  "scripts/verify-package.mjs",
]) {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  const output =
    (result.stdout ?? "") +
    (result.stderr ?? "") +
    (result.error?.message ?? "");
  process.stdout.write(output);
  if (result.status !== 0) {
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Windows 검증 실패: ${script}\n\n\`\`\`text\n${output.slice(-60000)}\n\`\`\`\n`,
      );
    process.exit(result.status ?? 1);
  }
}
