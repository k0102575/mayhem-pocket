import Fastify from "fastify";
import staticPlugin from "@fastify/static";
import { config as loadEnv } from "dotenv";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { rawDetail } from "./normalize";
import {
  chooseDetail,
  creditState,
  keyId,
  stamp,
  assertVersion,
  sanitizeSettings,
} from "./cache-policy";
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
  const tmp = target + "." + randomBytes(6).toString("hex") + ".tmp";
  await writeFile(tmp, JSON.stringify(v));
  await rename(tmp, target);
}
let catalog: any = await read("catalog.json");
let credits: any = await read("credits.json");
let remote: any = null;
let checkedAt: string | null = null;
let checkError: string | null = null;
const apiKey = process.env.ARAMGG_API_KEY ?? "";
const creditView = () => creditState(credits, apiKey);
async function saveEnvelope(p: string, d: any) {
  const value = stamp(d);
  const v = encodeURIComponent(value.meta?.dataVersion ?? "unknown");
  await save(`versions/${v}/${p}`, value);
  await save(p, value);
  return value;
}
async function checkRemote() {
  try {
    remote = await upstream("config.json");
    if (typeof remote?.dataVersion !== "string")
      throw Error("버전 정보 형식 오류");
    checkedAt = new Date().toISOString();
    checkError = null;
    return remote;
  } catch (e) {
    checkError = (e as Error).message;
    throw e;
  }
}
let lastCall = 0;
let active = false;
let cancel = false;
let job: any = { running: false, done: 0, total: 0, message: "" };
function remaining() {
  return creditView().remaining;
}
async function upstream(resource: string, cost = 0) {
  if (cost && !process.env.ARAMGG_API_KEY)
    throw Error(".env에 ARAMGG_API_KEY를 설정하고 다시 실행하세요.");
  if (cost && remaining() < cost)
    throw Error("오늘 무료 할당량이 부족합니다. 기존 캐시를 사용합니다.");
  const wait = Math.max(0, 1100 - (Date.now() - lastCall));
  await new Promise((r) => setTimeout(r, wait));
  if (cost && job.running && cancel)
    throw Error("수집을 중단했습니다. 다시 누르면 이어받습니다.");
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
      keyId: keyId(apiKey),
      checkedAt: new Date().toISOString(),
    };
    await save("credits.json", credits);
  }
  if (res.status === 401)
    throw Error(
      "API 키 인증에 실패했습니다. .env의 키를 확인하고 재실행하세요.",
    );
  if (res.status === 429)
    throw Error(
      remaining() === 0
        ? "오늘 할당량을 소진했습니다. 한국 시간 오전 9시 이후 재개하세요."
        : "요청 속도가 제한되었습니다. 잠시 후 다시 시도하세요. 기존 캐시는 유지됩니다.",
    );
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
  creditsEstimated: creditView().estimated,
  creditsCheckedAt: creditView().checkedAt,
  checkedAt,
  checkError,
  catalogDownloadedAt: catalog?.cache?.downloadedAt ?? null,
  catalogStatsDate: catalog?.meta?.generatedAt ?? null,
  catalogVersion: catalog?.meta?.dataVersion,
  remoteVersion: remote?.dataVersion,
  job,
}));
app.get("/api/champions", async () => catalog?.data ?? []);
app.post("/api/check", async () => {
  return checkRemote();
});
async function ensureCatalog(target: string) {
  if (catalog?.meta?.dataVersion === target) return false;
  const c = await upstream("champions.json", 1);
  assertVersion(c, target);
  if (!Array.isArray(c.data) || !c.data.length)
    throw Error("챔피언 목록 형식 오류");
  const verified = await checkRemote();
  if (verified.dataVersion !== target)
    throw Error("목록 수집 중 버전이 변경되었습니다. 다시 시도하세요.");
  catalog = await saveEnvelope("catalog.json", c);
  return true;
}
app.post("/api/catalog", async () => {
  if (active) throw Error("다른 다운로드가 진행 중입니다.");
  active = true;
  try {
    const c = await checkRemote();
    const downloaded = await ensureCatalog(c.dataVersion);
    return { ok: true, downloaded };
  } finally {
    active = false;
  }
});
app.get("/api/champions/:id", async (req) => {
  const { id } = req.params as any;
  if (!/^\d+$/.test(id)) throw Error("잘못된 챔피언");
  return chooseDetail(
    await read(`details/${id}.json`),
    await read(`raw-details/${id}.json`),
  );
});
app.post("/api/champions/:id/download", async (req) => {
  const { id } = req.params as any;
  if (!/^\d+$/.test(id)) throw Error("잘못된 챔피언");
  if (active) throw Error("다른 다운로드가 진행 중입니다.");
  active = true;
  try {
    const c = await checkRemote();
    const existing = await read(`details/${id}.json`);
    if (existing?.meta?.dataVersion === c.dataVersion)
      return { ...existing, reused: true };
    const d = await upstream(`champions/${id}.json`, 2);
    assertVersion(d, c.dataVersion);
    if (d.data?.champion?.id !== Number(id) || !Array.isArray(d.data.augments))
      throw Error("상세 형식 오류");
    const end = await checkRemote();
    if (end.dataVersion !== c.dataVersion)
      throw Error(
        "상세 수집 중 버전이 변경되었습니다. 기존 캐시를 사용하세요.",
      );
    return saveEnvelope(`details/${id}.json`, d);
  } finally {
    active = false;
  }
});
app.post("/api/sync/plan", async () => {
  if (active) throw Error("다른 다운로드가 진행 중입니다.");
  const c = await checkRemote();
  let needed = 0;
  if (catalog?.meta?.dataVersion !== c.dataVersion)
    return {
      version: c.dataVersion,
      needsCatalog: true,
      cost: null,
      remaining: remaining(),
      message:
        "목록을 먼저 자동 갱신합니다(최대 1 credit). 이후 필요한 증강만 수집하며 상세용 20 credits를 남깁니다. 목록 변경 전에는 정확한 총비용을 계산할 수 없습니다.",
    };
  for (const champ of catalog.data) {
    const full = await read(`details/${champ.id}.json`);
    const raw = await read(`raw-details/${champ.id}.json`);
    if (
      full?.meta?.dataVersion !== c.dataVersion &&
      raw?.meta?.dataVersion !== c.dataVersion
    )
      needed++;
  }
  const base = await read("augments.json");
  return {
    version: c.dataVersion,
    needed,
    cost:
      needed + (needed && base?.meta?.dataVersion !== c.dataVersion ? 1 : 0),
    remaining: remaining(),
    reserve: 20,
  };
});
app.post("/api/sync", async () => {
  if (active) throw Error("다른 다운로드가 진행 중입니다.");
  active = true;
  cancel = false;
  job = { running: true, done: 0, total: 0, message: "최신 버전 확인 중" };
  void (async () => {
    try {
      const c = await checkRemote();
      const version = c.dataVersion;
      if (remaining() <= 20)
        throw Error(
          "상세 조회용 20 credits를 남기고 중단했습니다. 다음 날 재개하세요.",
        );
      await ensureCatalog(version);
      job.total = catalog.data.length;
      job.message = "증강 통계 동기화";
      let base = await read("augments.json");
      for (const champ of catalog.data) {
        if (cancel) break;
        const full = await read(`details/${champ.id}.json`);
        const raw = await read(`raw-details/${champ.id}.json`);
        if (
          full?.meta?.dataVersion !== version &&
          raw?.meta?.dataVersion !== version
        ) {
          if (remaining() <= 20) {
            job.message =
              "상세 조회용 20 credits를 남기고 중단했습니다. 다음 날 재개하세요.";
            break;
          }
          if (base?.meta?.dataVersion !== version) {
            base = await upstream("augments.json", 1);
            assertVersion(base, version);
            if (!Array.isArray(base.data)) throw Error("증강 목록 형식 오류");
            base = await saveEnvelope("augments.json", base);
          }
          if (remaining() <= 20) {
            job.message = "상세 조회용 20 credits를 남기고 중단했습니다.";
            break;
          }
          const payload = await upstream(
            `data/champion-augments/${champ.id}.json`,
            1,
          );
          const data = rawDetail(payload, champ, base.data);
          const verified = await checkRemote();
          if (verified.dataVersion !== version)
            throw Error(
              "수집 중 버전이 변경되었습니다. 완료한 캐시는 보존했고 다시 갱신할 수 있습니다.",
            );
          await saveEnvelope(`raw-details/${champ.id}.json`, {
            meta: { ...catalog.meta, statsDate: data.statsDate },
            data,
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
app.get("/api/settings", async () => {
  const value = await read("settings.json");
  return value ? sanitizeSettings(value) : null;
});
app.post("/api/settings", async (req) => {
  const value = sanitizeSettings(req.body);
  await save("settings.json", value);
  return value;
});
app.post("/api/cancel", async () => {
  cancel = true;
  return { ok: true };
});
app.post("/api/images/reset", async () => {
  await rm(path.join(cache, "images"), { recursive: true, force: true });
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
  let mime = "image/png";
  try {
    bytes = await readFile(file);
    const info = await read(`images/${path.basename(file)}.json`);
    mime =
      info?.mime ??
      (bytes[0] === 0xff
        ? "image/jpeg"
        : bytes.toString("ascii", 0, 4) === "RIFF"
          ? "image/webp"
          : "image/png");
    if (!bytes.length) throw Error("빈 이미지 캐시");
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
    mime = type.split(";")[0];
    const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
    await writeFile(tmp, bytes);
    await rename(tmp, file);
    await save(`images/${path.basename(file)}.json`, {
      mime,
      downloadedAt: new Date().toISOString(),
    });
  }
  reply
    .header("Content-Type", mime)
    .header("Cache-Control", "private, max-age=86400");
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
const bound = app.server.address();
if (bound && typeof bound !== "string") port = bound.port;
await save("instance.json", { port, token, pid: process.pid });
console.log(`Mayhem Pocket: http://127.0.0.1:${port}`);
if (process.argv.includes("--open"))
  execFile("cmd.exe", ["/c", "start", "", `http://127.0.0.1:${port}`]);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    cancel = true;
    void app.close().then(() => process.exit(0));
  });
