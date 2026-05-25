/**
 * SearchPage — SSE-backed full-page search UI with progress tracking and result display.
 * SearchPage — 支持 SSE 的全页搜索 UI, 包含进度追踪和结果展示.
 *
 * Responsibilities / 职责:
 *   - Render the search input form and submit to ?q= URL param — 渲染搜索输入框并提交到 ?q= URL 参数
 *   - Bridge URL ↔ searchStore via two effects (initial sync + submission) — 通过两个 effect 桥接 URL ↔ searchStore
 *   - Delegate SSE streaming lifecycle to useSearchStreamSync — 将 SSE 流生命周期委托给 useSearchStreamSync
 *   - Show SearchProgressCard when the stream is active or complete — 流活跃或完成时展示 SearchProgressCard
 *   - Show SearchSkeleton while loading, StatusState on error, EmptyState on zero results — 加载中展示骨架, 错误展示 StatusState, 无结果展示 EmptyState
 *   - Navigate to /detail/:token on card open (token via storage/detailRoute);
 *     save SourceBundle to localStorage — 卡片打开时跳转到 /detail/:token (token 由 storage/detailRoute 生成),
 *     并保存 SourceBundle 到 localStorage
 *   - Track favorite state in local React state; sync on each toggle — 在本地 React state 中追踪收藏状态; 每次切换时同步
 *
 * State ownership / 状态所有权:
 *   searchStore (Zustand vanilla) owns SSE lifecycle + query + results + progress.
 *   SearchPage reads from the store and dispatches actions; it does NOT own the SSE stream.
 *   searchStore (Zustand vanilla) 持有 SSE 生命周期 + 查询 + 结果 + 进度.
 *   SearchPage 从 store 读取并分发 action; 它不持有 SSE 流.
 *
 * URL contract / URL 契约:
 *   Route: /search?q=<query>
 *   The URL is the single source of truth for what query was submitted.
 *   URL 是已提交查询的唯一真相来源.
 *
 * TIER 4 LOCKED / Tier 4 锁定:
 *   - Do not change the /search?q= URL pattern — 不得更改 /search?q= URL 格式
 *   - Do not change the SSE wire format assumptions (owned by searchStream.ts) — 不得更改 SSE 协议假设
 *   - Do not change the kmtv.sourceBundles.v1 localStorage schema — 不得更改 localStorage schema
 *
 * Callers / 调用方:
 *   app/AppRoutes.tsx (renders this page on the /search route)
 */

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useStore } from "zustand";
import { useNavigate, useSearchParams } from "react-router-dom";

import { staggerChild, staggerParent } from "@/animation/motionPresets";

/**
 * STAGGER_CAP — maximum number of result cards that receive stagger entrance animation.
 * STAGGER_CAP — 接收错落入场动画的最大结果卡片数量.
 *
 * Cards beyond this index receive no entrance variant so long result sets do not
 * accumulate excessive animation delay. 8 cards ≈ 1.2 s at the default stagger timing.
 * 超过此索引的卡片不接收入场变体, 避免长结果集累积过多动画延迟.
 * 8 张卡片在默认错落时间下约 1.2 秒.
 */
const STAGGER_CAP = 8;

import { useAPI } from "@/api/context";
import type { Episode, SearchProgress, SearchResult, SourceResult } from "@/api/types";
import { favoriteIDs, resultFavoriteIDs, toggleResultFavorite } from "@/storage/favorites";
import { detailRoutePath } from "@/storage/detailRoute";
import { bundleFromSearchResult, saveSourceBundle } from "@/storage/sourceBundles";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { StatusState } from "@/shared/ui/StatusState";
import { VideoResultCard } from "@/viewer/components/VideoResultCard";
import { SearchSkeleton } from "@/viewer/skeletons/SearchSkeleton";
import { searchStore, type SearchProgressMap, type SearchStatus } from "@/store/searchStore";

import { useSearchStreamSync } from "./useSearchStreamSync";

// TrackedSearchPhase — the two SSE progress phases the backend emits and we display.
// TrackedSearchPhase — 后端发出并展示的两个 SSE 进度阶段.
type TrackedSearchPhase = "searching" | "probing";

// SearchPhaseState — visual state of a single progress card.
// SearchPhaseState — 单个进度卡片的视觉状态.
type SearchPhaseState = "pending" | "active" | "done";

// trackedSearchPhases defines the render order of the progress card grid.
// trackedSearchPhases 定义进度卡片网格的渲染顺序.
const trackedSearchPhases: TrackedSearchPhase[] = ["searching", "probing"];

/**
 * SearchPage — full-page search view backed by SSE streaming results.
 * SearchPage — 基于 SSE 流式结果的全页搜索视图.
 *
 * The URL param ?q= is the single source of truth for the submitted query.
 * Form submission updates the URL; the useEffect bridge detects the URL change
 * and calls submitQuery on the store, which starts the SSE stream via useSearchStreamSync.
 * URL 参数 ?q= 是已提交查询的唯一真相来源.
 * 表单提交更新 URL; useEffect 桥接检测 URL 变化并调用 store 的 submitQuery,
 * 通过 useSearchStreamSync 启动 SSE 流.
 */
export function SearchPage() {
  const api = useAPI();
  const navigate = useNavigate();
  const { t } = useTranslation("viewer");
  const [params, setParams] = useSearchParams();
  const activeQuery = params.get("q") ?? "";

  // SSE lifecycle lives in the store; the bridge hook starts/resumes streams.
  // SSE 生命周期由 store 持有, bridge hook 启动或恢复流.
  useSearchStreamSync(api);

  const queryText = useStore(searchStore, (s) => s.queryText);
  const lastSubmittedQuery = useStore(searchStore, (s) => s.lastSubmittedQuery);
  const results = useStore(searchStore, (s) => s.results);
  const status = useStore(searchStore, (s) => s.status);
  const progressMap = useStore(searchStore, (s) => s.progressMap);
  const errorMessage = useStore(searchStore, (s) => s.errorMessage);
  const setQueryText = useStore(searchStore, (s) => s.setQueryText);
  const submitQueryAction = useStore(searchStore, (s) => s.submitQuery);
  const retryQuery = useStore(searchStore, (s) => s.retryQuery);

  // savedFavoriteIDs is local state so toggling a favorite updates the card immediately
  // without a full store round-trip.
  // savedFavoriteIDs 是本地 state, 切换收藏时立即更新卡片, 无需完整 store 往返.
  const [savedFavoriteIDs, setSavedFavoriteIDs] = useState<Set<string>>(() => favoriteIDs());
  // Stagger collapses to a no-op variant when reduced motion is preferred.
  // 用户偏好减少动画时 stagger 变为空变体.
  const reduceMotion = useReducedMotion() ?? false;
  const parentVariants = reduceMotion ? undefined : staggerParent;
  const childVariants = reduceMotion ? undefined : staggerChild;

  // The URL drives intent; the store drives display.
  // URL 表达意图, store 驱动显示.
  useEffect(() => {
    if (!activeQuery) return;
    // Avoid re-submitting the same query if the store already has it (e.g. back-navigation).
    // 如果 store 已有该查询则避免重复提交 (如后退导航).
    if (activeQuery === lastSubmittedQuery) return;
    setQueryText(activeQuery);
    submitQueryAction(activeQuery);
  }, [activeQuery, lastSubmittedQuery, setQueryText, submitQueryAction]);

  // Sync the input box to the URL when there is no submitted query yet,
  // so the input reflects ?q= on initial mount before the stream fires.
  // URL 中已有 ?q= 但 store 尚未同步时, 把输入框同步到 URL
  // (初始挂载时, 流触发前输入框应反映 ?q= 值).
  useEffect(() => {
    if (activeQuery && queryText === "" && lastSubmittedQuery === "") {
      setQueryText(activeQuery);
    }
  }, [activeQuery, queryText, lastSubmittedQuery, setQueryText]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = queryText.trim();
    // Only push to URL if there is a non-blank query; empty submit is a no-op.
    // 仅在查询非空时推送到 URL; 空提交为无操作.
    if (next) {
      setParams({ q: next });
    }
  }

  function retrySearch() {
    retryQuery();
  }

  function openSource(item: SearchResult, sourceIndex?: number) {
    const safeItem = sanitizeSearchResult(item);
    // Fall back to the fastest source when no explicit index is given.
    // 未指定索引时回退到最快的 source.
    const source = safeItem.sources[sourceIndex ?? fastestSourceIndex(safeItem.sources)];
    if (!source) {
      return;
    }
    const bundle = bundleFromSearchResult(safeItem);
    saveSourceBundle(bundle);
    // Use React Router's built-in viewTransition option so the snapshot fires AFTER React commits the new route.
    // 通过 React Router 内置的 viewTransition 选项, 让快照在路由提交之后执行, 避免新旧 DOM 颠倒.
    navigate(detailRoutePath(source.source_key, source.video_id), {
      state: { sourceBundle: bundle },
      viewTransition: true,
    });
  }

  function toggleSearchFavorite(item: SearchResult) {
    toggleResultFavorite(item);
    // Re-read favoriteIDs from localStorage after the toggle to keep local state in sync.
    // toggle 后重新从 localStorage 读取 favoriteIDs 以保持本地 state 同步.
    setSavedFavoriteIDs(favoriteIDs());
  }

  const searchingProgress = progressMap.searching;
  const probingProgress = progressMap.probing;

  return (
    <main className="page search-page search-page-redesign">
      <section className="search-workspace">
        <div className="search-main-column">
          <section className="search-panel">
            <p className="eyebrow">{t("search.eyebrow")}</p>
            <h1>{activeQuery ? t("search.titleActive", { query: activeQuery }) : t("search.title")}</h1>
            <form className="search-bar" onSubmit={submit}>
              <input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder={t("search.placeholder")} aria-label={t("search.inputLabel")} />
              <Button type="submit" variant="primary">
                {t("search.submit")}
              </Button>
            </form>
          </section>

          {activeQuery && (status === "loading" || status === "success") ? <SearchProgressCard progressMap={progressMap} /> : null}
          {status === "loading" ? <SearchSkeleton /> : null}
          {status === "error" ? (
            <StatusState
              title={t("search.failed")}
              description={errorMessage || t("search.failedDescription")}
              tone="error"
              action={
                <Button type="button" variant="secondary" onClick={retrySearch}>
                  {t("search.retry")}
                </Button>
              }
            />
          ) : null}
          {status === "success" && activeQuery && results.length === 0 ? <EmptyState title={t("search.noResults")} description={t("search.noResultsDescription")} /> : null}
          <motion.div className="result-list" variants={parentVariants} initial="hidden" animate="visible">
            {results.map((item, index) => {
              const safeItem = sanitizeSearchResult(item);
              return (
                <motion.div
                  key={searchResultKey(safeItem, index)}
                  variants={index < STAGGER_CAP ? childVariants : undefined}
                >
                  <VideoResultCard item={safeItem} onOpen={openSource} onFavorite={toggleSearchFavorite} isFavorited={isResultFavorited(safeItem, savedFavoriteIDs)} />
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        <aside className="search-summary-card" aria-label={t("search.summary.ariaLabel")}>
          <p className="eyebrow">{t("search.summary.eyebrow")}</p>
          <h2>{summaryStatusLabel(t, status, activeQuery)}</h2>
          <dl>
            <div>
              <dt>{t("search.summary.keyword")}</dt>
              <dd>{activeQuery || t("search.summary.waiting")}</dd>
            </div>
            <div>
              <dt>{t("search.summary.progress")}</dt>
              <dd>{summaryProgressValue(searchingProgress)}</dd>
            </div>
            <div>
              <dt>{t("search.summary.probing")}</dt>
              <dd>{summaryProgressValue(probingProgress)}</dd>
            </div>
            <div>
              <dt>{t("search.summary.results")}</dt>
              <dd>{results.length}</dd>
            </div>
          </dl>
        </aside>
      </section>
    </main>
  );
}

/**
 * SearchProgressCard — live SSE phase progress grid shown during and after a search.
 * SearchProgressCard — 搜索期间和之后展示的实时 SSE 阶段进度网格.
 *
 * Renders one card per tracked phase ("searching", "probing"), each with a progress bar
 * driven by the phase's completed/total ratio from the SSE stream.
 * 每个追踪阶段 ("searching", "probing") 渲染一张卡片, 进度条由 SSE 流的 completed/total 比率驱动.
 *
 * @param progressMap — phase-keyed progress events from searchStore — searchStore 中以阶段为键的进度事件
 */
function SearchProgressCard({ progressMap }: { progressMap: SearchProgressMap }) {
  const { t } = useTranslation("viewer");
  return (
    <section className="search-progress-card" aria-label={t("search.progress.ariaLabel")}>
      <div className="search-phase-grid">
        {trackedSearchPhases.map((phase) => {
          const progress = progressMap[phase];
          const percent = progressPercent(progress);
          const state = progressPhaseState(percent);
          return (
            <article className={`search-phase-card search-phase-card-${state}`} key={phase}>
              <div className="search-phase-head">
                <h2>{t(`search.progress.${phase}` as const)}</h2>
                <span>{phaseStateLabel(t, state)}</span>
              </div>
              <p className="search-phase-value">{progressValue(progress)}</p>
              <div
                className="search-phase-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className="search-phase-bar-fill"
                  style={{ "--search-phase-progress": `${percent}%` } as CSSProperties}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// progressValue formats a progress snapshot as "completed / total".
// progressValue 将进度快照格式化为 "completed / total".
function progressValue(progress: SearchProgress | undefined): string {
  return progress ? `${progress.completed} / ${progress.total}` : "0 / 0";
}

/**
 * progressPercent — compute integer 0-100 progress percentage from a phase snapshot.
 * progressPercent — 从阶段快照计算 0-100 整数进度百分比.
 *
 * Returns 0 when progress is absent or total is non-positive (avoids division-by-zero).
 * 当 progress 缺失或 total 非正时返回 0 (避免除以零).
 *
 * @param progress — SSE progress event or undefined — SSE 进度事件或 undefined
 * @returns        — integer in [0, 100] — [0, 100] 范围内的整数
 */
function progressPercent(progress: SearchProgress | undefined): number {
  if (!progress || progress.total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)));
}

/**
 * progressPhaseState — derive a SearchPhaseState from the computed percent.
 * progressPhaseState — 从计算的百分比推导 SearchPhaseState.
 *
 * - 100 → "done"; > 0 → "active"; 0 → "pending".
 * CSS class suffix is "search-phase-card-{state}".
 * CSS 类后缀为 "search-phase-card-{state}".
 *
 * @param percent — integer 0-100 — 0-100 整数
 * @returns       — phase visual state — 阶段视觉状态
 */
function progressPhaseState(percent: number): SearchPhaseState {
  if (percent >= 100) {
    return "done";
  }
  if (percent > 0) {
    return "active";
  }
  return "pending";
}

// ViewerT is the narrow TFunction type for the "viewer" i18n namespace.
// ViewerT 是 "viewer" i18n 命名空间的窄 TFunction 类型.
type ViewerT = TFunction<"viewer", undefined>;

// phaseStateLabel returns the i18n label for a progress card's state chip.
// phaseStateLabel 返回进度卡片状态 chip 的 i18n 标签.
function phaseStateLabel(t: ViewerT, state: SearchPhaseState): string {
  if (state === "done") return t("search.progress.stateDone");
  if (state === "active") return t("search.progress.stateActive");
  return t("search.progress.statePending");
}

// summaryStatusLabel returns the h2 label for the summary sidebar based on stream state and query.
// summaryStatusLabel 根据流状态和查询返回摘要侧边栏的 h2 标签.
function summaryStatusLabel(t: ViewerT, status: SearchStatus, activeQuery: string): string {
  if (!activeQuery) return t("search.summary.statusIdle");
  if (status === "loading") return t("search.summary.statusLoading");
  if (status === "error") return t("search.summary.statusError");
  return t("search.summary.statusSuccess");
}

// summaryProgressValue formats a progress snapshot for the compact summary sidebar (no spaces).
// summaryProgressValue 将进度快照格式化为紧凑摘要侧边栏用格式 (无空格).
function summaryProgressValue(progress: SearchProgress | undefined): string {
  return progress ? `${progress.completed}/${progress.total}` : "0/0";
}

/**
 * sanitizeSearchResult — coerce a potentially unsafe runtime SearchResult to a safe local shape.
 * sanitizeSearchResult — 将潜在不安全的运行时 SearchResult 强制转换为安全的本地形状.
 *
 * The SSE stream may carry API contract violations (null sources, malformed entries).
 * This function ensures sources is always a valid SourceResult[].
 * SSE 流可能携带违反 API 契约的数据 (null sources, 格式错误的条目).
 * 此函数确保 sources 始终是有效的 SourceResult[].
 *
 * @param item — raw SearchResult from the SSE event — SSE 事件中的原始 SearchResult
 * @returns    — sanitized copy with guaranteed valid sources array — 保证 sources 有效的净化副本
 */
function sanitizeSearchResult(item: SearchResult): SearchResult {
  return { ...item, sources: safeSourceResults(item) };
}

// safeSourceResults filters a SearchResult's sources to only valid SourceResult entries.
// safeSourceResults 过滤 SearchResult 的 sources, 仅保留有效的 SourceResult 条目.
function safeSourceResults(item: SearchResult): SourceResult[] {
  return Array.isArray(item.sources) ? item.sources.filter(isSourceResult) : [];
}

// isSourceResult is a type guard that validates the structural requirements of a SourceResult.
// Rejects empty source_key / video_id and any control character used as the detail-route
// token separator (0x1F) — see storage/detailRoute.ts. Without this guard, malformed
// upstream entries would navigate to a permanently-broken /detail/:token URL.
// isSourceResult 是验证 SourceResult 结构要求的类型守卫.
// 拒绝空 source_key / video_id 以及详情路由令牌分隔符 (0x1F) — 详见 storage/detailRoute.ts.
// 无此守卫, 上游恶意条目会跳转到永久死链 /detail/:token URL.
function isSourceResult(source: unknown): source is SourceResult {
  if (
    typeof source === "object" &&
    source !== null &&
    "source_key" in source &&
    typeof source.source_key === "string" &&
    source.source_key.length > 0 &&
    !source.source_key.includes("\x1F") &&
    "source_name" in source &&
    typeof source.source_name === "string" &&
    "video_id" in source &&
    typeof source.video_id === "string" &&
    source.video_id.length > 0 &&
    !source.video_id.includes("\x1F")
  ) {
    return !("episodes" in source) || source.episodes === undefined || (Array.isArray(source.episodes) && source.episodes.every(isEpisode));
  }
  return false;
}

// isEpisode is a type guard for Episode: requires name and url string fields.
// isEpisode 是 Episode 的类型守卫: 要求 name 和 url 字符串字段.
function isEpisode(value: unknown): value is Episode {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "url" in value && typeof value.url === "string";
}

/**
 * fastestSourceIndex — return the index of the source with the lowest positive duration_ms.
 * fastestSourceIndex — 返回 duration_ms 最小正值的 source 索引.
 *
 * duration_ms is the probe round-trip time from useSearchStreamSync; lower = faster CDN.
 * When no source has a valid duration_ms (e.g. probing not yet complete), returns 0.
 * duration_ms 是 useSearchStreamSync 的探测往返时间; 越低表示 CDN 越快.
 * 当没有 source 有有效 duration_ms 时 (如探测尚未完成), 返回 0.
 *
 * @param sources — sanitized SourceResult array — 已净化的 SourceResult 数组
 * @returns       — index of the fastest source, or 0 as fallback — 最快 source 的索引, 或 0 作为回退
 */
function fastestSourceIndex(sources: SourceResult[]): number {
  let bestIndex = 0;
  let bestDuration = Number.POSITIVE_INFINITY;
  sources.forEach((source, index) => {
    if (typeof source.duration_ms === "number" && source.duration_ms > 0 && source.duration_ms < bestDuration) {
      bestIndex = index;
      bestDuration = source.duration_ms;
    }
  });
  return bestIndex;
}

// isResultFavorited checks whether any of the result's canonical IDs is in the saved set.
// isResultFavorited 检查结果的任意规范 ID 是否在已保存集合中.
function isResultFavorited(item: SearchResult, ids: Set<string>): boolean {
  return Array.from(resultFavoriteIDs(item)).some((id) => ids.has(id));
}

// searchResultKey builds a stable React list key from title + year + first valid source identity.
// Falls back to positional index when no valid sources are present.
// searchResultKey 从 title + year + 第一个有效 source 标识构建稳定的 React 列表 key.
// 当无有效 source 时回退到位置索引.
function searchResultKey(item: SearchResult, index: number): string {
  const firstSource = safeSourceResults(item)[0];
  return firstSource ? `${item.title}-${item.year ?? ""}-${firstSource.source_key}-${firstSource.video_id}` : `${item.title}-${item.year ?? ""}-${index}`;
}
