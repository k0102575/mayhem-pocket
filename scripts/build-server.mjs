import { build } from "esbuild";
import { isBuiltin } from "node:module";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function buildServer(outfile = "dist/server/index.js") {
  const result = await build({
    entryPoints: ["server/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Bundled CommonJS dependencies still require Node's built-in modules.
    banner: {
      js: 'import { createRequire as __pocketCreateRequire } from "node:module"; const require = __pocketCreateRequire(import.meta.url);',
    },
    outfile,
    metafile: true,
  });
  const external = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external && !isBuiltin(item.path));
  if (external.length)
    throw Error(
      "묶이지 않은 서버 의존성: " +
        external.map((item) => item.path).join(", "),
    );
  const packageDirs = new Set(
    Object.keys(result.metafile.inputs)
      .map((file) => file.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1])
      .filter(Boolean),
  );
  // Include UI dependency notices too: the release no longer ships their package folders.
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  for (const [dir, metadata] of Object.entries(lock.packages ?? {})) {
    if (!dir.includes("node_modules/") || metadata.dev) continue;
    try {
      await readFile(path.join(dir, "package.json"));
      packageDirs.add(dir);
    } catch (error) {
      if (!metadata.optional || error.code !== "ENOENT") throw error;
    }
  }
  const notices = [];
  for (const dir of [...packageDirs].sort()) {
    const pkg = JSON.parse(
      await readFile(path.join(dir, "package.json"), "utf8"),
    );
    const files = (await readdir(dir, { withFileTypes: true })).filter(
      (file) =>
        file.isFile() &&
        /^(licen[sc]e|copying|notice)([.-]|$)/i.test(file.name),
    );
    notices.push(
      `=== ${pkg.name} ${pkg.version} (${pkg.license ?? "라이선스 정보 미제공"}) ===`,
    );
    for (const file of files)
      notices.push(await readFile(path.join(dir, file.name), "utf8"));
  }
  await writeFile(
    path.join(path.dirname(outfile), "THIRD_PARTY_LICENSES.txt"),
    notices.join("\n\n"),
  );
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await buildServer();
