import { readFile } from "node:fs/promises";
try {
  const s = JSON.parse(
    await readFile(new URL("../cache/instance.json", import.meta.url), "utf8"),
  );
  const origin = `http://127.0.0.1:${s.port}`;
  const r = await fetch(origin + "/api/status", {
    signal: AbortSignal.timeout(2000),
  });
  const info = await r.json();
  if (info.token !== s.token) throw Error("실행 중인 앱이 일치하지 않습니다.");
  const result = await fetch(origin + "/api/shutdown", {
    method: "POST",
    headers: { "x-session-token": s.token, Origin: origin },
  });
  if (!result.ok) throw Error("종료 요청에 실패했습니다.");
  console.log("Mayhem Pocket 종료 완료");
} catch (e) {
  console.log("실행 중인 앱이 없거나 연결할 수 없습니다:", e.message);
  process.exitCode = 1;
}
