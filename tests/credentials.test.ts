import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { once } from "node:events";

async function start(cwd: string, data: string) {
  const mock = path.join(cwd, "offline.mjs");
  // A credentials save must not call any provider or consume credits.
  await writeFile(
    mock,
    "globalThis.fetch = async () => { throw Error('Network is disabled for this test'); };",
  );
  const env: NodeJS.ProcessEnv = { ...process.env, MAYHEM_DATA_DIR: data, PORT: "0" };
  delete env.ARAMGG_API_KEY;
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
      "--import",
      pathToFileURL(mock).href,
      path.resolve("server/index.ts"),
    ],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (x) => {
    logs += x;
  });
  child.stderr.on("data", (x) => {
    logs += x;
  });
  let origin = "";
  for (let attempt = 0; attempt < 150; attempt++) {
    origin = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? "";
    if (origin) break;
    if (child.exitCode !== null) throw Error(logs);
    await new Promise((r) => setTimeout(r, 30));
  }
  if (!origin) {
    child.kill();
    throw Error("startup timeout");
  }
  const status = () => fetch(origin + "/api/status").then((r) => r.json());
  const initial = await status();
  return {
    status,
    origin,
    logs: () => logs,
    save: (apiKey: unknown, extra: Record<string, string> = {}) =>
      fetch(origin + "/api/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-token": initial.token,
          Origin: origin,
          ...extra,
        },
        body: JSON.stringify({ apiKey }),
      }),
    close: async () => {
      if (child.exitCode !== null) return;
      const exit = once(child, "exit");
      child.kill();
      await exit;
    },
  };
}

test("key registration is protected, persistent across releases, and never returned in status", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pocket-key-"));
  const old = path.join(root, "release-one"),
    next = path.join(root, "release-two"),
    data = path.join(root, "documents");
  await mkdir(old);
  await mkdir(next);
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    server = await start(old, data);
    assert.equal((await server.status()).hasKey, false);
    assert.equal(
      (await server.save("first-test-key", { "x-session-token": "wrong" }))
        .status,
      403,
    );
    assert.equal(
      (await server.save("first-test-key", { Origin: "https://evil.example" }))
        .status,
      403,
    );
    for (const invalid of ["", "  ", "key with spaces", "key\nvalue", 12])
      assert.equal((await server.save(invalid)).status, 400);
    const result = await server.save("  first-test-key  ");
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { saved: true });
    assert.equal((await server.status()).hasKey, true);
    assert.equal(
      JSON.parse(await readFile(path.join(data, "credentials.json"), "utf8"))
        .apiKey,
      "first-test-key",
    );
    if (process.platform !== "win32")
      assert.equal(
        (await stat(path.join(data, "credentials.json"))).mode & 0o777,
        0o600,
      );
    assert.equal((await server.save("replacement-test-key")).status, 200);
    assert.equal(
      JSON.stringify(await server.status()).includes("replacement-test-key"),
      false,
    );
    assert.equal(server.logs().includes("replacement-test-key"), false);
    await server.close();
    // A stale .env in a new release must not override the key changed in the UI.
    await writeFile(path.join(next, ".env"), "ARAMGG_API_KEY=stale-env-key\n");
    server = await start(next, data);
    assert.equal((await server.status()).hasKey, true);
    assert.equal(
      JSON.parse(await readFile(path.join(data, "credentials.json"), "utf8"))
        .apiKey,
      "replacement-test-key",
    );
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("existing env key is imported and survives removal of the env file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pocket-key-"));
  const data = path.join(root, "documents");
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await writeFile(
      path.join(root, ".env"),
      "ARAMGG_API_KEY=legacy-test-key\n",
    );
    server = await start(root, data);
    assert.equal((await server.status()).hasKey, true);
    assert.equal(
      JSON.parse(await readFile(path.join(data, "credentials.json"), "utf8"))
        .apiKey,
      "legacy-test-key",
    );
    await server.close();
    await rm(path.join(root, ".env"));
    server = await start(root, data);
    assert.equal((await server.status()).hasKey, true);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
