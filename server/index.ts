import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { config as loadEnv } from "dotenv";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  stat,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { rawDetail } from "./normalize";
const root = process.cwd();
loadEnv({ path: path.join(root, ".env"), quiet: true } as any);
const cache = path.join(root, "cache");
await mkdir(cache, { recursive: true });
const token = randomBytes(24).toString("hex");
const app = Fastify({ logger: false });
const read = async (p: string, f: any = null) => {
  try {
    return JSON.parse(await readFile(path.join(cache, p), "utf8"));
  } catch {
    return f;
  }
};
async function save(p: string, v: any) {
  const target = path.join(cache, p);
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = target + ".tmp";
  await writeFile(tmp, JSON.stringify(v));
  await rename(tmp, target);
}
let catalog: any = await read("catalog.json");
let credits: any = await read("credits.json");
let remote: any = null;
let lastCall = 0;
let active = false;
let cancel = false;
let job: any = { running: false, done: 0, total: 0, message: "" };
function remaining() {
  return credits?.day === new Date().toISOString().slice(0, 10)
    ? credits.remaining
    : 200;
}
async function upstream(resource: string, cost = 0) {
  if (cost && !process.env.ARAMGG_API_KEY)
    throw Error(".env에 ARAMGG_API_KEY를 설정하고 다시 실행하세요.");
  if (cost && remaining() < cost)
    throw Error("오늘 무료 할당량이 부족합니다. 기존 캐시를 사용합니다.");
  const wait = Math.max(0, 1100 - (Date.now() - lastCall));
  await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const res = await fetch("https://data.dtodo.cn/api/v1/ko/" + resource, {
    headers: cost
      ? { Authorization: "Bearer " + process.env.ARAMGG_API_KEY }
      : {},
    signal: AbortSignal.timeout(25000),
  });
  if (res.headers.has("x-credits-remaining")) {
    credits = {
      remaining: Number(res.headers.get("x-credits-remaining")),
      daily: Number(res.headers.get("x-credits-daily")),
      day: new Date().toISOString().slice(0, 10),
    };
    await save("credits.json", credits);
  }
  if (res.status === 429)
    throw Error("API 할당량 또는 요청 제한에 도달했습니다. 나중에 재개하세요.");
  if (!res.ok) throw Error(`데이터 요청 실패 (${res.status})`);
  return res.json() as Promise<any>;
}
app.addHook("onRequest", async (req, reply) => {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    return reply.code(403).send({ error: "허용되지 않은 호스트" });
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (
      origin &&
      !new Set([
        `http://${host}`,
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ]).has(origin)
    )
      return reply.code(403).send({ error: "허용되지 않은 요청" });
    if (req.headers["x-session-token"] !== token)
      return reply.code(403).send({ error: "세션을 새로 열어주세요." });
  }
});
app.setErrorHandler((err, req, reply) => {
  reply
    .code(400)
    .send({ error: err instanceof Error ? err.message : "요청 실패" });
});
app.get("/api/status", async () => ({
  token,
  hasKey: !!process.env.ARAMGG_API_KEY,
  credits: remaining(),
  creditsEstimated: credits?.day !== new Date().toISOString().slice(0, 10),
  catalogVersion: catalog?.meta?.dataVersion,
  remoteVersion: remote?.dataVersion,
  job,
}));
app.get("/api/champions", async () => catalog?.data ?? []);
app.post("/api/check", async () => {
  remote = await upstream("config.json");
  return remote;
});
app.post("/api/catalog", async () => {
  if (active) throw Error("다른 다운로드가 진행 중입니다.");
  active = true;
  try {
    const c = await upstream("champions.json", 1);
    if (!Array.isArray(c.data)) throw Error("챔피언 목록 형식 오류");
    await save("catalog.json", c);
    catalog = c;
    return { ok: true };
  } finally {
    active = false;
  }
});
app.get("/api/champions/:id", async (req) => {
  const { id } = req.params as any;
  if (!/^\d+$/.test(id)) throw Error("잘못된 챔피언");
  const full = await read(`details/${id}.json`);
  const raw = await read(`raw-details/${id}.json`);
  const version = catalog?.meta?.dataVersion;
  return (
    (full?.meta?.dataVersion === version
      ? full
      : raw?.meta?.dataVersion === version
        ? raw
        : (full ?? raw)) ?? { missing: true }
  );
});
app.post("/api/champions/:id/download", async (req) => {
  const { id } = req.params as any;
  if (!/^\d+$/.test(id)) throw Error("잘못된 챔피언");
  if (active) throw Error("다른 다운로드가 진행 중입니다.");
  const existing = await read(`details/${id}.json`);
  if (
    existing?.meta?.dataVersion ===
    (remote?.dataVersion ?? catalog?.meta?.dataVersion)
  )
    return existing;
  active = true;
  try {
    const d = await upstream(`champions/${id}.json`, 2);
    if (d.data?.champion?.id !== Number(id) || !Array.isArray(d.data.augments))
      throw Error("상세 형식 오류");
    await save(`details/${id}.json`, d);
    return d;
  } finally {
    active = false;
  }
});
app.post("/api/sync", async () => {
  if (active) throw Error("다른 다운로드가 진행 중입니다.");
  if (!catalog) throw Error("챔피언 목록을 먼저 받으세요.");
  active = true;
  cancel = false;
  job = {
    running: true,
    done: 0,
    total: catalog.data.length,
    message: "증강 통계 동기화",
  };
  void (async () => {
    try {
      const version = catalog.meta.dataVersion;
      let base = await read("augments.json");
      if (base?.meta?.dataVersion !== version) {
        base = await upstream("augments.json", 1);
        await save("augments.json", base);
      }
      for (const champ of catalog.data) {
        if (cancel) break;
        const old = await read(`raw-details/${champ.id}.json`);
        if (old?.meta?.dataVersion !== version) {
          if (remaining() <= 20) {
            job.message =
              "상세 조회용 20 credits를 남기고 중단했습니다. 다음 날 재개하세요.";
            break;
          }
          const raw = await upstream(
            `data/champion-augments/${champ.id}.json`,
            1,
          );
          const d = rawDetail(raw, champ, base.data);
          await save(`raw-details/${champ.id}.json`, {
            meta: catalog.meta,
            data: d,
          });
        }
        job.done++;
      }
      if (job.done === job.total) job.message = "전체 증강 캐시 완료";
      else if (cancel) job.message = "중단했습니다. 다시 누르면 이어받습니다.";
    } catch (e) {
      job.message = (e as Error).message;
    } finally {
      active = false;
      job.running = false;
    }
  })();
  return { ok: true };
});
app.post("/api/cancel", async () => {
  cancel = true;
  return { ok: true };
});
app.get("/api/image", async (req, reply) => {
  const { url } = req.query as any;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return reply.code(400).send();
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "cdn.dtodo.cn" ||
    u.port ||
    u.username ||
    u.password ||
    !u.pathname.startsWith("/hextech/")
  )
    return reply.code(403).send();
  const file = path.join(
    cache,
    "images",
    createHash("sha256").update(u.href).digest("hex"),
  );
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch {
    const r = await fetch(u, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return reply.code(404).send();
    const type = r.headers.get("content-type") ?? "";
    if (!/^image\/(png|jpeg|webp)/.test(type)) return reply.code(415).send();
    bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > 2_000_000) return reply.code(413).send();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  reply
    .header("Content-Type", "image/png")
    .header("Cache-Control", "public, max-age=31536000");
  return bytes;
});
app.post("/api/shutdown", async (req, reply) => {
  cancel = true;
  reply.send({ ok: true });
  setTimeout(() => void app.close().then(() => process.exit(0)), 500);
});
const web = path.join(root, "dist/web");
if (existsSync(web)) {
  await app.register(staticPlugin, { root: web });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/")
      ? reply.code(404).send()
      : reply.sendFile("index.html"),
  );
}
// Recorded sample is deliberately opt-in for development and never packaged.
if (
  process.env.MAYHEM_SEED === "1" &&
  !catalog &&
  existsSync("data/api-tests/vladimir-ko-detail.json")
) {
  const sample = JSON.parse(
    await readFile("data/api-tests/vladimir-ko-detail.json", "utf8"),
  );
  catalog = { meta: sample.meta, data: [sample.data.champion] };
  await save("catalog.json", catalog);
  await save("details/8.json", sample);
}
const instanceFile = path.join(cache, "instance.json");
app.addHook("onClose", async () => {
  const i = await read("instance.json");
  if (i?.token === token) await unlink(instanceFile).catch(() => {});
});
if (process.argv.includes("--open")) {
  const old = await read("instance.json");
  if (old) {
    try {
      const r = await fetch(`http://127.0.0.1:${old.port}/api/status`, {
        signal: AbortSignal.timeout(1000),
      });
      const s: any = await r.json();
      if (s.token === old.token) {
        execFile("cmd.exe", [
          "/c",
          "start",
          "",
          `http://127.0.0.1:${old.port}`,
        ]);
        process.exit(0);
      }
    } catch {}
  }
}
let port = Number(process.env.PORT ?? 4318);
for (let tries = 0; ; tries++) {
  try {
    await app.listen({ host: "127.0.0.1", port });
    break;
  } catch (e) {
    if ((e as any).code !== "EADDRINUSE" || tries > 10) throw e;
    port++;
  }
}
await save("instance.json", { port, token, pid: process.pid });
console.log(`Mayhem Pocket: http://127.0.0.1:${port}`);
if (process.argv.includes("--open"))
  execFile("cmd.exe", ["/c", "start", "", `http://127.0.0.1:${port}`]);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    cancel = true;
    void app.close().then(() => process.exit(0));
  });
