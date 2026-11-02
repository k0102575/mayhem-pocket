import path from "node:path";
import { constants } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";

// Import once. Preserve both the original cache and any files already in the new location.
export async function migrateLegacyCache(legacy: string, target: string) {
  if (path.resolve(legacy) === path.resolve(target)) return;
  await mkdir(target, { recursive: true });
  const marker = path.join(target, ".legacy-imported.json");
  const entries = await readdir(target);
  if (entries.includes(".legacy-imported.json")) return;
  async function copyMissing(source: string, destination: string) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (
        entry.name === "instance.json" ||
        entry.name.endsWith(".tmp") ||
        entry.name.startsWith(".legacy-")
      )
        continue;
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true });
        await copyMissing(from, to);
      } else if (entry.isFile()) {
        try {
          await copyFile(from, to, constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    }
  }
  try {
    await readdir(legacy);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await copyMissing(legacy, target);
  await writeFile(
    marker,
    JSON.stringify({ source: legacy, importedAt: new Date().toISOString() }),
  );
}
