import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  RefreshCw,
  Power,
  Star,
  Download,
  ArrowUpRight,
  Layers3,
  WifiOff,
  ChevronRight,
  ShieldCheck,
  PackageOpen,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { validRate } from "../server/normalize";
const pct = (n: any) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1
    ? `${(n * 100).toFixed(2)}%`
    : "—";
const count = (n: any) => (typeof n === "number" ? n.toLocaleString() : "—");
const initials = (s: string) =>
  [...s]
    .map((c) => {
      const n = c.charCodeAt(0) - 44032;
      return n >= 0 && n <= 11171
        ? "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor(n / 588)]
        : c;
    })
    .join("");
function matches(s: string, q: string) {
  return s.toLowerCase().includes(q.toLowerCase()) || initials(s).includes(q);
}
function Icon({
  url,
  name,
  size = 40,
}: {
  url?: string;
  name: string;
  size?: number;
}) {
  const [bad, setBad] = useState(false);
  return url && !bad ? (
    <img
      loading="lazy"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="game-icon"
      src={"/api/image?url=" + encodeURIComponent(url)}
      alt={name}
      onError={() => setBad(true)}
    />
  ) : (
    <span className="icon-fallback" style={{ width: size, height: size }}>
      {name.slice(0, 1)}
    </span>
  );
}
function useSaved<T>(key: string, fallback: T) {
  const [v, set] = useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(v)), [key, v]);
  return [v, set] as const;
}
export default function App() {
  const [status, S] = useState<any>({});
  const [champs, C] = useState<any[]>([]);
  const [id, I] = useSaved<number | null>("champion", null);
  const [tab, T] = useSaved("tab", "augments");
  const [favs, F] = useSaved<number[]>("favorites", []);
  const [recent, R] = useSaved<number[]>("recent", []);
  const [q, Q] = useState("");
  const [aq, AQ] = useState("");
  const [rarity, RR] = useSaved("rarity", "all");
  const [sort, SS] = useSaved("sort", "rank");
  const [buildSort, BS] = useSaved("buildSort", "pickRate");
  const [detail, D] = useState<any>(null);
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  const [notice, N] = useState("");
  const [ended, END] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef(id);
  selection.current = id;
  async function api(url: string, body?: object) {
    const r = await fetch(
      "/api" + url,
      body
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Session-Token": status.token,
            },
            body: JSON.stringify(body),
          }
        : undefined,
    );
    const d = await r.json();
    if (!r.ok) throw Error(d.error ?? "요청에 실패했습니다.");
    return d;
  }
  async function refresh() {
    const [s, c] = await Promise.all([api("/status"), api("/champions")]);
    S(s);
    C(c);
  }
  useEffect(() => {
    void refresh().catch(() =>
      E("로컬 서버에 연결할 수 없습니다. 실행.cmd를 다시 실행하세요."),
    );
    const key = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape") {
        input.current?.blur();
        Q("");
        AQ("");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!status.token) return;
    void api("/check", {})
      .then(() => refresh())
      .catch(() => N("오프라인 · 저장된 데이터로 이용할 수 있습니다."));
  }, [status.token]);
  useEffect(() => {
    if (!id) {
      D(null);
      return;
    }
    D(null);
    AQ("");
    void api("/champions/" + id)
      .then((d) => {
        if (selection.current === id) D(d);
      })
      .catch((e) => E(e.message));
  }, [id, status.job?.done]);
  useEffect(() => {
    if (!status.job?.running) return;
    const t = setInterval(() => void refresh(), 1800);
    return () => clearInterval(t);
  }, [status.job?.running]);
  async function action(fn: () => Promise<void>) {
    B(true);
    E("");
    try {
      await fn();
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
      await refresh().catch(() => {});
    }
  }
  function select(n: number) {
    I(n);
    R([n, ...recent.filter((x) => x !== n)].slice(0, 8));
  }
  const filtered = useMemo(
    () =>
      champs
        .filter((c) => matches(c.name ?? "", q) || matches(c.alias ?? "", q))
        .sort(
          (a, b) =>
            Number(favs.includes(b.id)) - Number(favs.includes(a.id)) ||
            (b.stats?.winRate ?? -1) - (a.stats?.winRate ?? -1),
        ),
    [champs, q, favs],
  );
  const d = detail?.data;
  const champ = d?.champion ?? champs.find((c) => c.id === id);
  const augments = useMemo(
    () =>
      [...(d?.augments ?? [])]
        .filter(
          (a) =>
            (rarity === "all" || a.rarityName === rarity) &&
            matches(a.name ?? String(a.id), aq),
        )
        .sort((a, b) =>
          sort === "winRate"
            ? (validRate(b.stats) ?? -1) - (validRate(a.stats) ?? -1)
            : (a.stats?.rank ?? 9999) - (b.stats?.rank ?? 9999),
        ),
    [d, rarity, aq, sort],
  );
  if (ended)
    return (
      <main className="ended">
        <Layers3 size={48} />
        <h1>Mayhem Pocket을 종료했습니다.</h1>
        <p>이 탭을 닫아도 됩니다. 다시 사용하려면 실행.cmd를 눌러주세요.</p>
      </main>
    );
  return (
    <div className="shell">
      <header>
        <a className="brand" href="#">
          <span className="brand-icon">
            <Layers3 size={22} />
          </span>
          <span>
            MAYHEM <strong>POCKET</strong>
            <small>작게 켜두는 아수라장 도감</small>
          </span>
        </a>
        <div className="header-right">
          <span className="local">
            <i /> LOCAL
          </span>
          <Button
            variant="ghost"
            title="프로그램 종료"
            onClick={() =>
              void action(async () => {
                await api("/shutdown", {});
                END(true);
              })
            }
          >
            <Power size={16} />
            종료
          </Button>
        </div>
      </header>
      <section className="intro">
        <div>
          <div className="eyebrow">ARAM: MAYHEM COMPANION</div>
          <h1>다음 선택을, 조금 더 쉽게.</h1>
          <p>챔피언에 맞는 증강과 빌드를 빠르게 찾아보세요.</p>
        </div>
        <div className="sync-panel">
          <span className="muted">
            캐시 {status.catalogVersion ?? "없음"}{" "}
            <span className="separator">/</span>{" "}
            {status.creditsEstimated ? "예상 잔여" : "잔여"}{" "}
            <strong>{status.credits ?? "—"}</strong> credits
          </span>
          <div className="sync-buttons">
            <Button
              variant="outline"
              disabled={busy || status.job?.running || !status.hasKey}
              onClick={() =>
                void action(async () => {
                  await api("/catalog", {});
                  N("챔피언 목록을 저장했습니다.");
                })
              }
            >
              <RefreshCw size={14} />
              목록 갱신 · 1
            </Button>
            <Button
              variant="outline"
              disabled={busy || !champs.length || !status.hasKey}
              onClick={() =>
                void action(async () => {
                  if (status.job?.running) await api("/cancel", {});
                  else await api("/sync", {});
                })
              }
            >
              <Download size={14} />
              {status.job?.running ? "수집 중단" : "전체 증강 받기"}
            </Button>
          </div>
        </div>
      </section>
      {!status.hasKey && (
        <div className="alert">
          최초 설정: .env.example을 .env로 복사하고 ARAMGG_API_KEY를 입력한 뒤
          다시 실행하세요.
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => E("")}>닫기</button>
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      {status.job?.message && (
        <div className="notice">
          {status.job.message} {status.job.done}/{status.job.total}
          {status.job.running && (
            <progress value={status.job.done} max={status.job.total} />
          )}
        </div>
      )}
      <main className="workspace">
        <aside>
          <div className="search">
            <Search size={17} />
            <input
              ref={input}
              value={q}
              onChange={(e) => Q(e.target.value)}
              placeholder="챔피언 검색 · 이름, 초성, 영문"
              aria-label="챔피언 검색"
            />
            <kbd>/</kbd>
          </div>
          {recent.length > 0 && !q && (
            <div className="recent">
              <span>최근</span>
              {recent
                .map((n) => champs.find((c) => c.id === n))
                .filter(Boolean)
                .slice(0, 3)
                .map((c) => (
                  <button key={c.id} onClick={() => select(c.id)}>
                    {c.name}
                  </button>
                ))}
            </div>
          )}
          <div className="list-head">
            <span>
              챔피언 <b>{filtered.length}</b>
            </span>
            <span>승률</span>
          </div>
          <div className="champion-list">
            {filtered.map((c) => (
              <button
                className={"champion-row " + (id === c.id ? "selected" : "")}
                key={c.id}
                onClick={() => select(c.id)}
              >
                <Icon url={c.iconUrl} name={c.name} />
                <span className="champion-label">
                  {c.name}
                  <small>{c.title}</small>
                </span>
                {favs.includes(c.id) && <Star size={12} className="gold" />}
                <span className="champion-rate">{pct(c.stats?.winRate)}</span>
                <ChevronRight size={14} />
              </button>
            ))}
            {!filtered.length && (
              <div className="empty-small">
                {champs.length
                  ? "검색 결과가 없습니다."
                  : "목록 갱신을 눌러 시작하세요."}
              </div>
            )}
          </div>
          <div className="aside-bottom">
            <ShieldCheck size={14} />
            저장된 데이터 우선 · 광고 없음
          </div>
        </aside>
        <section className="detail">
          {!id ? (
            <div className="empty">
              <span className="empty-symbol">
                <Search size={36} />
              </span>
              <h2>어떤 챔피언을 플레이하나요?</h2>
              <p>
                왼쪽에서 챔피언을 선택하면
                <br />
                추천 증강과 빌드를 확인할 수 있습니다.
              </p>
              <span className="tag">이름 대신 초성으로도 검색할 수 있어요</span>
            </div>
          ) : (
            <>
              <div className="champion-header">
                <Icon
                  url={champ?.iconUrl}
                  name={champ?.name ?? "?"}
                  size={64}
                />
                <div className="champion-title">
                  <div className="eyebrow">{champ?.alias ?? "CHAMPION"}</div>
                  <h2>
                    {champ?.name ?? "불러오는 중"}
                    <button
                      className={
                        "favorite " + (favs.includes(id) ? "gold" : "")
                      }
                      aria-label="즐겨찾기"
                      onClick={() =>
                        F(
                          favs.includes(id)
                            ? favs.filter((n) => n !== id)
                            : [...favs, id],
                        )
                      }
                    >
                      <Star
                        size={19}
                        fill={favs.includes(id) ? "currentColor" : "none"}
                      />
                    </button>
                  </h2>
                  <span>
                    {champ?.title} · API 티어 {champ?.stats?.tier ?? "—"}
                  </span>
                </div>
                <div className="metric">
                  <small>챔피언 승률</small>
                  <strong>{pct(champ?.stats?.winRate)}</strong>
                  <span>CN · Tencent</span>
                </div>
                <Button
                  variant="outline"
                  disabled={busy || status.job?.running || !status.hasKey}
                  onClick={() =>
                    void action(async () => {
                      const selected = id;
                      const result = await api(
                        `/champions/${selected}/download`,
                        {},
                      );
                      if (selection.current === selected) D(result);
                    })
                  }
                >
                  <Download size={14} />
                  상세 받기 · 2
                </Button>
              </div>
              <div className="tabs">
                <button
                  className={tab === "augments" ? "active" : ""}
                  onClick={() => T("augments")}
                >
                  <Layers3 size={16} />
                  증강 순위 <span>{d?.augments?.length ?? 0}</span>
                </button>
                <button
                  className={tab === "builds" ? "active" : ""}
                  onClick={() => T("builds")}
                >
                  <PackageOpen size={16} />
                  아이템 빌드 <span>{d?.builds?.length ?? 0}</span>
                </button>
              </div>
              {!detail ? (
                <div className="empty-small">저장된 정보를 읽고 있습니다…</div>
              ) : detail.missing ? (
                <div className="empty">
                  <Download size={32} />
                  <h2>아직 저장된 상세 정보가 없습니다.</h2>
                  <p>
                    상세 받기를 누르면 증강과 빌드를 함께 저장합니다.
                    <br />한 번 받은 정보는 오프라인에서도 볼 수 있어요.
                  </p>
                </div>
              ) : (
                <>
                  <div className="data-note">
                    패치 {detail.meta?.gamePatch} · 캐시{" "}
                    {detail.meta?.dataVersion}
                    {detail.meta?.dataVersion !== status.catalogVersion
                      ? " · 이전 버전"
                      : ""}
                    <span>추천 순위 CN / 증강 승률 WORLD 업로드 표본</span>
                  </div>
                  {tab === "augments" ? (
                    <>
                      <div className="filters">
                        <div className="pills">
                          {[
                            ["all", "전체"],
                            ["silver", "실버"],
                            ["gold", "골드"],
                            ["prismatic", "프리즘"],
                          ].map(([v, n]) => (
                            <button
                              className={rarity === v ? "active " + v : ""}
                              key={v}
                              onClick={() => RR(v)}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                        <select
                          aria-label="증강 정렬"
                          value={sort}
                          onChange={(e) => SS(e.target.value)}
                        >
                          <option value="rank">추천 순위순</option>
                          <option value="winRate">승률순</option>
                        </select>
                      </div>
                      <div className="augment-search search">
                        <Search size={16} />
                        <input
                          value={aq}
                          onChange={(e) => AQ(e.target.value)}
                          placeholder="지금 나온 증강을 검색해 보세요"
                          aria-label="증강 검색"
                        />
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>추천</th>
                              <th>증강</th>
                              <th>승률</th>
                              <th>표본</th>
                            </tr>
                          </thead>
                          <tbody>
                            {augments.map((a) => (
                              <tr key={a.id}>
                                <td>
                                  <span
                                    className={
                                      "rank " +
                                      (a.stats?.rank <= 3 ? "top" : "")
                                    }
                                  >
                                    {a.stats?.rank ?? "—"}
                                  </span>
                                </td>
                                <td>
                                  <div className="augment-name">
                                    <Icon
                                      url={a.iconUrl}
                                      name={a.name ?? String(a.id)}
                                      size={36}
                                    />
                                    <div>
                                      {a.name ?? a.id}
                                      <small className={a.rarityName}>
                                        {a.rarityDisplayName ?? a.rarityName}
                                      </small>
                                    </div>
                                  </div>
                                </td>
                                <td className="rate">
                                  {pct(validRate(a.stats))}
                                </td>
                                <td className="muted">
                                  {count(a.stats?.games)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!augments.length && (
                          <div className="empty-small">
                            조건에 맞는 증강이 없습니다.
                          </div>
                        )}
                      </div>
                      {d.augmentTrios?.length > 0 && (
                        <section className="trios">
                          <h3>증강 조합 참고</h3>
                          {d.augmentTrios.map((t: any, i: number) => (
                            <div key={i}>
                              <span>
                                {t.augments
                                  ?.map((a: any) => a.name)
                                  .join(" + ")}
                              </span>
                              <small>
                                {pct(validRate(t.stats))} ·{" "}
                                {count(t.stats?.games)}게임
                              </small>
                            </div>
                          ))}
                        </section>
                      )}
                    </>
                  ) : (
                    <div className="build-list">
                      <div className="build-sort">
                        <select
                          aria-label="빌드 정렬"
                          value={buildSort}
                          onChange={(e) => BS(e.target.value)}
                        >
                          <option value="pickRate">사용 빈도순</option>
                          <option value="winRate">승률순</option>
                        </select>
                      </div>
                      {!d.builds?.length && (
                        <div className="empty-small">
                          빌드는 상세 받기로 다운로드할 수 있습니다.
                        </div>
                      )}
                      {[...(d.builds ?? [])]
                        .sort((a, b) =>
                          buildSort === "winRate"
                            ? (validRate(b.stats) ?? -1) -
                              (validRate(a.stats) ?? -1)
                            : (b.stats?.pickRate ?? 0) -
                              (a.stats?.pickRate ?? 0),
                        )
                        .map((b, i) => (
                          <article className="build-card" key={i}>
                            <div className="build-heading">
                              <h3>
                                <span className="build-number">0{i + 1}</span>
                                {Object.values(b.tags ?? {}).join(" · ") ||
                                  "추천 빌드"}
                              </h3>
                              <span>
                                픽률 {pct(b.stats?.pickRate)} · 승률{" "}
                                {pct(validRate(b.stats))} ·{" "}
                                {count(b.stats?.games)}게임
                              </span>
                            </div>
                            <p className="muted">
                              일반 칼바람 빌드 참고 · 사용 빈도순
                            </p>
                            {(b.coreItems ?? [])
                              .slice(0, 3)
                              .map((row: any, j: number) => (
                                <div className="item-route" key={j}>
                                  <span className="muted">{j + 1}</span>
                                  {row.items?.map((item: any, k: number) => (
                                    <div className="item-with-arrow" key={k}>
                                      <div className="item">
                                        <Icon
                                          url={item.iconUrl}
                                          name={item.name}
                                          size={42}
                                        />
                                        <small>{item.name}</small>
                                      </div>
                                      {k < row.items.length - 1 && (
                                        <ChevronRight size={14} />
                                      )}
                                    </div>
                                  ))}
                                  <span className="route-stat">
                                    {pct(validRate(row))}
                                    <small>{count(row.games)}게임</small>
                                  </span>
                                </div>
                              ))}
                            {b.situationalItems?.length > 0 && (
                              <>
                                <h4>후속 아이템 참고</h4>
                                <div className="situational">
                                  {b.situationalItems.map((x: any) => (
                                    <div title={x.name} key={x.id}>
                                      <Icon url={x.iconUrl} name={x.name} />
                                      <small>{x.name}</small>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                            {b.summonerSpells?.[0] && (
                              <div className="build-extra">
                                <span>소환사 주문</span>
                                {b.summonerSpells[0].spells?.map((s: any) => (
                                  <span key={s.id}>{s.name}</span>
                                ))}
                              </div>
                            )}
                            {b.skillOrders?.[0] && (
                              <div className="build-extra">
                                <span>스킬 순서</span>
                                <div className="skill-order">
                                  {b.skillOrders[0].skillKeys?.map(
                                    (s: string, j: number) => (
                                      <span title={`${j + 1}레벨`} key={j}>
                                        {s}
                                      </span>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                          </article>
                        ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </main>
      <footer>
        <span>
          Mayhem Pocket <b>v0.1.0</b> · 데이터:{" "}
          <a href="https://aramgg.com" target="_blank" rel="noreferrer">
            ARAMGG <ArrowUpRight size={11} />
          </a>
        </span>
        <span>
          Riot Games의 공식 서비스가 아닙니다. 게임 자산의 권리는 각 권리자에게
          있습니다.
        </span>
      </footer>
    </div>
  );
}
