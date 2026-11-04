import { readFile, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const reference =
  "https://github.com/k0102575/mayhem-pocket/releases/download/v0.1.5/mayhem-pocket-v0.1.5-windows-x64.zip";
const response = await fetch(reference);
if (!response.ok) throw Error("기존 ZIP 다운로드 실패: " + response.status);
const baseline = Buffer.from(await response.arrayBuffer());
if (
  createHash("sha256").update(baseline).digest("hex") !==
  "ae645fb1767efc7b73f7ca7a21b4f682924a5d40d66ee12751207b4457a23254"
)
  throw Error("기준 ZIP 체크섬 불일치");
await writeFile("release/node-baseline.zip", baseline);
const statistics = (file) =>
  JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${path.resolve(file).replaceAll("'", "''")}'); try { $f=@($z.Entries | Where-Object { $_.Name -ne '' }); @{files=$f.Count;unpacked=($f | Measure-Object Length -Sum).Sum} | ConvertTo-Json -Compress } finally { $z.Dispose() }`,
      ],
      { encoding: "utf8" },
    ),
  );
const node = {
  zip: baseline.length,
  ...statistics("release/node-baseline.zip"),
};
const csharp = {
  zip: (await stat("release/mayhem-pocket-csharp-preview.zip")).size,
  ...statistics("release/mayhem-pocket-csharp-preview.zip"),
};
const checks = JSON.parse(
  await readFile("release/prototype-checks.json", "utf8"),
);
const result = {
  baseline: "v0.1.5",
  scope:
    "C# offline cache-viewing prototype; API downloads are not implemented; not feature-equivalent",
  node,
  csharp,
  zipReductionPercent: ((node.zip - csharp.zip) / node.zip) * 100,
  checks,
};
await writeFile(
  "release/prototype-comparison.json",
  JSON.stringify(result, null, 2),
);
const mib = (x) => (x / 1048576).toFixed(2) + " MiB";
await writeFile(
  "release/prototype-comparison.md",
  `# C# 시제품 비교\n\n| 항목 | 정식 v0.1.5 (Node) | C# 조회 시제품 |\n|---|---:|---:|\n| ZIP | ${mib(node.zip)} | ${mib(csharp.zip)} |\n| 압축 해제 크기 | ${mib(node.unpacked)} | ${mib(csharp.unpacked)} |\n| 파일 수 | ${node.files} | ${csharp.files} |\n\nZIP 감소: ${result.zipReductionPercent.toFixed(2)}%\n\nC# 시제품은 기존 화면과 저장된 데이터 조회·설정·종료 검증용입니다. API 다운로드·할당량·취소·전체 수집 기능을 아직 옮기지 않아 기능이 동등한 비교는 아닙니다. Windows 기본 .NET Framework를 사용하며 별도 런타임을 포함하지 않습니다. 런타임 메모리와 성능은 이번 비교에서 측정하지 않았습니다.\n\n## Windows 검증\n\n${checks.map((c) => "- " + c).join("\n")}\n`,
);
console.log(JSON.stringify(result, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    await readFile("release/prototype-comparison.md", "utf8"),
  );
}
