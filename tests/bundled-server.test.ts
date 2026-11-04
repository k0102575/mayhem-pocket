import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
// @ts-expect-error Build tooling is a JavaScript module shared with the release command.
import { buildServer } from "../scripts/build-server.mjs";

test("bundled release starts without node_modules, serves files and cached APIs, and shuts down cleanly", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "pocket-bundle-"));
  const root = path.join(temporary, "새 배포 한글 경로");
  const data = path.join(temporary, "사용자 데이터");
  const entry = path.join(root, "app/server/index.js");
  await mkdir(path.dirname(entry), { recursive: true });
  await mkdir(path.join(root, "dist/web/assets"), { recursive: true });
  await mkdir(data);
  await writeFile(path.join(root, "app/package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "dist/web/index.html"),
    '<html><title>Mayhem Pocket</title><script src="/assets/test.js"></script></html>',
  );
  await writeFile(
    path.join(root, "dist/web/assets/test.js"),
    'console.log("static asset");',
  );
  await writeFile(
    path.join(data, "catalog.json"),
    JSON.stringify({
      meta: { dataVersion: "test" },
      data: [{ id: 8, name: "블라디미르" }],
    }),
  );
  await writeFile(
    path.join(data, "augments.json"),
    JSON.stringify({
      meta: { dataVersion: "test" },
      data: [
        {
          id: 1,
          name: "테스트 증강",
          description: "설명",
          topChampions: [{ id: 8, name: "블라디미르" }],
        },
      ],
    }),
  );
  const offline = path.join(temporary, "offline.mjs");
  await writeFile(
    offline,
    'globalThis.fetch = async () => { throw Error("Test network disabled"); };',
  );
  const children: ReturnType<typeof spawn>[] = [];
  const env = {
    ...process.env,
    MAYHEM_DATA_DIR: data,
    PORT: "0",
    ARAMGG_API_KEY: "",
    NODE_PATH: "",
    NODE_OPTIONS: "",
  };
  async function start() {
    const child = spawn(
      process.execPath,
      ["--import", pathToFileURL(offline).href, entry],
      { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(child);
    let output = "";
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    const deadline = Date.now() + 10000;
    while (!output.includes("Mayhem Pocket:")) {
      if (child.exitCode !== null || Date.now() > deadline)
        throw Error("배포 서버 시작 실패: " + output);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const origin = output.match(/http:\/\/127.0.0.1:\d+/)![0];
    const status = await (await fetch(origin + "/api/status")).json();
    return { child, origin, status };
  }
  async function stop(running: Awaited<ReturnType<typeof start>>) {
    const exited = once(running.child, "exit");
    const response = await fetch(running.origin + "/api/shutdown", {
      method: "POST",
      headers: {
        "x-session-token": running.status.token,
        Origin: running.origin,
      },
    });
    assert.equal(response.status, 200);
    const result = await Promise.race([
      exited,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(Error("배포 서버 종료 시간 초과")),
          5000,
        ).unref(),
      ),
    ]);
    assert.equal(result[0], 0);
    await assert.rejects(readFile(path.join(data, "instance.json")), {
      code: "ENOENT",
    });
    await assert.rejects(
      fetch(running.origin + "/api/status", {
        signal: AbortSignal.timeout(1000),
      }),
    );
  }
  try {
    await buildServer(entry);
    assert.deepEqual((await readdir(path.join(root, "app"))).sort(), [
      "package.json",
      "server",
    ]);
    const licenses = await readFile(
      path.join(path.dirname(entry), "THIRD_PARTY_LICENSES.txt"),
      "utf8",
    );
    assert.match(licenses, /fastify/);
    const first = await start();
    assert.equal(first.status.hasKey, false);
    assert.match(await (await fetch(first.origin)).text(), /Mayhem Pocket/);
    assert.match(
      await (await fetch(first.origin + "/assets/test.js")).text(),
      /static asset/,
    );
    assert.match(
      await (await fetch(first.origin + "/some/client/route")).text(),
      /Mayhem Pocket/,
    );
    assert.equal((await fetch(first.origin + "/api/missing")).status, 404);
    assert.equal(
      (await (await fetch(first.origin + "/api/champions")).json())[0].id,
      8,
    );
    assert.equal(
      (await (await fetch(first.origin + "/api/augment-descriptions")).json())
        .data[0].topChampions[0].id,
      8,
    );
    assert.equal(
      (await fetch(first.origin + "/api/shutdown", { method: "POST" })).status,
      403,
    );
    assert.equal(
      (
        await fetch(first.origin + "/api/settings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": first.status.token,
            Origin: first.origin,
          },
          body: JSON.stringify({ theme: "light" }),
        })
      ).status,
      200,
    );
    await stop(first);
    const second = await start();
    assert.equal(
      (await (await fetch(second.origin + "/api/settings")).json()).theme,
      "light",
    );
    await stop(second);
  } finally {
    for (const child of children)
      if (child.exitCode === null) {
        const exit = once(child, "exit");
        child.kill();
        await exit;
      }
    await rm(temporary, { recursive: true, force: true });
  }
});
