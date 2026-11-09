import { useMemo, useState, type RefObject } from "react";
import {
  Search,
  Download,
  RefreshCw,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "./ui/button";
import { GameIcon } from "./GameIcon";
import { descriptionText } from "../augment-description";
import { encyclopediaAugments } from "../ui-model";

const pageSize = 24;
const rarityLabels: Record<string, string> = {
  silver: "실버",
  gold: "골드",
  prismatic: "프리즘",
};
export function AugmentEncyclopedia({
  catalog,
  latestVersion,
  busy,
  hasKey,
  onDownload,
  onSelectChampion,
  searchRef,
}: {
  catalog: any;
  latestVersion: string | null;
  busy: boolean;
  hasKey: boolean;
  onDownload: () => void;
  onSelectChampion: (id: number) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, QUERY] = useState("");
  const [rarity, RARITY] = useState("all");
  const [selectedId, SELECT] = useState<number | null>(null);
  const [page, PAGE] = useState(0);
  const all = catalog.data ?? [];
  const filtered = useMemo(
    () => encyclopediaAugments(all, query, rarity),
    [all, query, rarity],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const selected = filtered.find((a: any) => a.id === selectedId) ?? visible[0];
  const description =
    descriptionText(selected?.description) ||
    descriptionText(selected?.tooltip);
  const tooltip = descriptionText(selected?.tooltip);
  const current =
    !!latestVersion &&
    catalog.version === latestVersion &&
    all.some((a: any) => a.description || a.tooltip);
  function changePage(next: number) {
    PAGE(next);
    SELECT(null);
  }
  return (
    <section className="encyclopedia">
      <div className="encyclopedia-heading">
        <div>
          <h1>증강 도감</h1>
          <p className="muted">
            증강을 선택하면 능력 설명과 어울리는 챔피언을 볼 수 있습니다.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || !hasKey}
          onClick={onDownload}
          aria-busy={busy}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : all.length ? (
            <RefreshCw size={15} />
          ) : (
            <Download size={15} />
          )}
          {busy
            ? "다운로드 진행 중…"
            : all.length
              ? current
                ? "도감 확인 · 무료"
                : "도감 갱신 · 최대 1"
              : "도감 받기 · 최대 1"}
        </Button>
      </div>
      <div className="encyclopedia-version muted">
        {catalog.version
          ? `설명 데이터 ${catalog.version}`
          : "아직 저장된 도감이 없습니다."}
        {catalog.version &&
          (latestVersion
            ? current
              ? " · 최신"
              : " · 업데이트 있음"
            : " · 최신 여부 미확인")}
      </div>
      {catalog.version &&
        latestVersion &&
        catalog.version !== latestVersion && (
          <div className="update-notice cache-update" role="status">
            <span>
              <strong>증강 도감 업데이트 필요</strong>
              <br />
              저장 버전 {catalog.version} → 최신 버전 {latestVersion}. 최신
              설명을 받으려면 위의 ‘도감 갱신’을 눌러주세요.
            </span>
          </div>
        )}
      {!all.length ? (
        <div className="empty-small encyclopedia-empty">
          <p>도감 받기를 누르면 전체 증강 목록과 능력 설명을 저장합니다.</p>
          <p className="muted">
            필요 시 1 credit을 사용하며, 같은 버전은 재사용합니다. 저장한 도감은
            오프라인에서도 볼 수 있습니다.
          </p>
          {!hasKey && (
            <p className="muted">먼저 위에서 API 키를 등록해 주세요.</p>
          )}
        </div>
      ) : (
        <>
          <div className="encyclopedia-controls">
            <div className="search encyclopedia-search">
              <Search size={17} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  QUERY(event.target.value);
                  PAGE(0);
                  SELECT(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    QUERY("");
                    PAGE(0);
                    SELECT(null);
                    event.stopPropagation();
                  }
                }}
                placeholder="증강 이름·초성 검색"
                aria-label="도감 증강 검색"
              />
              <kbd>/</kbd>
            </div>
            <div className="pills" aria-label="도감 등급 필터">
              {[
                ["all", "전체"],
                ["silver", "실버"],
                ["gold", "골드"],
                ["prismatic", "프리즘"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={rarity === value ? `active ${value}` : ""}
                  aria-pressed={rarity === value}
                  onClick={() => {
                    RARITY(value);
                    PAGE(0);
                    SELECT(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="encyclopedia-list-heading">
            <span className="muted">
              증강 {filtered.length}개 / 전체 {all.length}개
            </span>
            {pages > 1 && (
              <nav
                className="encyclopedia-pagination"
                aria-label="도감 목록 페이지"
              >
                <button
                  type="button"
                  aria-label="도감 이전 페이지"
                  disabled={currentPage === 0}
                  onClick={() => changePage(currentPage - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span aria-live="polite">
                  {currentPage + 1} / {pages}
                </span>
                <button
                  type="button"
                  aria-label="도감 다음 페이지"
                  disabled={currentPage >= pages - 1}
                  onClick={() => changePage(currentPage + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </nav>
            )}
          </div>
          <div className="encyclopedia-grid" aria-label="도감 증강 목록">
            {visible.map((augment: any) => (
              <button
                type="button"
                className="encyclopedia-augment"
                key={augment.id}
                aria-pressed={selected?.id === augment.id}
                onClick={() => SELECT(augment.id)}
              >
                <GameIcon url={augment.iconUrl} name={augment.name} size={40} />
                <span className="encyclopedia-augment-name">
                  {augment.name}
                  <small className={augment.rarityName ?? ""}>
                    {rarityLabels[augment.rarityName] ??
                      augment.rarityDisplayName ??
                      "등급 미제공"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-small" role="status">
              조건에 맞는 증강이 없습니다.
            </div>
          )}
          {selected && (
            <section
              className="encyclopedia-detail"
              aria-label="선택한 증강 상세"
              aria-live="polite"
            >
              <div className="encyclopedia-detail-heading">
                <GameIcon
                  url={selected.iconUrl}
                  name={selected.name}
                  size={58}
                />
                <div>
                  <span
                    className={`encyclopedia-rarity ${selected.rarityName ?? ""}`}
                  >
                    {rarityLabels[selected.rarityName] ??
                      selected.rarityDisplayName ??
                      "등급 미제공"}
                  </span>
                  <h2>{selected.name}</h2>
                </div>
              </div>
              <p className="encyclopedia-description">
                {description || "제공된 능력 설명이 없습니다."}
              </p>
              {tooltip && tooltip !== description && (
                <details
                  className="metadata encyclopedia-description-more"
                  key={selected.id}
                >
                  <summary>상세 효과</summary>
                  <p className="encyclopedia-description">{tooltip}</p>
                </details>
              )}
              {/\?|@[\w.]+@/.test(description + tooltip) && (
                <p className="muted encyclopedia-missing-values">
                  일부 수치는 API에서 제공하지 않습니다.
                </p>
              )}
              <div className="encyclopedia-champions-heading">
                <h3>어울리는 챔피언</h3>
                <span className="muted">
                  API 제공 추천 목록 · 개별 승률 미제공
                </span>
              </div>
              {selected.topChampions?.length ? (
                <div
                  className="encyclopedia-champions"
                  aria-label="어울리는 챔피언 목록"
                >
                  {selected.topChampions.map((champion: any) => (
                    <button
                      type="button"
                      key={champion.id}
                      onClick={() => onSelectChampion(champion.id)}
                      aria-label={`${champion.name} 챔피언 화면 보기`}
                    >
                      <GameIcon
                        url={champion.iconUrl}
                        name={champion.name}
                        size={48}
                      />
                      <span>{champion.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">제공된 추천 챔피언이 없습니다.</p>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
