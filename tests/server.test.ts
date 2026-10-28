import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
test("loopback lifecycle protects writes and serves cached data without credentials", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pocket-test-"));
  await mkdir(path.join(root, "cache"));
  await writeFile(
    path.join(root, "cache/catalog.json"),
    JSON.stringify({
      meta: { dataVersion: "test" },
      data: [{ id: 8, name: "블라디미르" }],
    }),
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
      path.resolve("server/index.ts"),
    ],
    {
      cwd: root,
      env: { ...process.env, PORT: "14318", ARAMGG_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (x) => (logs += x));
  child.stderr.on("data", (x) => (logs += x));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error(logs || "startup timeout")),
        10000,
      );
      const interval = setInterval(() => {
        if (logs.includes("Mayhem Pocket:")) {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        } else if (child.exitCode !== null) {
          clearTimeout(timeout);
          clearInterval(interval);
          reject(Error(logs));
        }
      }, 50);
    });
    const base = logs.match(/http:\/\/127.0.0.1:\d+/)![0];
    const s = await (await fetch(base + "/api/status")).json();
    assert.equal(s.hasKey, false);
    assert.equal(
      (await (await fetch(base + "/api/champions")).json())[0].id,
      8,
    );
    assert.equal(
      (await fetch(base + "/api/catalog", { method: "POST" })).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/shutdown", {
          method: "POST",
          headers: {
            "x-session-token": s.token,
            Origin: "https://evil.example",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/image?url=https://example.com/test.png"))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/shutdown", {
          method: "POST",
          headers: { "x-session-token": s.token, Origin: base },
        })
      ).status,
      200,
    );
    await new Promise<void>((resolve, reject) => {
      child.once("exit", () => resolve());
      setTimeout(() => reject(Error("shutdown timeout")), 3000).unref();
    });
  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
