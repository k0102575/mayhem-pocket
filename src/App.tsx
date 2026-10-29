import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  Search,
  RefreshCw,
  Power,
  Star,
  Download,
  LoaderCircle,
  Sun,
  Moon,
  ArrowUpRight,
  Layers3,
  ChevronRight,
  PackageOpen,
} from "lucide-react";
import { Button } from "./components/ui/button";
import {
  championTiers,
  matches,
  summaryAugments,
  summaryBuild,
  summaryCoreBuilds,
  secondarySummaryBuilds,
} from "./ui-model";
import { validRate } from "../server/normalize";
const pct = (n: any) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1
    ? `${(n * 100).toFixed(2)}%`
    : "—";
const dateTime = (value: any) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString("ko-KR")
    : "미기록";
const count = (n: any) => (typeof n === "number" ? n.toLocaleString() : "—");
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
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setBad(false);
  }, [url]);
  useEffect(() => {
    const reset = () => {
      setBad(false);
      setRetry(Date.now());
    };
    window.addEventListener("pocket-images-retry", reset);
    return () => window.removeEventListener("pocket-images-retry", reset);
  }, []);
  return url && !bad ? (
    <img
      loading="lazy"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="game-icon"
      src={
        "/api/image?url=" +
        encodeURIComponent(url) +
        (retry ? "&retry=" + retry : "")
      }
      alt={name}
      onError={() => setBad(true)}
    />
  ) : (
    <span className="icon-fallback" style={{ width: size, height: size }}>
      {name.slice(0, 1)}
    </span>
  );
}
function AugmentTable({
  augments,
  compact = false,
  empty,
}: {
  augments: any[];
  compact?: boolean;
  empty: string;
}) {
  return (
    <div className={"table-wrap" + (compact ? " compact-augments" : "")}>
      <table>
        <thead>
          <tr>
            <th>추천</th>
            <th>증강</th>
            {!compact && (
              <>
                <th>승률</th>
                <th>표본</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {augments.map((a) => (
            <tr key={a.id}>
              <td>
                <span className={"rank " + (a.stats?.rank <= 3 ? "top" : "")}>
                  {a.stats?.rank ?? "—"}
                </span>
              </td>
              <td>
                <div className="augment-name">
                  <Icon
                    url={a.iconUrl}
                    name={a.name ?? String(a.id)}
                    size={compact ? 28 : 36}
                  />
                  <div>
                    {a.name ?? a.id}
                    <small className={a.rarityName}>
                      {a.rarityDisplayName ?? a.rarityName}
                    </small>
                  </div>
                </div>
              </td>
              {!compact && (
                <>
                  <td className="rate">{pct(validRate(a.stats))}</td>
                  <td className="muted">{count(a.stats?.games)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!augments.length && <div className="empty-small">{empty}</div>}
    </div>
  );
}
function CoreItemImages({ items }: { items: any[] }) {
  return (
    <div className="overview-items">
      {items.map((item, index) => (
        <span
          key={`${item.id}-${index}`}
          title={item.name ?? String(item.id)}
          tabIndex={0}
        >
          <Icon
            url={item.iconUrl}
            name={item.name ?? String(item.id)}
            size={42}
          />
          <span className="item-tooltip">{item.name ?? item.id}</span>
        </span>
      ))}
    </div>
  );
}
const buildLabel = (build: any) =>
  Object.values(build?.tags ?? {}).join(" · ") || "추천 빌드";
function BuildPreparation({ build }: { build: any }) {
  const spellPairs = (build?.summonerSpells ?? [])
    .filter((row: any) => row.spells?.length)
    .slice(0, 2);
  const skills = build?.skillOrders?.[0]?.skillKeys ?? [];
  return (
    <div className="build-preparation">
      <div className="preparation-spells">
        <h4>소환사 주문</h4>
        {spellPairs.length ? (
          <div className="spell-pairs">
            {spellPairs.map((pair: any, index: number) => (
              <div
                className="spell-pair"
                role="group"
                aria-label={`추천 주문 조합 ${index + 1}`}
                key={index}
              >
                {pair.spells.map((spell: any) => (
                  <span key={spell.id} title={spell.name}>
                    <Icon
                      url={spell.iconUrl}
                      name={spell.name ?? String(spell.id)}
                      size={32}
                    />
                    <small>{spell.name ?? spell.id}</small>
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p>저장된 주문 정보가 없습니다.</p>
        )}
      </div>
      <div className="preparation-skills">
        <h4>스킬 순서</h4>
        {skills.length ? (
          <ol className="level-skills" aria-label="레벨별 스킬 순서">
            {skills.map((skill: string, index: number) => (
              <li key={index} title={`${index + 1}레벨 ${skill}`}>
                <small>{index + 1}</small>
                <strong>{skill}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p>저장된 스킬 정보가 없습니다.</p>
        )}
      </div>
    </div>
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
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  }, [key, v]);
  return [v, set] as const;
}
function usePreference<T>(key: string, fallback: T) {
  const [value, setValue] = useSaved<T>(key, fallback);
  const edited = useRef(false);
  const update = (next: SetStateAction<T>) => {
    edited.current = true;
    setValue(next);
  };
  const restore = (saved: T) => {
    if (!edited.current) setValue(saved);
  };
  return [value, update, restore] as const;
}
export default function App() {
  const [status, S] = useState<any>({});
  const [champs, C] = useState<any[]>([]);
  const [id, I, restoreChampion] = usePreference<number | null>(
    "champion",
    null,
  );
  const [theme, THEME, restoreTheme] = usePreference<"dark" | "light">(
    "theme",
    "dark",
  );
  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === "light" ? "light" : "dark";
  }, [theme]);
  const [tab, T, restoreTab] = usePreference("tab", "summary");
  const [favs, F, restoreFavorites] = usePreference<number[]>("favorites", []);
  const [recent, R, restoreRecent] = usePreference<number[]>("recent", []);
  const [q, Q] = useState("");
  const [aq, AQ] = useState("");
  const [rarity, RR, restoreRarity] = usePreference("rarity", "all");
  const [sort, SS, restoreSort] = usePreference("sort", "rank");
  const [buildSort, BS, restoreBuildSort] = usePreference(
    "buildSort",
    "pickRate",
  );
  const [detail, D] = useState<any>(null);
  const [downloading, DOWNLOADING] = useState<number | null>(null);
  const downloadLock = useRef(false);
  const [busy, B] = useState(false);
  const [error, E] = useState("");
  const [notice, N] = useState("");
  const [managementOpen, MANAGEMENT] = useState(false);
  const [hiddenJob, HIDEJOB] = useState("");
  const [ended, END] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [settingsError, SETTINGSERROR] = useState("");
  const [settingsReadRetry, RETRYSETTINGS] = useState(0);
  const [settingsSaveRetry, RETRYSAVE] = useState(0);
  const [settingsSavingFailed, SAVEFAILED] = useState(false);
  const [checkFailed, CHECKFAILED] = useState(false);
  const [detailError, DETAILERROR] = useState("");
  const [detailRetry, RETRYDETAIL] = useState(0);
  const detailRequest = useRef(0);
  const [settingsReady, SETTINGS] = useState(false);
  const savedSettings = useRef("");
  const [plan, PLAN] = useState<any>(null);
  const selection = useRef(id);
  selection.current = id;
  useEffect(() => {
    if (
      !notice ||
      !/완료|확인했습니다|다시 받습니다/.test(notice) ||
      /실패|중단|끊어|오프라인/.test(notice)
    )
      return;
    const timer = setTimeout(() => N(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (status.job?.running) {
      HIDEJOB("");
      return;
    }
    if (status.job?.message !== "전체 증강 캐시 완료") return;
    const timer = setTimeout(() => HIDEJOB(status.job.message), 4000);
    return () => clearTimeout(timer);
  }, [status.job?.running, status.job?.message]);
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
    let active = true;
    SETTINGS(false);
    SETTINGSERROR("");
    void api("/settings")
      .then((value) => {
        if (!active) return;
        if (value) {
          restoreChampion(value.champion);
          restoreTab(value.tab);
          if (value.theme === "light" || value.theme === "dark")
            restoreTheme(value.theme);
          restoreFavorites(value.favorites);
          restoreRecent(value.recent);
          restoreRarity(value.rarity);
          restoreSort(value.sort);
          restoreBuildSort(value.buildSort);
          savedSettings.current = JSON.stringify(value);
        }
        SETTINGS(true);
      })
      .catch(() => {
        if (active)
          SETTINGSERROR(
            "설정을 불러오지 못했습니다. 현재 선택은 브라우저에 유지되며 파일 저장은 재시도 후 재개됩니다.",
          );
      });
    return () => {
      active = false;
    };
  }, [status.token, settingsReadRetry]);
  useEffect(() => {
    if (!settingsReady || !status.token) return;
    const value = {
      champion: id,
      theme,
      tab,
      favorites: favs,
      recent,
      rarity,
      sort,
      buildSort,
    };
    const encoded = JSON.stringify(value);
    if (encoded === savedSettings.current) return;
    const timer = setTimeout(
      () =>
        void api("/settings", value)
          .then(() => {
            savedSettings.current = encoded;
            SAVEFAILED(false);
          })
          .catch(() => SAVEFAILED(true)),
      300,
    );
    return () => clearTimeout(timer);
  }, [
    settingsReady,
    settingsSaveRetry,
    status.token,
    theme,
    id,
    tab,
    favs,
    recent,
    rarity,
    sort,
    buildSort,
  ]);
  useEffect(() => {
    if (!status.token) return;
    void api("/check", {})
      .then(() => {
        CHECKFAILED(false);
        return refresh();
      })
      .catch(() => {
        CHECKFAILED(true);
        void refresh().catch(() => {});
      });
  }, [status.token]);
  useEffect(() => {
    D(null);
    DETAILERROR("");
    AQ("");
  }, [id]);
  useEffect(() => {
    const request = ++detailRequest.current;
    let active = true;
    DETAILERROR("");
    if (!id) {
      D(null);
      return;
    }
    void api("/champions/" + id)
      .then((value) => {
        if (
          active &&
          request === detailRequest.current &&
          selection.current === id
        )
          D(value);
      })
      .catch((error) => {
        if (
          active &&
          request === detailRequest.current &&
          selection.current === id
        )
          DETAILERROR(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, status.job?.done, detailRetry]);
  useEffect(() => {
    if (!status.job?.running) return;
    const t = setInterval(
      () =>
        void refresh().catch(() =>
          N("서버 연결이 끊어졌습니다. 기존 화면은 유지됩니다."),
        ),
      1800,
    );
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
  async function downloadDetail() {
    if (!id || downloadLock.current || busy || status.job?.running) return;
    const selected = id;
    const name = champs.find((c) => c.id === selected)?.name ?? "챔피언";
    downloadLock.current = true;
    DOWNLOADING(selected);
    N("");
    try {
      await action(async () => {
        const result = await api(`/champions/${selected}/download`, {});
        if (selection.current === selected) {
          ++detailRequest.current;
          DETAILERROR("");
          D(result);
        }
        N(
          `${name} 상세 ${result.reused ? "캐시를 확인했습니다" : "다운로드가 완료됐습니다"}.`,
        );
      });
    } finally {
      DOWNLOADING(null);
      downloadLock.current = false;
    }
  }
  function select(n: number) {
    I(n);
    R([n, ...recent.filter((x) => x !== n)].slice(0, 8));
  }
  const tiers = useMemo(() => championTiers(champs), [champs]);
  const filtered = useMemo(
    () =>
      champs
        .filter((c) => matches(c.name ?? "", q) || matches(c.alias ?? "", q))
        .sort(
          (a, b) =>
            Number(favs.includes(b.id)) - Number(favs.includes(a.id)) ||
            (validRate(b.stats) ?? -1) - (validRate(a.stats) ?? -1),
        ),
    [champs, q, favs],
  );
  const latestVersion =
    status.checkError || checkFailed ? null : status.remoteVersion;
  const currentVersion = detail?.meta?.dataVersion;
  const detailCurrent =
    !!latestVersion && currentVersion === latestVersion && !dRawOnly(detail);
  function dRawOnly(x: any) {
    return !!x?.data?.rawOnly || !!x?.buildStale;
  }
  const d = detail?.data;
  const champ = d?.champion ?? champs.find((c) => c.id === id);
  const augmentDates = [
    ...new Set<string>(
      (d?.augments ?? [])
        .map((a: any) => a.stats?.winRateDate)
        .filter((x: any) => typeof x === "string"),
    ),
  ].sort();
  const augmentDateText =
    augmentDates.length > 1
      ? `${augmentDates[0]} ~ ${augmentDates[augmentDates.length - 1]}`
      : (augmentDates[0] ?? "미제공");
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
  const overviewAugments = summaryAugments(d?.augments);
  const overviewCoreBuilds = summaryCoreBuilds(d?.builds);
  const overviewBuild = summaryBuild(d?.builds);
  const secondaryBuilds = secondarySummaryBuilds(d?.builds);
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
          </span>
        </a>
        <div className="header-right">
          <Button
            variant="ghost"
            aria-label={
              theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"
            }
            title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            onClick={() => THEME(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </Button>
          <Button
            variant="ghost"
            aria-expanded={managementOpen}
            aria-controls="data-management"
            onClick={() => MANAGEMENT(!managementOpen)}
          >
            데이터 관리
          </Button>
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
        <div className="sync-buttons">
          <Button
            variant="outline"
            disabled={busy || status.job?.running || !status.hasKey}
            onClick={() =>
              void action(async () => {
                await api("/catalog", {});
                N("챔피언 목록을 확인했습니다. 최신 캐시는 재사용합니다.");
              })
            }
          >
            <RefreshCw size={14} />
            {status.catalogVersion && status.catalogVersion === latestVersion
              ? "목록 확인 · 무료"
              : "목록 갱신 · 최대 1"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !champs.length || !status.hasKey}
            onClick={() =>
              void action(async () => {
                if (status.job?.running) await api("/cancel", {});
                else PLAN(await api("/sync/plan", {}));
              })
            }
          >
            <Download size={14} />
            {status.job?.running ? "수집 중단" : "전체 증강 받기"}
          </Button>
        </div>
      </section>
      <section
        id="data-management"
        className="management-panel"
        hidden={!managementOpen}
        aria-label="데이터 관리"
      >
        <div className="sync-panel">
          <span className="muted">
            캐시 {status.catalogVersion ?? "없음"}{" "}
            <span className="separator">/</span>{" "}
            {status.creditsEstimated ? "예상 잔여" : "마지막 확인 잔여"}{" "}
            <strong>{status.credits ?? "—"}</strong> credits
          </span>
        </div>
        <div className="freshness">
          <span>
            {status.checkError || checkFailed
              ? "최신 여부 확인 불가"
              : latestVersion
                ? status.catalogVersion === latestVersion
                  ? "목록 최신"
                  : "새 데이터 있음 · 목록 갱신을 눌러주세요."
                : "최신 버전 확인 중"}
          </span>
          <span>서버 {latestVersion ?? "확인 불가"}</span>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api("/check", {});
                CHECKFAILED(false);
                N("최신 버전을 다시 확인했습니다.");
              })
            }
          >
            버전 확인 · 무료
          </Button>
        </div>
        <details className="metadata global-metadata">
          <summary>목록·API 정보</summary>
          <dl>
            <div>
              <dt>목록 다운로드</dt>
              <dd>{dateTime(status.catalogDownloadedAt)}</dd>
            </div>
            <div>
              <dt>목록 제공자 생성</dt>
              <dd>{dateTime(status.catalogStatsDate)}</dd>
            </div>
            <div>
              <dt>최신 버전 확인</dt>
              <dd>{dateTime(status.checkedAt)}</dd>
            </div>
            <div>
              <dt>credits 마지막 확인</dt>
              <dd>{dateTime(status.creditsCheckedAt)}</dd>
            </div>
          </dl>
        </details>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await api("/images/reset", {});
              window.dispatchEvent(new Event("pocket-images-retry"));
              N(
                "통계는 유지하고 아이콘만 다시 받습니다. API credits는 사용하지 않습니다.",
              );
            })
          }
        >
          아이콘 다시 받기
        </Button>
      </section>
      {!managementOpen &&
        (status.checkError ||
          checkFailed ||
          (latestVersion && status.catalogVersion !== latestVersion)) && (
          <div className="update-notice">
            {status.checkError || checkFailed
              ? "최신 여부 확인 불가 · 저장된 데이터를 표시합니다."
              : "새 데이터가 있습니다."}
            <button onClick={() => MANAGEMENT(true)}>데이터 관리 열기</button>
          </div>
        )}
      {plan && (
        <section className="alert sync-confirm" aria-label="전체 수집 안내">
          <strong>전체 증강 다운로드</strong>
          <p>
            {plan.needsCatalog
              ? plan.message
              : `대상 버전 ${plan.version} · 미저장 ${plan.needed}명 · 예상 ${plan.cost} credits (잔여 약 ${plan.remaining}, 상세용 20 유지)`}
          </p>
          <Button variant="outline" onClick={() => PLAN(null)}>
            닫기
          </Button>
          {
            <Button
              disabled={busy || (!plan.needsCatalog && plan.cost === 0)}
              onClick={() =>
                void action(async () => {
                  await api("/sync", {});
                  PLAN(null);
                })
              }
            >
              {plan.needsCatalog
                ? "목록도 함께 갱신 후 수집"
                : plan.cost === 0
                  ? "모두 저장됨"
                  : "다운로드 시작"}
            </Button>
          }
        </section>
      )}
      {status.token && !status.hasKey && (
        <div className="alert">
          최초 설정: .env.example을 .env로 복사하고 ARAMGG_API_KEY를 입력한 뒤
          다시 실행하세요.
        </div>
      )}
      {settingsError && (
        <div className="alert error" role="alert">
          <span>{settingsError}</span>
          <button onClick={() => RETRYSETTINGS((value) => value + 1)}>
            설정 다시 불러오기
          </button>
        </div>
      )}
      {settingsSavingFailed && (
        <div className="alert error" role="alert">
          <span>
            설정 파일 저장에 실패했습니다. 현재 선택은 브라우저에 유지됩니다.
          </span>
          <button onClick={() => RETRYSAVE((value) => value + 1)}>
            설정 다시 저장
          </button>
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => E("")}>닫기</button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {status.job?.message &&
        (status.job.running || status.job.message !== hiddenJob) && (
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
            <span title="전체 챔피언 승률 순위 기준 자체 티어">자체 티어</span>
          </div>
          <details className="tier-guide metadata">
            <summary>승률 기준 자체 티어</summary>
            <p>
              전체 목록의 유효한 승률 순위 기준입니다. 검색·즐겨찾기와 무관하며
              같은 승률은 같은 티어입니다.
            </p>
            <p>
              S 상위 10% · A 10~30% · B 30~70% · C 70~90% · D 하위 10%. 제공자의
              공식 티어가 아닙니다. 동률은 더 높은 순위로 처리해 구간별 인원은
              달라질 수 있습니다.
            </p>
          </details>
          <div className="champion-list">
            {filtered.map((c) => (
              <button
                className={"champion-row " + (id === c.id ? "selected" : "")}
                key={c.id}
                onClick={() => select(c.id)}
              >
                <Icon url={c.iconUrl} name={c.name} />
                <span className="champion-label">{c.name}</span>
                {favs.includes(c.id) && <Star size={12} className="gold" />}
                <span
                  className="champion-rating"
                  title={
                    tiers.has(c.id)
                      ? `승률 기준 자체 티어 · ${tiers.get(c.id)!.rank}/${tiers.get(c.id)!.total}위`
                      : "유효한 승률 정보 없음"
                  }
                >
                  <span
                    className={`tier-badge tier-${tiers.get(c.id)?.tier.toLowerCase() ?? "unknown"}`}
                    aria-label={
                      tiers.has(c.id)
                        ? `자체 티어 ${tiers.get(c.id)!.tier}`
                        : "티어 정보 없음"
                    }
                  >
                    {tiers.get(c.id)?.tier ?? "—"}
                  </span>
                </span>
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
                </div>
                <div className="metric" aria-label="챔피언 승률">
                  <small>승률</small>
                  <strong>{pct(validRate(champ?.stats))}</strong>
                </div>
                <Button
                  variant="outline"
                  disabled={busy || status.job?.running || !status.hasKey}
                  title={
                    detailCurrent
                      ? "저장된 최신 상세를 재사용합니다. 추가 credits는 소비하지 않습니다."
                      : "최신 상세 다운로드 · 최대 2 credits"
                  }
                  aria-busy={downloading === id}
                  onClick={() => void downloadDetail()}
                >
                  {downloading === id ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  {downloading === id
                    ? "상세 받는 중…"
                    : detailCurrent
                      ? "상세 확인"
                      : "상세 받기 · 최대 2"}
                </Button>
              </div>
              {downloading !== null && downloading !== id && (
                <div
                  className="download-status"
                  role="status"
                  aria-live="polite"
                >
                  <LoaderCircle size={16} className="spin" />
                  {champs.find((c) => c.id === downloading)?.name ??
                    "챔피언"}{" "}
                  상세를 받고 있습니다.
                </div>
              )}
              <div className="tabs" role="tablist" aria-label="챔피언 상세">
                <button
                  role="tab"
                  aria-selected={tab === "summary"}
                  className={tab === "summary" ? "active" : ""}
                  onClick={() => T("summary")}
                >
                  <Layers3 size={16} />
                  빌드
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "augments"}
                  className={tab === "augments" ? "active" : ""}
                  onClick={() => T("augments")}
                >
                  <Layers3 size={16} />
                  증강 순위 <span>{d?.augments?.length ?? 0}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "builds"}
                  className={tab === "builds" ? "active" : ""}
                  onClick={() => T("builds")}
                >
                  <PackageOpen size={16} />
                  아이템 빌드 <span>{d?.builds?.length ?? 0}</span>
                </button>
              </div>
              {detailError && (
                <div className="alert error detail-error" role="alert">
                  <span>상세를 불러오지 못했습니다. {detailError}</span>
                  <button onClick={() => RETRYDETAIL((value) => value + 1)}>
                    상세 다시 시도
                  </button>
                </div>
              )}
              {!detail ? (
                !detailError && (
                  <div className="empty-small">
                    저장된 정보를 읽고 있습니다…
                  </div>
                )
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
                  <div className="detail-freshness">
                    <span>
                      마지막 다운로드 {dateTime(detail.cache?.downloadedAt)}
                      {latestVersion
                        ? currentVersion === latestVersion
                          ? " · 최신"
                          : " · 업데이트 있음"
                        : " · 최신 여부 미확인"}
                    </span>
                    <details className="metadata" key={id}>
                      <summary>데이터 정보</summary>
                      <dl>
                        <div>
                          <dt>패치 / 데이터 버전</dt>
                          <dd>
                            {detail.meta?.gamePatch ?? "미제공"} /{" "}
                            {detail.meta?.dataVersion ?? "미제공"}
                          </dd>
                        </div>

                        <div>
                          <dt>챔피언 통계 출처</dt>
                          <dd>CN / Tencent</dd>
                        </div>
                        <div>
                          <dt>증강 출처</dt>
                          <dd>추천 순위 CN / 승률 WORLD 업로드 표본</dd>
                        </div>
                        <div>
                          <dt>챔피언·추천 기준일</dt>
                          <dd>
                            {d.champion?.stats?.date ??
                              detail.meta?.statsDate ??
                              "미제공"}
                          </dd>
                        </div>
                        <div>
                          <dt>증강 승률 기준일</dt>
                          <dd>{augmentDateText}</dd>
                        </div>
                        <div>
                          <dt>제공자 생성</dt>
                          <dd>{dateTime(detail.meta?.generatedAt)}</dd>
                        </div>
                        <div>
                          <dt>빌드 패치</dt>
                          <dd>{d.builds?.[0]?.patch ?? "미제공"}</dd>
                        </div>
                        <div>
                          <dt>빌드 출처</dt>
                          <dd>일반 칼바람 참고 데이터</dd>
                        </div>
                        {detail.buildStale && (
                          <>
                            <div>
                              <dt>이전 빌드 버전</dt>
                              <dd>
                                {detail.buildMeta?.dataVersion ?? "미제공"}
                              </dd>
                            </div>
                            <div>
                              <dt>이전 빌드 다운로드</dt>
                              <dd>
                                {dateTime(detail.buildCache?.downloadedAt)}
                              </dd>
                            </div>
                            <div>
                              <dt>빌드 제공자 생성</dt>
                              <dd>{dateTime(detail.buildMeta?.generatedAt)}</dd>
                            </div>
                          </>
                        )}
                      </dl>
                    </details>
                  </div>
                  {detail.buildStale && (
                    <div className="notice stale-build-note">
                      이전 빌드 데이터 사용 중 · 증강과 빌드의 버전이 다릅니다.
                      상세 받기로 갱신할 수 있습니다.
                    </div>
                  )}
                  {tab === "summary" ? (
                    <div
                      className="overview"
                      role="tabpanel"
                      aria-label="빌드 요약"
                    >
                      <section
                        className="overview-preparation"
                        aria-label="소환사 주문과 스킬 순서"
                      >
                        <BuildPreparation build={overviewBuild} />
                      </section>
                      <section aria-labelledby="overview-augments">
                        <h3 id="overview-augments">
                          추천 증강 <span>TOP 10</span>
                        </h3>
                        <div className="overview-augment-grid">
                          <AugmentTable
                            augments={overviewAugments.slice(0, 5)}
                            compact
                            empty="저장된 증강 정보가 없습니다."
                          />
                          {overviewAugments.length > 5 && (
                            <AugmentTable
                              augments={overviewAugments.slice(5)}
                              compact
                              empty=""
                            />
                          )}
                        </div>
                      </section>
                      <section
                        className="overview-build"
                        aria-labelledby="overview-items"
                      >
                        <div className="overview-build-columns">
                          <section
                            className="overview-primary-build"
                            aria-labelledby="overview-items"
                          >
                            <h3 id="overview-items">
                              핵심 빌드{" "}
                              <span>1순위 · {buildLabel(overviewBuild)}</span>
                            </h3>
                            {overviewCoreBuilds.length ? (
                              <div className="overview-core-builds">
                                {overviewCoreBuilds.map(
                                  (row: any, index: number) => (
                                    <div
                                      className="overview-core-build"
                                      key={index}
                                      role="group"
                                      aria-label={`핵심 빌드 ${index + 1}`}
                                    >
                                      <span className="build-number">
                                        {index + 1}
                                      </span>
                                      <CoreItemImages items={row.items} />
                                    </div>
                                  ),
                                )}
                              </div>
                            ) : (
                              <p>
                                {d.builds?.length
                                  ? "저장된 핵심 아이템 조합이 없습니다."
                                  : "상세 받기로 아이템 빌드를 다운로드할 수 있습니다."}
                              </p>
                            )}
                          </section>
                          {secondaryBuilds.length > 0 && (
                            <section
                              className="overview-secondary-builds"
                              aria-label="다른 빌드 유형"
                            >
                              {secondaryBuilds.map(({ build, rank, items }) => (
                                <div
                                  className="overview-secondary-build"
                                  key={rank}
                                  role="group"
                                  aria-label={`${rank}순위 빌드`}
                                >
                                  <h3>
                                    {rank}순위 빌드{" "}
                                    <span>{buildLabel(build)}</span>
                                  </h3>
                                  {items.length ? (
                                    <CoreItemImages items={items} />
                                  ) : (
                                    <p>
                                      저장된 첫 번째 아이템 조합이 없습니다.
                                    </p>
                                  )}
                                </div>
                              ))}
                            </section>
                          )}
                        </div>
                        <p className="overview-source">일반 칼바람 빌드 참고</p>
                      </section>
                    </div>
                  ) : tab === "augments" ? (
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
                      <AugmentTable
                        augments={augments}
                        empty="조건에 맞는 증강이 없습니다."
                      />
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
                        <span className="muted">일반 칼바람 빌드 참고</span>
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
                            <details className="metadata build-preparation-details">
                              <summary>주문·스킬</summary>
                              <BuildPreparation build={b} />
                            </details>
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
          Mayhem Pocket <b>v0.1.1</b> · 데이터:{" "}
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
