import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { migrateLegacyCache } from "../server/storage";
import { dataDirectory } from "../scripts/storage.mjs";

test("legacy cache imports once, preserves existing data and skips process state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pocket-storage-"));
  const legacy = path.join(root, "old-release", "cache");
  const target = path.join(root, "사용자 문서", "mayhem-pocket");
  try {
    await mkdir(path.join(legacy, "details"), { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(path.join(legacy, "catalog.json"), "old catalog");
    await writeFile(path.join(target, "catalog.json"), "new catalog");
    await writeFile(path.join(legacy, "details", "11.json"), "detail");
    await writeFile(path.join(legacy, "settings.json"), '{"favorites":[11]}');
    await writeFile(path.join(legacy, "instance.json"), "stale credentials");
    await writeFile(path.join(legacy, "incomplete.tmp"), "partial");
    await migrateLegacyCache(legacy, target);
    assert.equal(
      await readFile(path.join(target, "catalog.json"), "utf8"),
      "new catalog",
    );
    assert.equal(
      await readFile(path.join(target, "details", "11.json"), "utf8"),
      "detail",
    );
    assert.equal(
      await readFile(path.join(target, "settings.json"), "utf8"),
      '{"favorites":[11]}',
    );
    await assert.rejects(access(path.join(target, "instance.json")));
    await assert.rejects(access(path.join(target, "incomplete.tmp")));
    assert.equal(
      await readFile(path.join(legacy, "details", "11.json"), "utf8"),
      "detail",
    );
    await rm(path.join(target, "details"), { recursive: true });
    await migrateLegacyCache(legacy, target);
    await assert.rejects(access(path.join(target, "details", "11.json")));
    // Removing the old release must not remove settings in the permanent location.
    await rm(path.dirname(legacy), { recursive: true });
    await migrateLegacyCache(path.join(root, "next-release", "cache"), target);
    assert.equal(
      await readFile(path.join(target, "settings.json"), "utf8"),
      '{"favorites":[11]}',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing legacy folder creates a usable data directory without blocking later import", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pocket-storage-"));
  try {
    const legacy = path.join(root, "cache"),
      target = path.join(root, "documents");
    await migrateLegacyCache(legacy, target);
    await access(target);
    await assert.rejects(access(path.join(target, ".legacy-imported.json")));
    await mkdir(legacy);
    await writeFile(path.join(legacy, "catalog.json"), "catalog");
    await migrateLegacyCache(legacy, target);
    assert.equal(
      await readFile(path.join(target, "catalog.json"), "utf8"),
      "catalog",
    );
    await migrateLegacyCache(target, target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit data path is independent of the release working directory", () => {
  const previous = process.env.MAYHEM_DATA_DIR;
  try {
    process.env.MAYHEM_DATA_DIR = path.join(
      tmpdir(),
      "사용자 문서",
      "mayhem-pocket",
    );
    assert.equal(dataDirectory(), path.resolve(process.env.MAYHEM_DATA_DIR));
  } finally {
    if (previous === undefined) delete process.env.MAYHEM_DATA_DIR;
    else process.env.MAYHEM_DATA_DIR = previous;
  }
});
